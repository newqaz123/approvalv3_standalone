import { readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { parseReviewedOrganizationMapping, type ReviewedOrganizationMapping } from '../tools/organization-mapping-schema'

export interface LegacyDepartmentRow { id: string; name: string; type: 'GENERAL' | 'ENGINEERING' }
export interface LegacyUserRow { id: string; departmentId: string | null; level: number | null; isActive: boolean }
export interface LegacyExternalApproverRow { id: string; approverId: string; departmentId: string; approverLevel: number }
export interface LegacyOrganizationInventory {
  legacyDepartments: LegacyDepartmentRow[]
  legacyUsers: LegacyUserRow[]
  legacyExternalApprovers: LegacyExternalApproverRow[]
}

export interface OrganizationImportReport {
  mappedDepartmentCount: number
  mappedUserCount: number
  mappedExternalApproverCount: number
  unmappedDepartmentIds: string[]
  unmappedUserIds: string[]
  blockingReasons: string[]
  wouldCreateUnits: number
  wouldCreateAssignments: number
  wouldCreateReportingGroups: number
}

export interface OrganizationImportReadRepository { readLegacyRows(): Promise<LegacyOrganizationInventory> }
export interface OrganizationImportDryRunOptions {
  argv: readonly string[]
  repository: OrganizationImportReadRepository
  readMapping?: (path: string) => Promise<string | unknown>
  writeReport?: (path: string, report: OrganizationImportReport) => Promise<void>
  print?: (line: string) => void
}

function parseArguments(argv: readonly string[]): { mappingPath: string; reportPath: string } {
  let mappingPath: string | undefined
  let reportPath: string | undefined
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (flag === '--mapping' || flag === '--out') {
      const value = argv[++index]
      if (!value || value.startsWith('--')) throw new Error(`${flag} requires a path`)
      if (flag === '--mapping') mappingPath = value
      else reportPath = value
    } else {
      throw new Error(`Unknown argument: ${flag}`)
    }
  }
  if (!mappingPath || !reportPath) throw new Error('Usage: --mapping <reviewed-file> --out <report-file>')
  return { mappingPath, reportPath }
}

export function buildOrganizationImportReport(input: {
  mapping: ReviewedOrganizationMapping
  legacyDepartments: LegacyDepartmentRow[]
  legacyUsers: LegacyUserRow[]
  legacyExternalApprovers: LegacyExternalApproverRow[]
}): OrganizationImportReport {
  const { mapping, legacyDepartments, legacyUsers, legacyExternalApprovers } = input
  const mappedDepartments = new Set(mapping.departments.map((row) => row.legacyDepartmentId))
  const mappedUsers = new Set(mapping.positionAssignments.map((row) => row.userId))
  const mappedExternalApprovers = new Set(mapping.externalApprovers.map((row) => row.legacyDepartmentApproverId))
  const explicitLevels = new Set(mapping.legacyLevelMappings.map((row) => row.legacyLevel))
  const unitsById = new Map(mapping.units.map((unit) => [unit.id, unit]))
  const departmentMappings = new Map(mapping.departments.map((row) => [row.legacyDepartmentId, row]))
  const externalMappings = new Map(mapping.externalApprovers.map((row) => [row.legacyDepartmentApproverId, row]))
  const blockingReasons: string[] = []

  for (const department of legacyDepartments) {
    if (!mappedDepartments.has(department.id)) blockingReasons.push(`DEPARTMENT_NOT_MAPPED:${department.id}`)
    const reviewed = departmentMappings.get(department.id)
    if (reviewed && reviewed.engineeringClassification !== department.type) blockingReasons.push(`DEPARTMENT_CLASSIFICATION_MISMATCH:${department.id}`)
  }
  for (const reviewed of mapping.departments) {
    if (!legacyDepartments.some((department) => department.id === reviewed.legacyDepartmentId)) blockingReasons.push(`LEGACY_DEPARTMENT_NOT_FOUND:${reviewed.legacyDepartmentId}`)
  }

  for (const user of legacyUsers) {
    if (user.isActive && !mappedUsers.has(user.id)) blockingReasons.push(`USER_NOT_MAPPED:${user.id}`)
    if (user.level !== null && !explicitLevels.has(user.level)) blockingReasons.push(`USER_LEVEL_NOT_EXPLICITLY_MAPPED:${user.id}:${user.level}`)
  }
  for (const assignment of mapping.positionAssignments) {
    if (!legacyUsers.some((user) => user.id === assignment.userId)) blockingReasons.push(`USER_MAPPING_NOT_FOUND:${assignment.userId}`)
  }
  for (const group of mapping.reportingGroups) {
    for (const userId of group.memberUserIds) if (!legacyUsers.some((user) => user.id === userId)) blockingReasons.push(`USER_MAPPING_NOT_FOUND:${userId}`)
  }

  for (const approver of legacyExternalApprovers) {
    const reviewed = externalMappings.get(approver.id)
    if (!mappedExternalApprovers.has(approver.id)) blockingReasons.push(`EXTERNAL_APPROVER_NOT_MAPPED:${approver.id}`)
    if (approver.approverLevel < 1 || approver.approverLevel > 10) blockingReasons.push(`EXTERNAL_APPROVER_LEVEL_OUT_OF_RANGE:${approver.id}:${approver.approverLevel}`)
    if (!explicitLevels.has(approver.approverLevel)) blockingReasons.push(`EXTERNAL_APPROVER_LEVEL_NOT_EXPLICITLY_MAPPED:${approver.id}:${approver.approverLevel}`)
    if (!departmentMappings.has(approver.departmentId)) blockingReasons.push(`EXTERNAL_APPROVER_DEPARTMENT_NOT_MAPPED:${approver.id}:${approver.departmentId}`)
    if (reviewed) {
      if (reviewed.userId !== approver.approverId) blockingReasons.push(`EXTERNAL_APPROVER_USER_MISMATCH:${approver.id}`)
      if (reviewed.disposition === 'PARENT_SCOPE') {
        const department = departmentMappings.get(approver.departmentId)
        const source = department ? unitsById.get(department.targetUnitId) : undefined
        const target = unitsById.get(reviewed.targetUnitId)
        const targetIsExplicitAssignment = mapping.positionAssignments.some((assignment) =>
          assignment.userId === reviewed.userId && assignment.unitId === reviewed.targetUnitId && assignment.positionCode === reviewed.positionCode,
        )
        let current = source
        if (source?.unitType === 'SECTION') current = source.parentId ? unitsById.get(source.parentId) : undefined
        let targetIsInReviewedScope = false
        while (current) {
          if (current.id === reviewed.targetUnitId) { targetIsInReviewedScope = true; break }
          current = current.parentId ? unitsById.get(current.parentId) : undefined
        }
        if (!target || target.unitType === 'SECTION' || !targetIsInReviewedScope) blockingReasons.push(`EXTERNAL_APPROVER_PARENT_SCOPE_MISMATCH:${approver.id}`)
        if (!targetIsExplicitAssignment) blockingReasons.push(`EXTERNAL_APPROVER_PARENT_ASSIGNMENT_NOT_MAPPED:${approver.id}`)
      }
    }
    if (reviewed && !legacyUsers.some((user) => user.id === reviewed.userId)) blockingReasons.push(`USER_MAPPING_NOT_FOUND:${reviewed.userId}`)
  }
  for (const reviewed of mapping.externalApprovers) {
    if (!legacyExternalApprovers.some((approver) => approver.id === reviewed.legacyDepartmentApproverId)) blockingReasons.push(`EXTERNAL_APPROVER_NOT_FOUND:${reviewed.legacyDepartmentApproverId}`)
  }

  // Deduplicate only repeated identity diagnostics; preserve inventory ordering.
  const uniqueBlockingReasons = [...new Set(blockingReasons)]
  return {
    mappedDepartmentCount: mapping.departments.length,
    mappedUserCount: mappedUsers.size,
    mappedExternalApproverCount: mapping.externalApprovers.length,
    unmappedDepartmentIds: legacyDepartments.filter((row) => !mappedDepartments.has(row.id)).map((row) => row.id),
    unmappedUserIds: legacyUsers.filter((row) => row.isActive && !mappedUsers.has(row.id)).map((row) => row.id),
    blockingReasons: uniqueBlockingReasons,
    wouldCreateUnits: mapping.units.length,
    wouldCreateAssignments: mapping.positionAssignments.length,
    wouldCreateReportingGroups: mapping.reportingGroups.length,
  }
}

export async function runOrganizationImportDryRun(options: OrganizationImportDryRunOptions): Promise<number> {
  const { mappingPath, reportPath } = parseArguments(options.argv)
  const readMapping = options.readMapping ?? (async (path: string) => readFile(path, 'utf8'))
  const writeReport = options.writeReport ?? (async (path: string, report: OrganizationImportReport) => writeFile(path, `${JSON.stringify(report, null, 2)}\n`, 'utf8'))
  const print = options.print ?? ((line: string) => console.log(line))
  const raw = await readMapping(mappingPath)
  const mapping = parseReviewedOrganizationMapping(typeof raw === 'string' ? JSON.parse(raw) : raw)
  const inventory = await options.repository.readLegacyRows()
  const report = buildOrganizationImportReport({ mapping, ...inventory })
  await writeReport(reportPath, report)
  if (report.blockingReasons.length > 0) {
    print('Organization import dry-run blockers:')
    for (const reason of report.blockingReasons) print(reason)
    return 2
  }
  print('Organization import dry-run found no blockers.')
  return 0
}

async function createReadOnlyLegacyRepository(): Promise<OrganizationImportReadRepository & { close: () => Promise<void> }> {
  const { PrismaClient } = await import('@prisma/client')
  const client = new PrismaClient()
  return {
    async readLegacyRows() {
      const [departments, users, externalApprovers] = await Promise.all([
        client.departments.findMany({ select: { id: true, name: true, type: true } }),
        client.user.findMany({ select: { id: true, departmentId: true, level: true, isActive: true } }),
        client.department_approvers.findMany({ select: { id: true, approverId: true, departmentId: true, approverLevel: true } }),
      ])
      return {
        legacyDepartments: departments as LegacyDepartmentRow[],
        legacyUsers: users as LegacyUserRow[],
        legacyExternalApprovers: externalApprovers as LegacyExternalApproverRow[],
      }
    },
    async close() { await client.$disconnect() },
  }
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  const repository = await createReadOnlyLegacyRepository()
  try {
    return await runOrganizationImportDryRun({ argv, repository })
  } finally {
    await repository.close()
  }
}

const invokedAsScript = typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (invokedAsScript) {
  void main().then((code) => { process.exitCode = code }).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
