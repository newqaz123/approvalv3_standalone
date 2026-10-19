import type { AssignmentNode, OrganizationUnitNode, PositionNode, ReportingPath } from '@/lib/organization/model'
import type { ApprovalPhase, ApprovalRouteVersionDefinition } from '@/lib/approval-routes/definition'

export const BUSINESS_FIXTURE_ID = 'business-workflow-test-only'

export const BUSINESS_POSITIONS = {
  staff: 'position-staff',
  supervisor: 'position-supervisor',
  sectionManager: 'position-section-manager',
  departmentManager: 'position-department-manager',
  // TEST-ONLY dedicated anchor position for the T18C2 isolated vacancy
  // branch: rank 2 (strictly above staff rank 1, so it legally heads
  // team-vacancy-branch), yet it is required by NO approval route step —
  // exact-position candidate matching therefore leaves every step vacant.
  vacancyAnchor: 'position-vacancy-anchor',
} as const

export const BUSINESS_UNITS = {
  company: 'unit-company',
  production: 'unit-production-1',
  productionSection: 'unit-production-1-section',
  engineering: 'unit-engineering',
  engineeringSection: 'unit-engineering-section',
  siblingSection: 'unit-sibling-section',
  vacancyBranch: 'unit-vacancy-branch',
} as const

export type BusinessActorName =
  | 'requesterA'
  | 'staffB'
  | 'supervisorP'
  | 'sectionManagerP'
  | 'departmentManager'
  | 'engineerA'
  | 'supervisorE'
  | 'sectionManagerE'
  | 'staffC'
  // TEST-ONLY structural anchor (see actors.siblingSupervisor below): exists
  // solely so team-sibling has a valid same-unit reports-to assignment.
  | 'siblingSupervisor'
  // TEST-ONLY structural anchor for the T18C2 isolated vacancy branch: the
  // active same-unit reports-to for team-vacancy-branch on the dedicated
  // position-vacancy-anchor (never a route step, so never a candidate).
  | 'vacancyAnchor'
  | 'admin'
  | 'inactiveUser'
  | 'unassignedUser'
  | 'secondApprover'
  | 'staffVacantSup'
  | 'staffVacantAll'
  | 'inactiveSectionManager'

export interface BusinessActor {
  id: string
  name: string
  assignment: AssignmentNode | null
  role: 'USER' | 'ADMIN'
  isActive: boolean
}

export interface BusinessWorkflowFixture {
  id: typeof BUSINESS_FIXTURE_ID
  positions: readonly PositionNode[]
  units: readonly OrganizationUnitNode[]
  actors: Readonly<Record<BusinessActorName, BusinessActor>>
  paths: Readonly<
    Record<'requesterA' | 'supervisorP' | 'engineerA' | 'staffVacantSup' | 'staffVacantAll', ReportingPath>
  >
  routeConfigurations: Readonly<Record<BusinessRouteConfigurationName, BusinessRouteConfiguration>>
}

export type BusinessRouteConfigurationName =
  | 'all-defaults'
  | 'solution-exception'
  | 'final-exception'
  | 'solution-and-final-exceptions'

export interface BusinessRouteConfiguration {
  name: BusinessRouteConfigurationName
  routes: readonly ApprovalRouteVersionDefinition[]
  expectedSources: Readonly<Record<ApprovalPhase, 'COMPANY_DEFAULT' | 'UNIT_EXCEPTION'>>
}

const position = (id: string, name: string, rank: number): PositionNode => ({
  id,
  name,
  rank,
  isActive: true,
})

const unit = (
  id: string,
  name: string,
  parentId: string | null,
  canWorkOnSolutions: boolean,
  shareRequests = true,
): OrganizationUnitNode => ({
  id,
  name,
  parentId,
  isActive: true,
  shareRequests,
  canWorkOnSolutions,
  managerUserId: null,
})

const route = (input: {
  id: string
  scopeUnitId: string
  phase: ApprovalPhase
  steps: readonly string[]
  version?: number
}): ApprovalRouteVersionDefinition => ({
  id: input.id,
  scopeUnitId: input.scopeUnitId,
  phase: input.phase,
  version: input.version ?? 1,
  approvalLimitPositionId: BUSINESS_POSITIONS.departmentManager,
  status: 'PUBLISHED',
  steps: input.steps.map((positionId, index) => ({ order: index + 1, positionId })),
})

const DEFAULT_REQUEST_STEPS = [
  BUSINESS_POSITIONS.supervisor,
  BUSINESS_POSITIONS.sectionManager,
  BUSINESS_POSITIONS.departmentManager,
] as const
const DEFAULT_SOLUTION_STEPS = DEFAULT_REQUEST_STEPS
const DEFAULT_FINAL_STEPS = [BUSINESS_POSITIONS.sectionManager, BUSINESS_POSITIONS.departmentManager] as const
const SOLUTION_EXCEPTION_STEPS = [BUSINESS_POSITIONS.sectionManager, BUSINESS_POSITIONS.departmentManager] as const
const FINAL_EXCEPTION_STEPS = [BUSINESS_POSITIONS.departmentManager] as const

function routesFor(
  name: BusinessRouteConfigurationName,
): BusinessRouteConfiguration {
  const solutionException = name === 'solution-exception' || name === 'solution-and-final-exceptions'
  const finalException = name === 'final-exception' || name === 'solution-and-final-exceptions'
  const routes: ApprovalRouteVersionDefinition[] = [
    route({ id: `${name}-request-default`, scopeUnitId: BUSINESS_UNITS.company, phase: 'REQUEST', steps: DEFAULT_REQUEST_STEPS }),
    route({
      id: `${name}-solution-default`,
      scopeUnitId: BUSINESS_UNITS.company,
      phase: 'SOLUTION',
      steps: DEFAULT_SOLUTION_STEPS,
    }),
    route({ id: `${name}-final-default`, scopeUnitId: BUSINESS_UNITS.company, phase: 'FINAL', steps: DEFAULT_FINAL_STEPS }),
  ]
  if (solutionException) {
    routes.push(route({
      id: `${name}-solution-exception`,
      scopeUnitId: BUSINESS_UNITS.engineeringSection,
      phase: 'SOLUTION',
      steps: SOLUTION_EXCEPTION_STEPS,
    }))
  }
  if (finalException) {
    routes.push(route({
      id: `${name}-final-exception`,
      scopeUnitId: BUSINESS_UNITS.productionSection,
      phase: 'FINAL',
      steps: FINAL_EXCEPTION_STEPS,
    }))
  }
  return {
    name,
    routes,
    expectedSources: {
      REQUEST: 'COMPANY_DEFAULT',
      SOLUTION: solutionException ? 'UNIT_EXCEPTION' : 'COMPANY_DEFAULT',
      FINAL: finalException ? 'UNIT_EXCEPTION' : 'COMPANY_DEFAULT',
    },
  }
}

function actor(
  name: string,
  id: string,
  assignment: AssignmentNode | null,
  role: 'USER' | 'ADMIN' = 'USER',
  isActive = true,
): BusinessActor {
  return { id, name, assignment, role, isActive }
}

function pathFor(
  originUserId: string,
  assignment: AssignmentNode,
  unitPath: readonly string[],
  steps: ReportingPath['steps'],
): ReportingPath {
  return {
    originUserId,
    assignmentId: assignment.id,
    unitId: assignment.unitId,
    positionId: assignment.positionId,
    teamId: assignment.teamId,
    unitPath,
    steps,
  }
}

export function createBusinessWorkflowFixture(): BusinessWorkflowFixture {
  const positions = [
    position(BUSINESS_POSITIONS.staff, 'Staff', 1),
    position(BUSINESS_POSITIONS.supervisor, 'Supervisor', 2),
    position(BUSINESS_POSITIONS.sectionManager, 'Section manager', 3),
    position(BUSINESS_POSITIONS.departmentManager, 'Department manager', 4),
    position(BUSINESS_POSITIONS.vacancyAnchor, 'Vacancy anchor', 2),
  ] as const
  const units = [
    unit(BUSINESS_UNITS.company, 'Company', null, false),
    unit(BUSINESS_UNITS.production, 'Production 1', BUSINESS_UNITS.company, false),
    unit(BUSINESS_UNITS.productionSection, 'Production 1 Section', BUSINESS_UNITS.production, false),
    // TEST-hierarchy adjustment: Engineering hangs UNDER Production 1 (the
    // department unit whose manager is the Department manager position
    // holder) instead of directly under Company. That makes Production 1 the
    // COMMON PARENT DEPARTMENT of both workflow sections, so the real
    // resolveReportingPath legitimately ends BOTH the Production 1 requester
    // path and the Engineering solution path at the Department manager — no
    // faked cross-tree step (the old fixture pointed an Engineering step at
    // the Department manager while claiming unit-company, which the real
    // resolver can never produce). Solution capability stays Engineering-only
    // via canWorkOnSolutions flags, which are unchanged.
    //
    // TEST-only sharing configuration (src/lib/organization/sharing.ts):
    // a viewer's scope is the subtree of their nearest sharing-enabled
    // self-or-ancestor unit. The Engineering units deliberately OPT OUT of
    // own sharing (shareRequests: false) so Engineering members inherit the
    // Production 1 sharing scope and can VIEW Production 1 Section requests
    // — required for the confirmed T03/T04 positive solution flows (an
    // Engineering user must see the request to open the routed Submit
    // Solution modal). Request-CREATION rights are assignment-based
    // (canSubmitRequests) and are unaffected: every section keeps them.
    // "Sharing off inherits the nearest active sharing-enabled ancestor; it
    // does not mean private" — the nearest sharing-enabled ancestor here is
    // Production 1 (shareRequests: true).
    unit(BUSINESS_UNITS.engineering, 'Engineering', BUSINESS_UNITS.production, true, false),
    unit(BUSINESS_UNITS.engineeringSection, 'Engineering Section', BUSINESS_UNITS.engineering, true, false),
    unit(BUSINESS_UNITS.siblingSection, 'Sibling Section', BUSINESS_UNITS.production, false),
    // TEST-ONLY isolated vacancy branch (T18C2): managerless unit directly
    // under the (also managerless) company root with sharing and solution
    // capability off, so nothing about it leaks into any workflow scope. Its
    // only members are staffVacantAll plus their same-unit anchor; the real
    // reporting path is exactly one TEAM_REPORTS_TO step (no ancestor ever
    // contributes a manager step), and the anchor's dedicated position never
    // matches a route step position — every chain step stays VACANT_POSITION.
    unit(BUSINESS_UNITS.vacancyBranch, 'Vacancy Branch', BUSINESS_UNITS.company, false, false),
  ] as const
  const assignment = (id: string, userId: string, unitId: string, positionId: string, teamId: string | null = null): AssignmentNode => ({
    id,
    userId,
    unitId,
    positionId,
    teamId,
    isActive: true,
  })
  const requesterAssignment = assignment('assignment-requester-a', 'user-requester-a', BUSINESS_UNITS.productionSection, BUSINESS_POSITIONS.staff, 'team-production')
  const supervisorPAssignment = assignment('assignment-supervisor-p', 'user-supervisor-p', BUSINESS_UNITS.productionSection, BUSINESS_POSITIONS.supervisor, 'team-production')
  const sectionPAssignment = assignment('assignment-section-manager-p', 'user-section-manager-p', BUSINESS_UNITS.productionSection, BUSINESS_POSITIONS.sectionManager)
  const departmentAssignment = assignment('assignment-department-manager', 'user-department-manager', BUSINESS_UNITS.production, BUSINESS_POSITIONS.departmentManager)
  const engineerAssignment = assignment('assignment-engineer-a', 'user-engineer-a', BUSINESS_UNITS.engineeringSection, BUSINESS_POSITIONS.staff, 'team-engineering')
  const supervisorEAssignment = assignment('assignment-supervisor-e', 'user-supervisor-e', BUSINESS_UNITS.engineeringSection, BUSINESS_POSITIONS.supervisor, 'team-engineering')
  const sectionEAssignment = assignment('assignment-section-manager-e', 'user-section-manager-e', BUSINESS_UNITS.engineeringSection, BUSINESS_POSITIONS.sectionManager)
  const secondApproverAssignment = assignment('assignment-second-approver', 'user-second-approver', BUSINESS_UNITS.productionSection, BUSINESS_POSITIONS.supervisor, 'team-production')
  const staffBAssignment = assignment('assignment-staff-b', 'user-staff-b', BUSINESS_UNITS.productionSection, BUSINESS_POSITIONS.staff, 'team-production')
  const staffCAssignment = assignment('assignment-staff-c', 'user-staff-c', BUSINESS_UNITS.siblingSection, BUSINESS_POSITIONS.staff, 'team-sibling')
  // TEST-ONLY structural anchor for team-sibling: validateOrganization Rule 4
  // requires a team's reports-to to be an ACTIVE assignment in the SAME unit,
  // and Rule 5 requires a strictly greater rank than every active member
  // (Staff C holds rank 1; Supervisor holds rank 2). This account is NOT a
  // member of any team (teamId stays null), is never a workflow origin, and
  // sits in a unit that is not on any workflow origin's reporting path — it
  // can never surface as an approval candidate in the business flows. The old
  // graph pointed team-sibling at the Department manager, which the real
  // validator rejects (active in unit-production-1, not unit-sibling-section).
  const siblingSupervisorAssignment = assignment('assignment-supervisor-sibling', 'user-supervisor-sibling', BUSINESS_UNITS.siblingSection, BUSINESS_POSITIONS.supervisor)
  // Vacancy scenarios: staff members whose own team holds no supervisors or
  // managers, so eligible approvers can only come from the reporting path.
  const staffVacantSupAssignment = assignment('assignment-staff-vacant-sup', 'user-staff-vacant-sup', BUSINESS_UNITS.productionSection, BUSINESS_POSITIONS.staff, 'team-production-vacant-sup')
  // T18C2 all-steps-vacant scenario: staffVacantAll lives on the ISOLATED
  // vacancy branch. Their real path is exactly [TEAM_REPORTS_TO anchor] — the
  // anchor holds the dedicated position-vacancy-anchor (rank 2, same unit,
  // teamId null), which no published route step requires, so the engine's
  // exact-position candidate selection finds nobody for any step.
  const staffVacantAllAssignment = assignment('assignment-staff-vacant-all', 'user-staff-vacant-all', BUSINESS_UNITS.vacancyBranch, BUSINESS_POSITIONS.staff, 'team-vacancy-branch')
  const vacancyAnchorAssignment = assignment('assignment-vacancy-anchor', 'user-vacancy-anchor', BUSINESS_UNITS.vacancyBranch, BUSINESS_POSITIONS.vacancyAnchor)
  const inactiveSectionManagerAssignment = {
    ...assignment('assignment-section-manager-vacant', 'user-section-manager-inactive', BUSINESS_UNITS.productionSection, BUSINESS_POSITIONS.sectionManager, 'team-production'),
    isActive: false,
  }
  const actors: Record<BusinessActorName, BusinessActor> = {
    requesterA: actor('Requester A', requesterAssignment.userId, requesterAssignment),
    staffB: actor('Staff B', staffBAssignment.userId, staffBAssignment),
    supervisorP: actor('Supervisor P', supervisorPAssignment.userId, supervisorPAssignment),
    sectionManagerP: actor('Section manager P', sectionPAssignment.userId, sectionPAssignment),
    departmentManager: actor('Department manager', departmentAssignment.userId, departmentAssignment),
    engineerA: actor('Engineer A', engineerAssignment.userId, engineerAssignment),
    supervisorE: actor('Supervisor E', supervisorEAssignment.userId, supervisorEAssignment),
    sectionManagerE: actor('Section manager E', sectionEAssignment.userId, sectionEAssignment),
    staffC: actor('Staff C', staffCAssignment.userId, staffCAssignment),
    siblingSupervisor: actor('Sibling supervisor (structural anchor)', siblingSupervisorAssignment.userId, siblingSupervisorAssignment),
    vacancyAnchor: actor('Vacancy branch anchor', vacancyAnchorAssignment.userId, vacancyAnchorAssignment),
    admin: actor('Admin', 'user-admin', null, 'ADMIN'),
    inactiveUser: actor('Inactive user', 'user-inactive', { ...requesterAssignment, id: 'assignment-inactive', userId: 'user-inactive', isActive: false }, 'USER', false),
    unassignedUser: actor('Unassigned user', 'user-unassigned', null),
    secondApprover: actor('Second eligible approver', secondApproverAssignment.userId, secondApproverAssignment),
    staffVacantSup: actor('Staff with vacant supervisor', staffVacantSupAssignment.userId, staffVacantSupAssignment),
    staffVacantAll: actor('Staff with all steps vacant', staffVacantAllAssignment.userId, staffVacantAllAssignment),
    inactiveSectionManager: actor('Inactive section manager', inactiveSectionManagerAssignment.userId, inactiveSectionManagerAssignment, 'USER', false),
  }
  // The mocked paths below mirror EXACTLY what the real resolveReportingPath
  // returns over the seeded graph (tests/regression/business-organization-validation.test.ts
  // locks the equality): a team member's first step is the team's reports-to
  // person (TEAM_REPORTS_TO), then each ancestor unit's manager
  // (UNIT_MANAGER), deduplicated by userId, with inactive holders never
  // emitted as steps.
  const departmentStep = { kind: 'UNIT_MANAGER' as const, unitId: BUSINESS_UNITS.production, assignmentId: departmentAssignment.id, userId: departmentAssignment.userId, positionId: departmentAssignment.positionId }
  const requesterSteps = [
    { kind: 'TEAM_REPORTS_TO' as const, unitId: BUSINESS_UNITS.productionSection, assignmentId: sectionPAssignment.id, userId: sectionPAssignment.userId, positionId: sectionPAssignment.positionId },
    departmentStep,
  ]
  const supervisorSteps = requesterSteps
  const vacantSupervisorSteps = requesterSteps
  // T18C2 REAL all-vacant path: the only step is the team's same-unit anchor
  // on the dedicated position-vacancy-anchor. This object IS asserted
  // against the real resolveReportingPath over the seeded graph
  // (business-organization-validation.test.ts locks the deep-equality): the
  // anchor is active, so the resolver legitimately emits it; vacancy comes
  // from exact-position mismatch, not from an inactive holder.
  const allVacantSteps = [
    {
      kind: 'TEAM_REPORTS_TO' as const,
      unitId: BUSINESS_UNITS.vacancyBranch,
      assignmentId: vacancyAnchorAssignment.id,
      userId: vacancyAnchorAssignment.userId,
      positionId: vacancyAnchorAssignment.positionId,
    },
  ]
  const engineerSteps = [
    { kind: 'TEAM_REPORTS_TO' as const, unitId: BUSINESS_UNITS.engineeringSection, assignmentId: sectionEAssignment.id, userId: sectionEAssignment.userId, positionId: sectionEAssignment.positionId },
    departmentStep,
  ]
  const paths = {
    requesterA: pathFor(requesterAssignment.userId, requesterAssignment, [BUSINESS_UNITS.productionSection, BUSINESS_UNITS.production, BUSINESS_UNITS.company], requesterSteps),
    supervisorP: pathFor(supervisorPAssignment.userId, supervisorPAssignment, [BUSINESS_UNITS.productionSection, BUSINESS_UNITS.production, BUSINESS_UNITS.company], supervisorSteps),
    engineerA: pathFor(engineerAssignment.userId, engineerAssignment, [BUSINESS_UNITS.engineeringSection, BUSINESS_UNITS.engineering, BUSINESS_UNITS.production, BUSINESS_UNITS.company], engineerSteps),
    staffVacantSup: pathFor(staffVacantSupAssignment.userId, staffVacantSupAssignment, [BUSINESS_UNITS.productionSection, BUSINESS_UNITS.production, BUSINESS_UNITS.company], vacantSupervisorSteps),
    staffVacantAll: pathFor(staffVacantAllAssignment.userId, staffVacantAllAssignment, [BUSINESS_UNITS.vacancyBranch, BUSINESS_UNITS.company], allVacantSteps),
  } as const
  return {
    id: BUSINESS_FIXTURE_ID,
    positions,
    units,
    actors,
    paths,
    routeConfigurations: {
      'all-defaults': routesFor('all-defaults'),
      'solution-exception': routesFor('solution-exception'),
      'final-exception': routesFor('final-exception'),
      'solution-and-final-exceptions': routesFor('solution-and-final-exceptions'),
    },
  }
}

export const BUSINESS_ROUTE_CONFIGURATION_NAMES: readonly BusinessRouteConfigurationName[] = [
  'all-defaults',
  'solution-exception',
  'final-exception',
  'solution-and-final-exceptions',
]
