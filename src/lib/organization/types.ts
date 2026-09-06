export const ORGANIZATION_POSITION_LEVEL = {
  STAFF: 1,
  SUPERVISOR: 2,
  SECTION_MANAGER: 3,
  DEPARTMENT_MANAGER: 4,
  DIVISION_MANAGER: 5,
  FACTORY_MANAGER: 6,
} as const

export type OrganizationPositionCode = keyof typeof ORGANIZATION_POSITION_LEVEL
export type OrganizationUnitType = 'FACTORY' | 'DIVISION' | 'DEPARTMENT' | 'SECTION'
export type OrganizationPositionLevel = 1 | 2 | 3 | 4 | 5 | 6

export interface OrganizationUnitNode { id: string; name: string; unitType: OrganizationUnitType; parentId: string | null; isActive: boolean }
export interface OrganizationPositionAssignment { id: string; userId: string; unitId: string; positionCode: OrganizationPositionCode; reportingGroupId: string | null; isPrimary: boolean; isActive: boolean }
export interface ReportingGroupNode { id: string; unitId: string; parentGroupId: string | null; name: string; isActive: boolean }
export interface ReportingBranch { originUserId: string; primaryUnitId: string; primaryAssignmentId: string; primaryPosition: OrganizationPositionCode; unitPath: readonly string[]; groupPath: readonly string[] }
