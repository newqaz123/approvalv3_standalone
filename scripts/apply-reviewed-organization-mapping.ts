import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { parseReviewedOrganizationMapping, type ReviewedOrganizationMapping } from '../tools/organization-mapping-schema'
import {
  applyReviewedOrganizationMapping,
  computeReviewedOrganizationMappingDigest,
  type OrganizationMappingApplyTx,
} from '../src/lib/organization/mapping'
import {
  buildOrganizationImportReport,
  type LegacyOrganizationInventory,
} from './organization-import-dry-run'

export interface ApplyReviewedOrganizationMappingCliOptions {
  argv: readonly string[]
  readMapping?: (path: string) => Promise<string | unknown | ReviewedOrganizationMapping>
  readInventory?: () => Promise<LegacyOrganizationInventory>
  createWriteTx?: () => Promise<OrganizationMappingApplyTx>
  print?: (line: string) => void
}

const USAGE = 'Usage: apply-reviewed-organization-mapping --mapping <file> --digest <sha256> --target-identity <id> --applied-by <user> [--apply]'

function parseArguments(argv: readonly string[]): {
  help: boolean
  apply: boolean
  mappingPath?: string
  digest?: string
  targetIdentity?: string
  appliedBy?: string
} {
  if (argv.includes('--help') || argv.includes('-h')) return { help: true, apply: false }
  let mappingPath: string | undefined
  let digest: string | undefined
  let targetIdentity: string | undefined
  let appliedBy: string | undefined
  let apply = false
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (flag === '--apply') {
      apply = true
      continue
    }
    if (flag === '--mapping' || flag === '--digest' || flag === '--target-identity' || flag === '--applied-by') {
      const value = argv[++index]
      if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`)
      if (flag === '--mapping') mappingPath = value
      if (flag === '--digest') digest = value
      if (flag === '--target-identity') targetIdentity = value
      if (flag === '--applied-by') appliedBy = value
      continue
    }
    throw new Error(`Unknown argument: ${flag}`)
  }
  return { help: false, apply, mappingPath, digest, targetIdentity, appliedBy }
}

async function loadMapping(
  readMapping: (path: string) => Promise<string | unknown | ReviewedOrganizationMapping>,
  mappingPath: string,
): Promise<ReviewedOrganizationMapping> {
  const raw = await readMapping(mappingPath)
  if (raw && typeof raw === 'object' && 'units' in raw && 'positionAssignments' in raw) {
    return parseReviewedOrganizationMapping(raw)
  }
  if (typeof raw === 'string') return parseReviewedOrganizationMapping(JSON.parse(raw))
  throw new Error('Reviewed mapping file is invalid')
}

export async function runApplyReviewedOrganizationMapping(
  options: ApplyReviewedOrganizationMappingCliOptions,
): Promise<number> {
  const print = options.print ?? ((line: string) => console.log(line))
  const parsed = parseArguments(options.argv)
  if (parsed.help) {
    print(USAGE)
    print('Default is dry-run. --apply writes only after reviewed digest, approved target identity, and zero-blocker validation.')
    return 0
  }
  if (!parsed.mappingPath || !parsed.digest || !parsed.targetIdentity || !parsed.appliedBy) {
    throw new Error(USAGE)
  }

  const readMapping = options.readMapping ?? (async (path: string) => readFile(path, 'utf8'))
  const mapping = await loadMapping(readMapping, parsed.mappingPath)
  const digest = computeReviewedOrganizationMappingDigest(mapping)
  if (parsed.digest !== digest) {
    throw new Error(`Stale organization mapping digest: expected ${digest} but received ${parsed.digest}`)
  }

  const inventory = options.readInventory
    ? await options.readInventory()
    : await readInventoryFromPrisma()
  const report = buildOrganizationImportReport({ mapping, ...inventory })
  if (report.blockingReasons.length > 0) {
    print('Organization mapping apply blocked:')
    for (const reason of report.blockingReasons) print(reason)
    return 2
  }

  if (!parsed.apply) {
    print('Organization mapping apply dry-run found no blockers. Re-run with --apply from the authorized release process to write.')
    return 0
  }

  const applyOptions = {
    appliedBy: parsed.appliedBy,
    targetIdentity: parsed.targetIdentity,
    expectedDigest: digest,
  }
  if (options.createWriteTx) {
    await applyReviewedOrganizationMapping(await options.createWriteTx(), mapping, applyOptions)
  } else {
    await runPrismaApplyTransaction((tx) => applyReviewedOrganizationMapping(tx, mapping, applyOptions))
  }
  print('Organization mapping apply committed the reviewed digest.')
  return 0
}

async function runPrismaApplyTransaction(
  work: (tx: OrganizationMappingApplyTx) => Promise<unknown>,
): Promise<void> {
  const { PrismaClient } = await import('@prisma/client')
  const client = new PrismaClient()
  try {
    await client.$transaction(async (tx) => {
      await work(tx as unknown as OrganizationMappingApplyTx)
    })
  } finally {
    await client.$disconnect()
  }
}

async function readInventoryFromPrisma(): Promise<LegacyOrganizationInventory> {
  const { PrismaClient } = await import('@prisma/client')
  const client = new PrismaClient()
  try {
    const [departments, users, externalApprovers] = await Promise.all([
      client.departments.findMany({ select: { id: true, name: true, type: true } }),
      client.user.findMany({ select: { id: true, departmentId: true, level: true, isActive: true } }),
      client.department_approvers.findMany({ select: { id: true, approverId: true, departmentId: true, approverLevel: true } }),
    ])
    return {
      legacyDepartments: departments,
      legacyUsers: users,
      legacyExternalApprovers: externalApprovers,
    }
  } finally {
    await client.$disconnect()
  }
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  return runApplyReviewedOrganizationMapping({ argv })
}

const invokedAsScript = typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (invokedAsScript) {
  void main().then((code) => { process.exitCode = code }).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
