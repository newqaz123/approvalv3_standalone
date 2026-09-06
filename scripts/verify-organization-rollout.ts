import { readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import {
  verifyOrganizationRollout,
  type OrganizationRolloutVerification,
  type RolloutVerificationDb,
} from '../src/lib/approval-rollout'

export interface VerifyOrganizationRolloutOptions {
  argv: readonly string[]
  createDb?: () => Promise<RolloutVerificationDb & { close?: () => Promise<void> }>
  readMappingReport?: (path: string) => Promise<unknown>
  writeReport?: (path: string, report: OrganizationRolloutVerification) => Promise<void>
  print?: (line: string) => void
}

const USAGE = 'Usage: verify-organization-rollout --mapping-report <path> [--out <path>]'

function parseArguments(argv: readonly string[]): { help: boolean; mappingReportPath?: string; outPath?: string } {
  if (argv.includes('--help') || argv.includes('-h')) return { help: true }
  let mappingReportPath: string | undefined
  let outPath: string | undefined
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (flag === '--mapping-report' || flag === '--out') {
      const value = argv[++index]
      if (!value || value.startsWith('--')) throw new Error(`${flag} requires a path`)
      if (flag === '--mapping-report') mappingReportPath = value
      else outPath = value
    } else {
      throw new Error(`Unknown argument: ${flag}`)
    }
  }
  if (!mappingReportPath) throw new Error(USAGE)
  return { help: false, mappingReportPath, outPath }
}

function mappingBlockersFromReport(raw: unknown): string[] {
  if (!raw || typeof raw !== 'object') return []
  const blockers = (raw as { blockingReasons?: unknown }).blockingReasons
  if (!Array.isArray(blockers)) return []
  return blockers.filter((reason): reason is string => typeof reason === 'string')
}

export async function runVerifyOrganizationRollout(options: VerifyOrganizationRolloutOptions): Promise<number> {
  const print = options.print ?? ((line: string) => console.log(line))
  const parsed = parseArguments(options.argv)
  if (parsed.help) {
    print(USAGE)
    print('Read-only verification of reviewed mapping blockers, discriminator gaps, published routes, and snapshot groups.')
    return 0
  }

  const readMappingReport = options.readMappingReport ?? (async (path: string) => JSON.parse(await readFile(path, 'utf8')))
  const mappingReport = await readMappingReport(parsed.mappingReportPath!)
  const fileBlockers = mappingBlockersFromReport(mappingReport)

  const created = options.createDb ? await options.createDb() : await createPrismaVerificationDb()
  try {
    const db: RolloutVerificationDb = {
      loadMappingBlockers: async () => {
        const loaded = await created.loadMappingBlockers()
        return loaded.length > 0 ? loaded : fileBlockers
      },
      countLegacyRowsWithoutDiscriminator: () => created.countLegacyRowsWithoutDiscriminator(),
      countPublishedRouteConflicts: () => created.countPublishedRouteConflicts(),
      countInactiveSnapshotCandidates: () => created.countInactiveSnapshotCandidates(),
      countPendingSnapshotGroupsMissing: () => created.countPendingSnapshotGroupsMissing(),
    }
    const report = await verifyOrganizationRollout(db)
    const serialized = `${JSON.stringify(report, null, 2)}\n`
    if (parsed.outPath) {
      const writeReport = options.writeReport ?? (async (path: string, value: OrganizationRolloutVerification) => {
        await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
      })
      await writeReport(parsed.outPath, report)
    } else {
      print(serialized.trimEnd())
    }
    return report.blockers.length > 0 ? 2 : 0
  } finally {
    await created.close?.()
  }
}

async function createPrismaVerificationDb(): Promise<RolloutVerificationDb & { close: () => Promise<void> }> {
  const { PrismaClient } = await import('@prisma/client')
  const client = new PrismaClient()
  const countOf = async (query: TemplateStringsArray): Promise<number> => {
    const rows = await client.$queryRaw<Array<{ count: bigint }>>(query)
    return Number(rows[0]?.count ?? 0)
  }
  return {
    async loadMappingBlockers() {
      return []
    },
    async countLegacyRowsWithoutDiscriminator() {
      const [requestRows, solutionRows] = await Promise.all([
        countOf`SELECT COUNT(*)::bigint AS count FROM request_approvals WHERE "routingMode" IS NULL`,
        countOf`SELECT COUNT(*)::bigint AS count FROM solution_approvals WHERE "routingMode" IS NULL`,
      ])
      return requestRows + solutionRows
    },
    async countPublishedRouteConflicts() {
      return countOf`
        SELECT COUNT(*)::bigint AS count FROM (
          SELECT 1 FROM approval_route_versions
          WHERE status = 'PUBLISHED'
          GROUP BY "scopeUnitId", phase
          HAVING COUNT(*) > 1
        ) conflicts
      `
    },
    async countInactiveSnapshotCandidates() {
      return countOf`
        SELECT COUNT(*)::bigint AS count
        FROM approval_candidate_group_members m
        JOIN "users" u ON u.id = m."userId"
        WHERE u."isActive" = false
          AND (
            EXISTS (
              SELECT 1
              FROM request_approvals ra
              JOIN approval_instances i ON i.id = ra."instanceId"
              WHERE ra."candidateGroupId" = m."candidateGroupId"
                AND ra.status = 'pending'
                AND i."supersededAt" IS NULL
            )
            OR EXISTS (
              SELECT 1
              FROM solution_approvals sa
              JOIN approval_instances i ON i.id = sa."instanceId"
              WHERE sa."candidateGroupId" = m."candidateGroupId"
                AND sa.status = 'pending'
                AND i."supersededAt" IS NULL
            )
          )
      `
    },
    async countPendingSnapshotGroupsMissing() {
      const [requestRows, solutionRows] = await Promise.all([
        countOf`
          SELECT COUNT(*)::bigint AS count
          FROM request_approvals ra
          WHERE ra.status = 'pending'
            AND ra."candidateGroupId" IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM approval_candidate_groups g WHERE g.id = ra."candidateGroupId"
            )
        `,
        countOf`
          SELECT COUNT(*)::bigint AS count
          FROM solution_approvals sa
          WHERE sa.status = 'pending'
            AND sa."candidateGroupId" IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM approval_candidate_groups g WHERE g.id = sa."candidateGroupId"
            )
        `,
      ])
      return requestRows + solutionRows
    },
    async close() {
      await client.$disconnect()
    },
  }
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  return runVerifyOrganizationRollout({ argv })
}

const invokedAsScript = typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (invokedAsScript) {
  void main().then((code) => { process.exitCode = code }).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
