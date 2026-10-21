// Clean-start organization domain model (Plan A Task 2).
// Pure data shapes consumed by hierarchy/assignments/sharing/reporting-path
// modules. Imports nothing from the legacy organization modules.

export interface OrganizationUnitNode {
  id: string
  name: string
  /** null only for the single company root */
  parentId: string | null
  isActive: boolean
  shareRequests: boolean
  canWorkOnSolutions: boolean
  managerUserId: string | null
}

export interface PositionNode {
  id: string
  name: string
  rank: number
  isActive: boolean
}

export interface AssignmentNode {
  id: string
  userId: string
  unitId: string
  positionId: string
  teamId: string | null
  isActive: boolean
}

export interface TeamNode {
  id: string
  unitId: string
  name: string
  reportsToAssignmentId: string
  isActive: boolean
}

export interface ReportingPathStep {
  kind: 'TEAM_REPORTS_TO' | 'UNIT_MANAGER'
  unitId: string
  assignmentId: string
  userId: string
  positionId: string
}

export interface ReportingPath {
  originUserId: string
  assignmentId: string
  unitId: string
  positionId: string
  teamId: string | null
  /** [own unit, parent, ..., root] */
  unitPath: readonly string[]
  /** ordered persons, deduplicated */
  steps: readonly ReportingPathStep[]
}
