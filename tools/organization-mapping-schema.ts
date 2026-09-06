import { z } from 'zod'
import { validateReviewedOrganizationMapping } from '../src/lib/organization/mapping'

const unique = <T>(rows: readonly T[], key: (row: T) => string): boolean => {
  const keys = rows.map(key)
  return new Set(keys).size === keys.length
}

const positionCode = z.enum(['STAFF', 'SUPERVISOR', 'SECTION_MANAGER', 'DEPARTMENT_MANAGER', 'DIVISION_MANAGER', 'FACTORY_MANAGER'])

export const reviewedOrganizationMappingSchema = z.object({
  units: z.array(z.object({
    id: z.string().uuid(),
    name: z.string().trim().min(1),
    unitType: z.enum(['FACTORY', 'DIVISION', 'DEPARTMENT', 'SECTION']),
    parentId: z.string().uuid().nullable(),
  })).min(1).refine((rows) => unique(rows, (row) => row.id), 'unit IDs must be unique'),
  departments: z.array(z.object({
    legacyDepartmentId: z.string().uuid(),
    targetUnitId: z.string().uuid(),
    engineeringClassification: z.enum(['GENERAL', 'ENGINEERING']),
    disposition: z.enum(['REAL_SECTION', 'LEGACY_MANAGER_CONTAINER']),
  })).min(1).refine((rows) => unique(rows, (row) => row.legacyDepartmentId), 'legacy department IDs must be unique'),
  positionAssignments: z.array(z.object({
    userId: z.string().uuid(),
    unitId: z.string().uuid(),
    positionCode,
    reportingGroupId: z.string().uuid().nullable(),
    isPrimary: z.boolean(),
  })).refine((rows) => unique(rows, (row) => `${row.userId}:${row.unitId}:${row.positionCode}`), 'position assignments must be unique'),
  reportingGroups: z.array(z.object({
    id: z.string().uuid(),
    unitId: z.string().uuid(),
    parentGroupId: z.string().uuid().nullable(),
    name: z.string().trim().min(1),
    memberUserIds: z.array(z.string().uuid()).refine((ids) => new Set(ids).size === ids.length, 'group member IDs must be unique'),
  })).refine((rows) => unique(rows, (row) => row.id), 'reporting-group IDs must be unique'),
  externalApprovers: z.array(z.object({
    legacyDepartmentApproverId: z.string().uuid(),
    userId: z.string().uuid(),
    targetUnitId: z.string().uuid(),
    disposition: z.enum(['PARENT_SCOPE', 'CUSTOM_ONLY', 'LEGACY_ONLY']),
    positionCode,
  })).refine((rows) => unique(rows, (row) => row.legacyDepartmentApproverId), 'external approver IDs must be unique'),
  legacyLevelMappings: z.array(z.object({
    legacyLevel: z.number().int().min(1).max(10),
    positionCode: positionCode.nullable(),
  })).refine((rows) => new Set(rows.map((row) => row.legacyLevel)).size === rows.length, 'legacy levels must be unique'),
})

export type ReviewedOrganizationMapping = z.infer<typeof reviewedOrganizationMappingSchema>

export function parseReviewedOrganizationMapping(input: unknown): ReviewedOrganizationMapping {
  const mapping = reviewedOrganizationMappingSchema.parse(input)
  validateReviewedOrganizationMapping(mapping)
  return mapping
}
