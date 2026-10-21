import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  CleanupStepAbsentError,
  StrandedReplacementCleanupError,
  runStrandedReplacementCleanup,
  runStrandedReplacementCleanupGuarded,
  type StrandedReplacementCleanupSteps,
} from '../support/business-t18b-cleanup'
import {
  assembleBusinessDbChecks,
  businessRequestActivitySelectSql,
  captureWorkflowDbEvidence,
  evaluateDefaultWorkflowEvidence,
  evaluateStrandedRestartEvidence,
  type DbEvidenceData,
  type DbEvidenceRow,
  type WorkflowCheck,
} from '../support/native/capture-workflow-db-evidence'
import {
  T18B_RESTART_REASON,
  parseT18bBrowserCorrelation,
  collectCreateRequestObservations,
  readCreateRequestActionId,
  readCreatedRequestIdFromCreateAction,
  selectStrandedRowForRequest,
  type ResponseBodySource,
} from '../support/business-t18b-correlation'
import { decideBusinessEvidenceGate, t18bEvidenceApplies } from '../support/native/business-evidence-gate'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { isAttemptStranded } from '@/lib/approval-engine/decisions'
import { resolveReportingPath } from '@/lib/organization/reporting-path'
import { selectStepCandidates } from '@/lib/approval-engine/candidates'
import {
  restartStrandedAttempt,
  type PhaseAttemptTx,
  type RestartAttemptRecord,
  type RestartStrandedPorts,
} from '@/lib/approval-engine/attempts'
import type { PhaseOrigin } from '@/lib/approval-engine/plan'
import type { ResolvedApprovalRoute } from '@/lib/approval-routes/selection'
import type { ReportingPathRepository } from '@/lib/organization/reporting-path'
import type { AssignmentNode, OrganizationUnitNode, PositionNode, ReportingPath, TeamNode } from '@/lib/organization/model'

/**
 * T18B manager-pointer replacement regressions (Astra-corrected variant).
 *
 * Locks the REAL product seams the corrected T18B scenario depends on:
 *  (reporting path) an extra Department-manager ASSIGNMENT alone never
 *      enters the ancestor path — only the unit's explicit managerUserId
 *      (with an active direct assignment) does;
 *  (B5, live) a NON-captured new active holder does not unstrand the old
 *      snapshot; reactivating a captured member does;
 *  (restart) the old snapshot is preserved (supersededAt only), the Section
 *      vacancy is recorded as a skip, and the replacement is pending with
 *      the SPARE as the live Department-manager candidate;
 *  (cleanup seam) the T18B finally orchestration attempts every feasible
 *      step independently (restore-manager BEFORE spare-assignment removal),
 *      preserves the primary failure, and reports sanitized cleanup
 *      failures.
 */

// ---------------------------------------------------------------------------
// Fixture graph (T18B-shaped): supervisor origin under Production 1 section
// ---------------------------------------------------------------------------

const positions: PositionNode[] = [
  { id: 'p-staff', name: 'Staff', rank: 1, isActive: true },
  { id: 'p-supervisor', name: 'Supervisor', rank: 2, isActive: true },
  { id: 'p-section-manager', name: 'Section manager', rank: 3, isActive: true },
  { id: 'p-department-manager', name: 'Department manager', rank: 4, isActive: true },
  { id: 'p-chief', name: 'Chief', rank: 5, isActive: true },
]

const units = (managerOfProduction: string): OrganizationUnitNode[] => [
  { id: 'unit-company', name: 'Company', parentId: null, isActive: true, managerUserId: 'u-root-mgr', shareRequests: false, canWorkOnSolutions: false },
  { id: 'unit-production-1', name: 'Production 1', parentId: 'unit-company', isActive: true, managerUserId: managerOfProduction, shareRequests: false, canWorkOnSolutions: false },
  { id: 'unit-production-1-section', name: 'Production 1 Section', parentId: 'unit-production-1', isActive: true, managerUserId: 'u-section-p', shareRequests: false, canWorkOnSolutions: false },
]

const baseAssignments = (extraSpareAssignment: boolean): AssignmentNode[] => {
  const rows: AssignmentNode[] = [
    { id: 'a-root-mgr', userId: 'u-root-mgr', unitId: 'unit-company', positionId: 'p-chief', teamId: null, isActive: true },
    { id: 'a-supervisor-p', userId: 'u-supervisor-p', unitId: 'unit-production-1-section', positionId: 'p-supervisor', teamId: 'team-prod-section', isActive: true },
    { id: 'a-section-p', userId: 'u-section-p', unitId: 'unit-production-1-section', positionId: 'p-section-manager', teamId: null, isActive: true },
    { id: 'a-dept', userId: 'u-dept', unitId: 'unit-production-1', positionId: 'p-department-manager', teamId: null, isActive: true },
  ]
  if (extraSpareAssignment) {
    rows.push({ id: 'a-spare', userId: 'u-spare', unitId: 'unit-production-1', positionId: 'p-department-manager', teamId: null, isActive: true })
  }
  return rows
}

const teams: TeamNode[] = [
  { id: 'team-prod-section', unitId: 'unit-production-1-section', name: 'Prod section team', reportsToAssignmentId: 'a-section-p', isActive: true },
]

const users = new Map<string, { name: string; isActive: boolean }>([
  ['u-root-mgr', { name: 'Root manager', isActive: true }],
  ['u-supervisor-p', { name: 'Supervisor P', isActive: true }],
  ['u-section-p', { name: 'Section manager P', isActive: true }],
  ['u-dept', { name: 'Department manager', isActive: true }],
  ['u-spare', { name: 'Unassigned user', isActive: true }],
])

function repo(managerOfProduction: string, extraSpareAssignment: boolean): ReportingPathRepository {
  // NOTE: the path is resolved on the VALID pre-deactivation graph (org
  // validation rejects inactive managers on active units); deactivation is
  // applied afterwards at the CANDIDATE-ACTIVITY layer, exactly like the
  // real stranded query (live user activity, structural snapshot).
  const assignmentRows = baseAssignments(extraSpareAssignment)
  return {
    async findUser(userId) {
      const user = users.get(userId)
      if (!user) return null
      return { id: userId, isActive: user.isActive }
    },
    async loadUnits() {
      return units(managerOfProduction)
    },
    async loadPositions() {
      return positions
    },
    async loadAssignments() {
      return assignmentRows
    },
    async loadTeams() {
      return teams
    },
  }
}

describe('T18B replacement: manager pointer, not assignment presence, selects the ancestor candidate', () => {
  it('an extra Department-manager assignment alone leaves the ORIGINAL manager on the reporting path', async () => {
    const path = await resolveReportingPath('u-supervisor-p', repo('u-dept', true))
    assert.ok(path, 'path resolves')
    const departmentManagerStep = path.steps.find((step) => step.kind === 'UNIT_MANAGER' && step.unitId === 'unit-production-1')
    assert.ok(departmentManagerStep, 'production-1 manager step exists')
    assert.equal(departmentManagerStep.userId, 'u-dept', 'the ORIGINAL manager stays the path step despite the extra assignment')
    assert.ok(!path.steps.some((step) => step.userId === 'u-spare'), 'the extra assignment never enters the path')
  })

  it('with the original inactive, assignment-alone still yields NO live department candidate (vacancy)', async () => {
    // Path resolved on the valid graph; the original manager is then
    // deactivated (candidate-activity layer only — the live B5/stranded
    // query reads user activity the same way).
    const path = await resolveReportingPath('u-supervisor-p', repo('u-dept', true))
    const selected = selectStepCandidates({
      path: path!,
      requiredPositionId: 'p-department-manager',
      ownTeamMemberAssignments: [],
    })
    assert.deepEqual(selected.map((row) => row.userId), ['u-dept'], 'only the path manager is a candidate')
    const activeIds = new Set(['u-spare', 'u-supervisor-p', 'u-section-p'])
    const live = selected.map((row) => row.userId).filter((id) => activeIds.has(id))
    assert.equal(live.length, 0, 'the inactive original yields a vacant step — the spare is NOT a candidate')
  })

  it('moving the Production-1 manager pointer to the spare selects the SPARE (with active direct assignment)', async () => {
    const path = await resolveReportingPath('u-supervisor-p', repo('u-spare', true))
    const departmentManagerStep = path!.steps.find((step) => step.kind === 'UNIT_MANAGER' && step.unitId === 'unit-production-1')
    assert.equal(departmentManagerStep?.userId, 'u-spare', 'the manager pointer selects the spare')
    const selected = selectStepCandidates({
      path: path!,
      requiredPositionId: 'p-department-manager',
      ownTeamMemberAssignments: [],
    })
    assert.deepEqual(selected.map((row) => row.userId), ['u-spare'])
  })
})

describe('T18B replacement: B5 live predicate', () => {
  const snapshotGroups = (sectionActive: boolean, departmentActive: boolean) => [
    {
      members: [
        { userId: 'u-section-p', user: { isActive: sectionActive } },
      ],
    },
    {
      members: [
        { userId: 'u-dept', user: { isActive: departmentActive } },
      ],
    },
  ]

  it('a NON-captured new active holder does not unstrand the old snapshot', () => {
    assert.equal(isAttemptStranded({ candidateGroups: snapshotGroups(false, false) }), true)
  })

  it('reactivating a CAPTURED member unstrands (the run-7 failure mechanism)', () => {
    assert.equal(isAttemptStranded({ candidateGroups: snapshotGroups(false, true) }), false)
  })
})

describe('T18B replacement: cleanup seam v2 (fail-closed, dependency-aware)', () => {
  const recordingSteps = (failures: Partial<Record<keyof StrandedReplacementCleanupSteps, Error>> = {}, absent: keyof StrandedReplacementCleanupSteps | null = null) => {
    const order: string[] = []
    const steps: StrandedReplacementCleanupSteps = {
      async reactivateSectionManager() {
        order.push('reactivate-section-manager')
        const error = failures.reactivateSectionManager
        if (error) throw error
      },
      async reactivateDepartmentManager() {
        order.push('reactivate-department-manager')
        const error = failures.reactivateDepartmentManager
        if (error) throw error
      },
      async restoreOriginalUnitManager() {
        order.push('restore-manager')
        const error = failures.restoreOriginalUnitManager
        if (error) throw error
      },
      async removeTemporarySpareAssignment() {
        order.push('remove-spare-assignment')
        if (absent === 'removeTemporarySpareAssignment') throw new CleanupStepAbsentError('remove-spare-assignment')
        const error = failures.removeTemporarySpareAssignment
        if (error) throw error
      },
      async verifyRestoration() {
        order.push('verify-restoration')
        const error = failures.verifyRestoration
        if (error) throw error
      },
    }
    return { steps, order }
  }

  it('happy path: independent reactivations, manager restored, assignment removed, verified', async () => {
    const { steps, order } = recordingSteps()
    const outcome = await runStrandedReplacementCleanup(steps)
    assert.deepEqual(order, ['reactivate-section-manager', 'reactivate-department-manager', 'restore-manager', 'remove-spare-assignment', 'verify-restoration'])
    assert.equal(outcome.completed, true)
    assert.deepEqual(outcome.failures, [])
    assert.equal(outcome.blocked, null)
  })

  it('EACH original reactivates independently: one failure never skips the other', async () => {
    const { steps, order } = recordingSteps({ reactivateSectionManager: new Error('Target page, context or browser has been closed') })
    const outcome = await runStrandedReplacementCleanup(steps)
    assert.deepEqual(order, ['reactivate-section-manager', 'reactivate-department-manager', 'restore-manager', 'remove-spare-assignment', 'verify-restoration'])
    assert.deepEqual(outcome.failures, [{ step: 'reactivate-section-manager', category: 'target-closed' }])
    assert.equal(outcome.completed, false)
  })

  it('manager-restoration failure BLOCKS assignment removal (retained), verification still runs, cleanup fails', async () => {
    const { steps, order } = recordingSteps({ restoreOriginalUnitManager: new Error('restore boom') })
    const outcome = await runStrandedReplacementCleanup(steps)
    assert.deepEqual(order, ['reactivate-section-manager', 'reactivate-department-manager', 'restore-manager', 'verify-restoration'])
    assert.ok(!order.includes('remove-spare-assignment'), 'unsafe removal must NOT be attempted')
    assert.deepEqual(outcome.blocked, { step: 'remove-spare-assignment', reason: 'original-manager-restoration-failed' })
    assert.equal(outcome.completed, false)
  })

  it('"already absent" assignment is distinguished from a removal failure (not a failure)', async () => {
    const { steps } = recordingSteps({}, 'removeTemporarySpareAssignment')
    const outcome = await runStrandedReplacementCleanup(steps)
    assert.deepEqual(outcome.absent, ['remove-spare-assignment'])
    assert.deepEqual(outcome.failures, [])
    assert.equal(outcome.completed, true)
  })

  it('standalone cleanup failure (no primary) THROWS; the primary is rethrown when one exists', async () => {
    const primary = new Error('denial assertion failed')
    const failing = recordingSteps({ restoreOriginalUnitManager: new Error('nope') })
    // With a primary: guarded run must rethrow the PRIMARY (never the cleanup error).
    await assert.rejects(
      runStrandedReplacementCleanupGuarded(failing.steps, { primary, hasPrimary: true }),
      (error: unknown) => error === primary,
    )
    // Without a primary: standalone cleanup failure throws.
    await assert.rejects(
      runStrandedReplacementCleanupGuarded(failing.steps),
      (error: unknown) => error instanceof StrandedReplacementCleanupError && error.outcome.blocked !== null,
    )
    // Happy cleanup without primary resolves.
    const ok = recordingSteps()
    await runStrandedReplacementCleanupGuarded(ok.steps, {})
  })

  it('evidence/reporting failure neither stops restoration nor masks the primary error', async () => {
    const primary = new Error('primary failure')
    const { steps, order } = recordingSteps()
    const reported: unknown[] = []
    await assert.rejects(
      runStrandedReplacementCleanupGuarded(steps, {
        primary,
        hasPrimary: true,
        report: async () => {
          reported.push(1)
          throw new Error('evidence write failed')
        },
      }),
      (error: unknown) => error === primary,
    )
    assert.deepEqual(order, ['reactivate-section-manager', 'reactivate-department-manager', 'restore-manager', 'remove-spare-assignment', 'verify-restoration'])
    assert.equal(reported.length, 1, 'reporting was attempted (best-effort)')
    // Standalone: reporting failure must NOT invent a cleanup failure.
    const ok = recordingSteps()
    await runStrandedReplacementCleanupGuarded(ok.steps, {
      report: async () => {
        throw new Error('evidence write failed')
      },
    })
  })

  it('sign-in harness failure rethrows the primary and does not skip the other original when the session does run', async () => {
    const primary = new Error('scenario failed')
    const { steps, order } = recordingSteps()
    await assert.rejects(
      runStrandedReplacementCleanupGuarded(steps, {
        primary,
        hasPrimary: true,
        enter: async () => {
          throw new Error('sign-in failed')
        },
      }),
      (error: unknown) => error === primary,
    )
    assert.deepEqual(order, [], 'sign-in failure cannot run steps, but must not replace the primary')

    const ran: string[] = []
    const independent = recordingSteps({ reactivateSectionManager: new Error('section activate failed') })
    await assert.rejects(
      runStrandedReplacementCleanupGuarded(independent.steps, {
        primary,
        hasPrimary: true,
        enter: async (run) => {
          ran.push('session')
          await run()
        },
      }),
      (error: unknown) => error === primary,
    )
    assert.deepEqual(ran, ['session'])
    assert.deepEqual(independent.order, ['reactivate-section-manager', 'reactivate-department-manager', 'restore-manager', 'remove-spare-assignment', 'verify-restoration'])
  })

  it('standalone sign-in failure is the thrown error; evidence failure after a successful session is not', async () => {
    const { steps } = recordingSteps()
    await assert.rejects(
      runStrandedReplacementCleanupGuarded(steps, {
        enter: async () => {
          throw new Error('sign-in failed')
        },
      }),
      /sign-in failed/,
    )
    const ok = recordingSteps()
    await runStrandedReplacementCleanupGuarded(ok.steps, {
      enter: async (run) => {
        await run()
      },
      report: async () => {
        throw new Error('checkpoint write failed')
      },
    })
    assert.deepEqual(ok.order, ['reactivate-section-manager', 'reactivate-department-manager', 'restore-manager', 'remove-spare-assignment', 'verify-restoration'])
  })

  it('cleanup failures are sanitized: no raw error text in outcomes', async () => {
    const { steps } = recordingSteps({
      removeTemporarySpareAssignment: new Error('{"password":"hunter2"} /tmp/private-token/worker.ts:12:34'),
    })
    const outcome = await runStrandedReplacementCleanup(steps)
    const text = JSON.stringify(outcome)
    for (const forbidden of ['hunter2', '/tmp/private-token', 'worker.ts', 'password']) {
      assert.ok(!text.includes(forbidden), `cleanup outcome must never contain ${forbidden}`)
    }
  })
})

describe('T18B replacement: stranded-restart evidence evaluator (real evaluation, negatives included)', () => {
  const REASON = T18B_RESTART_REASON
  const EXACT_TITLE = 'Business T18B 1789800000000-1'
  const input = (): Parameters<typeof evaluateStrandedRestartEvidence>[1] => ({
    titlePrefix: 'Business T18B',
    exactTitle: EXACT_TITLE,
    recordedRequestId: 'req-1',
    recordedOldInstanceId: 'inst-old',
    oldInstance: {
      attempt: 1,
      originUserId: 'user-supervisor-p',
      groups: [
        ['position-section-manager', ['user-section-manager-p']],
        ['position-department-manager', ['user-department-manager']],
      ],
    },
    replacement: {
      attempt: 2,
      restartReason: REASON,
      restartedById: 'user-admin',
      pendingGroup: ['position-department-manager', ['user-unassigned']],
      skip: { positionId: 'position-section-manager', reason: 'VACANT_POSITION' },
    },
    activity: { action: 'restarted_stranded_attempt', userId: 'user-admin', comments: REASON },
  })

  const positiveData = (): DbEvidenceData => ({
    requests: [{ id: 'req-1', title: EXACT_TITLE, status: 'ImprovementRequest' }],
    solutions: [],
    approvalInstances: [
      { id: 'inst-old', phase: 'REQUEST', requestId: 'req-1', attempt: 1, originUserId: 'user-supervisor-p', supersededAt: '2026-09-23T00:00:00Z' },
      { id: 'inst-new', phase: 'REQUEST', requestId: 'req-1', attempt: 2, state: 'PENDING', supersededAt: null, restartOfInstanceId: 'inst-old', restartReason: REASON, restartedById: 'user-admin' },
    ],
    candidateGroups: [
      { id: 'g1', approvalInstanceId: 'inst-old', requiredPositionId: 'position-section-manager', members: [{ userId: 'user-section-manager-p' }] },
      { id: 'g2', approvalInstanceId: 'inst-old', requiredPositionId: 'position-department-manager', members: [{ userId: 'user-department-manager' }] },
      { id: 'g3', approvalInstanceId: 'inst-new', requiredPositionId: 'position-department-manager', members: [{ userId: 'user-unassigned' }] },
    ],
    requestApprovals: [
      { id: 'ra-pending', instanceId: 'inst-new', order: 3, status: 'pending', requiredPositionId: 'position-department-manager', candidateGroupId: 'g3', isFinalApproval: false },
    ],
    solutionApprovals: [],
    instanceSkips: [{ approvalInstanceId: 'inst-new', requiredPositionId: 'position-section-manager', reason: 'VACANT_POSITION' }],
    routeVersions: [],
    requestActivities: [{ requestId: 'req-1', userId: 'user-admin', action: 'restarted_stranded_attempt', comments: REASON }],
  })

  const allPass = (checks: WorkflowCheck[]): boolean => checks.length > 0 && checks.every((check) => check.status === 'pass')
  const failing = (checks: WorkflowCheck[]): string[] => checks.filter((check) => check.status === 'fail').map((check) => check.name)

  it('positive control: every required restart-history check passes', () => {
    assert.ok(allPass(evaluateStrandedRestartEvidence(positiveData(), input())))
  })

  it('missing REQUIRED request fails (never skipped)', () => {
    const data = positiveData()
    data.requests = []
    const checks = evaluateStrandedRestartEvidence(data, input())
    assert.ok(failing(checks).includes('db-evidence/Business T18B/stranded-restart/request-present'))
  })

  it('corrupted/missing restart linkage fails', () => {
    const data = positiveData()
    ;(data.approvalInstances[1] as DbEvidenceRow).restartOfInstanceId = 'inst-missing'
    assert.ok(failing(evaluateStrandedRestartEvidence(data, input())).some((name) => name.endsWith('restart-linkage')))
    const data2 = positiveData()
    delete (data2.approvalInstances[1] as DbEvidenceRow).restartOfInstanceId
    assert.ok(failing(evaluateStrandedRestartEvidence(data2, input())).some((name) => name.endsWith('restart-linkage')))
  })

  it('altered old snapshot (captured group member changed) fails', () => {
    const data = positiveData()
    ;(data.candidateGroups[0] as DbEvidenceRow).members = [{ userId: 'user-imposter' }]
    assert.ok(failing(evaluateStrandedRestartEvidence(data, input())).some((name) => name.endsWith('old-group-position-section-manager')))
  })

  it('missing exact reason, missing vacant skip, missing audit activity each fail', () => {
    const wrongReason = positiveData()
    ;(wrongReason.approvalInstances[1] as DbEvidenceRow).restartReason = 'different reason'
    assert.ok(failing(evaluateStrandedRestartEvidence(wrongReason, input())).some((name) => name.endsWith('restart-reason')))

    const noSkip = positiveData()
    noSkip.instanceSkips = []
    assert.ok(failing(evaluateStrandedRestartEvidence(noSkip, input())).some((name) => name.endsWith('replacement-vacant-skip')))

    const noActivity = positiveData()
    noActivity.requestActivities = []
    assert.ok(failing(evaluateStrandedRestartEvidence(noActivity, input())).some((name) => name.endsWith('restart-activity-audit')))
  })

  it('a fabricated approval decision on the replacement fails; extra current instance fails uniqueness', () => {
    const fabricated = positiveData()
    fabricated.requestApprovals = [{ id: 'ra-1', instanceId: 'inst-new', order: 1, status: 'approved', approverId: 'user-admin', isFinalApproval: false }]
    assert.ok(failing(evaluateStrandedRestartEvidence(fabricated, input())).some((name) => name.endsWith('no-fabricated-approval')))

    const extra = positiveData()
    extra.approvalInstances.push({ id: 'inst-extra', phase: 'REQUEST', requestId: 'req-1', attempt: 3, supersededAt: null })
    assert.ok(failing(evaluateStrandedRestartEvidence(extra, input())).some((name) => name.endsWith('exactly-one-current-replacement')))
  })

  it('the wrong spare captured on the replacement fails', () => {
    const data = positiveData()
    ;(data.candidateGroups[2] as DbEvidenceRow).members = [{ userId: 'user-someone-else' }]
    assert.ok(failing(evaluateStrandedRestartEvidence(data, input())).some((name) => name.endsWith('replacement-pending-group')))
  })

  it('a legitimate pending restart step row is not a fabricated approval decision', () => {
    const data = positiveData()
    data.requestApprovals = [{ id: 'ra-pending', instanceId: 'inst-new', order: 2, status: 'pending', isFinalApproval: false }]
    assert.equal(
      failing(evaluateStrandedRestartEvidence(data, input())).some((name) => name.endsWith('no-fabricated-approval')),
      false,
      'persistApprovalInstance writes pending step rows; only a granted decision is fabricated',
    )
  })

  it('removing the pending Department approval row fails even when no decision was granted', () => {
    const data = positiveData()
    data.requestApprovals = []
    assert.ok(
      failing(evaluateStrandedRestartEvidence(data, input())).some((name) => name.endsWith('replacement-pending-approval')),
      'a missing pending Department row must fail, not pass as an empty fabricated-decision set',
    )
  })

  it('changing the pending Department row status or the replacement state fails', () => {
    const approved = positiveData()
    approved.requestApprovals = [
      { id: 'ra-pending', instanceId: 'inst-new', order: 3, status: 'approved', requiredPositionId: 'position-department-manager', candidateGroupId: 'g3', approverId: 'user-unassigned', isFinalApproval: false },
    ]
    assert.ok(failing(evaluateStrandedRestartEvidence(approved, input())).some((name) => name.endsWith('replacement-pending-approval')))

    const otherState = positiveData()
    ;(otherState.approvalInstances[1] as DbEvidenceRow).state = 'REJECTED'
    assert.ok(failing(evaluateStrandedRestartEvidence(otherState, input())).some((name) => name.endsWith('replacement-pending-state')))
  })

  it('origin-only prefix match is not identity: wrong exact title or wrong recorded instance fails', () => {
    const prefixed = positiveData()
    prefixed.requests = [{ id: 'req-1', title: 'Business T18B other', status: 'ImprovementRequest' }]
    assert.ok(failing(evaluateStrandedRestartEvidence(prefixed, input())).includes('db-evidence/Business T18B/stranded-restart/request-present'))

    const wrongInstance = input()
    wrongInstance.recordedOldInstanceId = 'inst-other-request'
    assert.ok(failing(evaluateStrandedRestartEvidence(positiveData(), wrongInstance)).some((name) => name.endsWith('browser-instance-correlation')))
  })
})

describe('T18B replacement: real restart persistence seam (in-memory ports, no database)', () => {
  const EXACT_TITLE = 'Business T18B 1789800000000-9'
  const positions: PositionNode[] = [
    { id: 'position-staff', name: 'Staff', rank: 1, isActive: true },
    { id: 'position-supervisor', name: 'Supervisor', rank: 2, isActive: true },
    { id: 'position-section-manager', name: 'Section manager', rank: 3, isActive: true },
    { id: 'position-department-manager', name: 'Department manager', rank: 4, isActive: true },
  ]
  const path: ReportingPath = {
    originUserId: 'user-supervisor-p',
    assignmentId: 'assignment-supervisor-p',
    unitId: 'unit-production-1-section',
    positionId: 'position-supervisor',
    teamId: null,
    unitPath: ['unit-production-1-section', 'unit-production-1', 'unit-company'],
    steps: [
      { kind: 'UNIT_MANAGER', unitId: 'unit-production-1-section', assignmentId: 'assignment-section-manager-p', userId: 'user-section-manager-p', positionId: 'position-section-manager' },
      { kind: 'UNIT_MANAGER', unitId: 'unit-production-1', assignmentId: 'assignment-spare', userId: 'user-unassigned', positionId: 'position-department-manager' },
    ],
  }
  const origin: PhaseOrigin = {
    phase: 'REQUEST',
    originUserId: 'user-supervisor-p',
    originUnitId: 'unit-production-1-section',
    path,
    requestId: 'req-t18b',
    source: 'REQUESTER',
  }
  const route: ResolvedApprovalRoute = {
    id: 'all-defaults-request-default',
    scopeUnitId: 'unit-company',
    phase: 'REQUEST',
    version: 1,
    approvalLimitPositionId: 'position-department-manager',
    status: 'PUBLISHED',
    steps: [
      { order: 1, positionId: 'position-supervisor' },
      { order: 2, positionId: 'position-section-manager' },
      { order: 3, positionId: 'position-department-manager' },
    ],
    ancestorScopeIds: ['unit-production-1-section', 'unit-production-1', 'unit-company'],
  }

  function createT18bRestartStore() {
    const instances: Array<Record<string, unknown>> = []
    const groups: Array<Record<string, unknown>> = []
    const members: Array<Record<string, unknown>> = []
    const skips: Array<Record<string, unknown>> = []
    const requestApprovals: Array<Record<string, unknown>> = []
    const activities: Array<Record<string, unknown>> = []
    const users = new Map<string, { name: string; isActive: boolean }>([
      ['user-supervisor-p', { name: 'Supervisor P', isActive: true }],
      ['user-section-manager-p', { name: 'Section manager P', isActive: false }],
      ['user-department-manager', { name: 'Department manager', isActive: false }],
      ['user-unassigned', { name: 'Unassigned user', isActive: true }],
      ['user-admin', { name: 'Admin', isActive: true }],
    ])
    instances.push({
      id: 'inst-old',
      phase: 'REQUEST',
      requestId: 'req-t18b',
      originUserId: 'user-supervisor-p',
      attempt: 1,
      state: 'PENDING',
      supersededAt: null,
    })
    groups.push(
      { id: 'g-old-section', approvalInstanceId: 'inst-old', requiredPositionId: 'position-section-manager' },
      { id: 'g-old-dept', approvalInstanceId: 'inst-old', requiredPositionId: 'position-department-manager' },
    )
    members.push(
      { candidateGroupId: 'g-old-section', userId: 'user-section-manager-p' },
      { candidateGroupId: 'g-old-dept', userId: 'user-department-manager' },
    )
    requestApprovals.push({
      id: 'dec-old',
      instanceId: 'inst-old',
      requestId: 'req-t18b',
      order: 1,
      status: 'pending',
      approverId: null,
      isFinalApproval: false,
    })

    const tx = {
      instances,
      groups,
      members,
      skips,
      requestApprovals,
      activities,
      users,
      async resolvePhaseOrigin() {
        return origin
      },
      async resolvePublishedRoute() {
        return route
      },
      async loadPositions() {
        return positions
      },
      async loadOwnTeamActiveAssignments() {
        return []
      },
      async findStepCandidates() {
        return [...users.entries()].map(([id, user]) => ({ id, isActive: user.isActive }))
      },
      user: {
        async findMany(args: { where: { id: { in: string[] } } }) {
          const wanted = new Set(args.where.id.in)
          return [...users.entries()].filter(([id]) => wanted.has(id)).map(([id, user]) => ({ id, name: user.name }))
        },
      },
      approval_instances: {
        async findFirst(args: { where: { requestId?: string; phase: string }; select: { attempt?: boolean; id?: boolean } }) {
          const matching = instances.filter((row) => {
            if (args.where.phase !== undefined && row.phase !== args.where.phase) return false
            if (args.where.requestId !== undefined && row.requestId !== args.where.requestId) return false
            return true
          })
          matching.sort((left, right) => Number(right.attempt) - Number(left.attempt))
          const top = matching[0]
          if (!top) return null
          const result: { attempt?: number; id?: string } = {}
          if (args.select.attempt) result.attempt = Number(top.attempt)
          if (args.select.id) result.id = String(top.id)
          return result
        },
        async create(args: { data: Record<string, unknown> }) {
          const id = `inst-${instances.length + 1}`
          instances.push({ ...args.data, id, supersededAt: null })
          return { id }
        },
        async update(args: { where: { id: string }; data: { supersededAt: Date } }) {
          const row = instances.find((instance) => instance.id === args.where.id)
          if (row) Object.assign(row, args.data)
          return {}
        },
      },
      approval_instance_skips: {
        async create(args: { data: Record<string, unknown> }) {
          skips.push({ ...args.data })
          return args.data
        },
      },
      approval_candidate_groups: {
        async create(args: { data: Record<string, unknown> }) {
          const id = `g-new-${groups.length + 1}`
          groups.push({ ...args.data, id })
          return { id }
        },
      },
      approval_candidate_group_members: {
        async create(args: { data: Record<string, unknown> }) {
          members.push({ ...args.data })
          return {}
        },
      },
      request_approvals: {
        async create(args: { data: Record<string, unknown> }) {
          requestApprovals.push({ id: `ra-${requestApprovals.length + 1}`, ...args.data })
          return {}
        },
      },
      solution_approvals: {
        async create() {
          throw new Error('T18B request restart must not write solution approvals')
        },
      },
    }

    function snapshotFor(instanceId: string): RestartAttemptRecord | null {
      const row = instances.find((instance) => instance.id === instanceId)
      if (!row) return null
      return {
        id: String(row.id),
        phase: 'REQUEST',
        requestId: String(row.requestId),
        solutionId: null,
        originUserId: String(row.originUserId),
        attempt: Number(row.attempt),
        state: String(row.state),
        supersededAt: (row.supersededAt as Date | null) ?? null,
        candidateGroups: groups.filter((group) => group.approvalInstanceId === instanceId).map((group) => ({
          members: members.filter((member) => member.candidateGroupId === group.id).map((member) => {
            const userId = String(member.userId)
            return { userId, user: { isActive: users.get(userId)?.isActive === true } }
          }),
        })),
      }
    }

    const ports: RestartStrandedPorts & { tx: typeof tx } = {
      tx,
      async requireAdmin() {
        return 'user-admin'
      },
      async loadAttemptForRestart(instanceId) {
        return snapshotFor(instanceId)
      },
      attemptTx: tx as unknown as PhaseAttemptTx,
      request_activities: {
        async create(args) {
          activities.push({ ...args.data })
          return {}
        },
      },
    }
    return ports
  }

  function project(store: ReturnType<typeof createT18bRestartStore>['tx']): DbEvidenceData {
    return {
      requests: [{ id: 'req-t18b', title: EXACT_TITLE, status: 'ImprovementRequest' }],
      solutions: [],
      approvalInstances: store.instances.map((row) => ({ ...row })),
      candidateGroups: store.groups.map((group) => ({
        ...group,
        members: store.members
          .filter((member) => member.candidateGroupId === group.id)
          .map((member) => ({ userId: member.userId })),
      })),
      requestApprovals: store.requestApprovals.map((row) => ({ ...row })),
      solutionApprovals: [],
      instanceSkips: store.skips.map((row) => ({ ...row })),
      routeVersions: [],
      requestActivities: store.activities.map((row) => ({ ...row, requestId: row.requestId ?? 'req-t18b' })),
    }
  }

  it('restartStrandedAttempt preserves both original groups, links the replacement, skips Section, and captures the spare without granting a decision', async () => {
    const ports = createT18bRestartStore()
    const beforeGroups = JSON.stringify(ports.tx.groups.filter((group) => group.approvalInstanceId === 'inst-old'))
    const beforeMembers = JSON.stringify(ports.tx.members.filter((member) => String(member.candidateGroupId).startsWith('g-old')))
    const result = await restartStrandedAttempt(ports, { instanceId: 'inst-old', reason: T18B_RESTART_REASON })
    assert.equal(result.oldInstanceId, 'inst-old')
    assert.equal(
      JSON.stringify(ports.tx.groups.filter((group) => group.approvalInstanceId === 'inst-old')),
      beforeGroups,
      'old captured groups must stay byte-stable',
    )
    assert.equal(
      JSON.stringify(ports.tx.members.filter((member) => String(member.candidateGroupId).startsWith('g-old'))),
      beforeMembers,
    )
    const data = project(ports.tx)
    const checks = evaluateStrandedRestartEvidence(data, {
      titlePrefix: 'Business T18B',
      exactTitle: EXACT_TITLE,
      recordedRequestId: 'req-t18b',
      recordedOldInstanceId: result.oldInstanceId,
      oldInstance: {
        attempt: 1,
        originUserId: 'user-supervisor-p',
        groups: [
          ['position-section-manager', ['user-section-manager-p']],
          ['position-department-manager', ['user-department-manager']],
        ],
      },
      replacement: {
        attempt: 2,
        restartReason: T18B_RESTART_REASON,
        restartedById: 'user-admin',
        pendingGroup: ['position-department-manager', ['user-unassigned']],
        skip: { positionId: 'position-section-manager', reason: 'VACANT_POSITION' },
      },
      activity: { action: 'restarted_stranded_attempt', userId: 'user-admin', comments: T18B_RESTART_REASON },
    })
    const failed = checks.filter((check) => check.status === 'fail').map((check) => `${check.name}: ${check.detail}`)
    assert.deepEqual(failed, [])

    const corrupted = project(ports.tx)
    const replacement = corrupted.approvalInstances.find((row) => row.id === result.newInstanceId)
    assert.ok(replacement)
    replacement.restartOfInstanceId = 'inst-missing'
    assert.ok(evaluateStrandedRestartEvidence(corrupted, {
      titlePrefix: 'Business T18B',
      exactTitle: EXACT_TITLE,
      recordedRequestId: 'req-t18b',
      recordedOldInstanceId: 'inst-old',
      oldInstance: {
        attempt: 1,
        originUserId: 'user-supervisor-p',
        groups: [
          ['position-section-manager', ['user-section-manager-p']],
          ['position-department-manager', ['user-department-manager']],
        ],
      },
      replacement: {
        attempt: 2,
        restartReason: T18B_RESTART_REASON,
        restartedById: 'user-admin',
        pendingGroup: ['position-department-manager', ['user-unassigned']],
        skip: { positionId: 'position-section-manager', reason: 'VACANT_POSITION' },
      },
      activity: { action: 'restarted_stranded_attempt', userId: 'user-admin', comments: T18B_RESTART_REASON },
    }).some((check) => check.status === 'fail' && check.name.endsWith('restart-linkage')))

    const altered = project(ports.tx)
    const oldSection = altered.candidateGroups.find((group) => group.id === 'g-old-section')
    assert.ok(oldSection)
    oldSection.members = [{ userId: 'user-imposter' }]
    assert.ok(evaluateStrandedRestartEvidence(altered, {
      titlePrefix: 'Business T18B',
      exactTitle: EXACT_TITLE,
      recordedRequestId: 'req-t18b',
      recordedOldInstanceId: 'inst-old',
      oldInstance: {
        attempt: 1,
        originUserId: 'user-supervisor-p',
        groups: [
          ['position-section-manager', ['user-section-manager-p']],
          ['position-department-manager', ['user-department-manager']],
        ],
      },
      replacement: {
        attempt: 2,
        restartReason: T18B_RESTART_REASON,
        restartedById: 'user-admin',
        pendingGroup: ['position-department-manager', ['user-unassigned']],
        skip: { positionId: 'position-section-manager', reason: 'VACANT_POSITION' },
      },
      activity: { action: 'restarted_stranded_attempt', userId: 'user-admin', comments: T18B_RESTART_REASON },
    }).some((check) => check.status === 'fail' && check.name.endsWith('old-group-position-section-manager')))
  })

  it('missing restart linkage on the real persisted replacement fails the evaluator', async () => {
    const ports = createT18bRestartStore()
    const result = await restartStrandedAttempt(ports, { instanceId: 'inst-old', reason: T18B_RESTART_REASON })
    const data = project(ports.tx)
    const created = data.approvalInstances.find((row) => row.id === result.newInstanceId)
    assert.ok(created)
    delete created.restartOfInstanceId
    const checks = evaluateStrandedRestartEvidence(data, {
      titlePrefix: 'Business T18B',
      exactTitle: EXACT_TITLE,
      recordedRequestId: 'req-t18b',
      recordedOldInstanceId: 'inst-old',
      oldInstance: {
        attempt: 1,
        originUserId: 'user-supervisor-p',
        groups: [
          ['position-section-manager', ['user-section-manager-p']],
          ['position-department-manager', ['user-department-manager']],
        ],
      },
      replacement: {
        attempt: 2,
        restartReason: T18B_RESTART_REASON,
        restartedById: 'user-admin',
        pendingGroup: ['position-department-manager', ['user-unassigned']],
        skip: { positionId: 'position-section-manager', reason: 'VACANT_POSITION' },
      },
      activity: { action: 'restarted_stranded_attempt', userId: 'user-admin', comments: T18B_RESTART_REASON },
    })
    assert.ok(checks.some((check) => check.status === 'fail' && check.name.endsWith('restart-linkage')))
  })
})

describe('T18B replacement: runner assembly requires browser correlation', () => {
  const empty = (): DbEvidenceData => ({
    requests: [],
    solutions: [],
    approvalInstances: [],
    candidateGroups: [],
    requestApprovals: [],
    solutionApprovals: [],
    instanceSkips: [],
    routeVersions: [],
    requestActivities: [],
  })

  it('generic all-defaults evaluation does not pass T18B by silence', () => {
    const checks = evaluateDefaultWorkflowEvidence(empty(), 'all-defaults')
    assert.equal(checks.some((check) => check.name.includes('stranded-restart') && check.status === 'pass'), false)
  })

  it('all-defaults assembly fails when the browser correlation is missing or corrupt', () => {
    const missing = assembleBusinessDbChecks(empty(), 'all-defaults', { status: 'missing' })
    assert.equal(missing.find((check) => check.name.endsWith('browser-correlation-missing'))?.status, 'fail')
    const corrupt = assembleBusinessDbChecks(empty(), 'all-defaults', { status: 'corrupt' })
    assert.equal(corrupt.find((check) => check.name.endsWith('browser-correlation-missing'))?.status, 'fail')
    const otherProfile = assembleBusinessDbChecks(empty(), 'solution-exception', { status: 'missing' })
    assert.equal(otherProfile.some((check) => check.name.includes('stranded-restart')), false)
  })

  it('activity projection includes comments so the exact restart reason is visible', () => {
    const sql = businessRequestActivitySelectSql()
    assert.match(sql, /act\.comments/)
    assert.match(sql, /request_activities/)
    assert.equal(sql.toLowerCase().includes('password'), false)
  })

  it('the runner capture function assembles checks instead of stopping at the generic evaluator', () => {
    assert.match(captureWorkflowDbEvidence.toString(), /assembleBusinessDbChecks/)
    assert.equal(parseT18bBrowserCorrelation('{"requestTitle":"Business T18B","oldInstanceId":"inst-old"}').status, 'corrupt')
    assert.equal(parseT18bBrowserCorrelation('{"requestTitle":"Business T18B 1","requestId":"req-1","oldInstanceId":"inst-old"}').status, 'present')
  })

  it('prepare and other profiles do not require the T18B browser correlation', () => {
    const empty = (): DbEvidenceData => ({
      requests: [], solutions: [], approvalInstances: [], candidateGroups: [],
      requestApprovals: [], solutionApprovals: [], instanceSkips: [], routeVersions: [], requestActivities: [],
    })
    assert.equal(t18bEvidenceApplies('prepare', 'all-defaults'), false)
    assert.equal(t18bEvidenceApplies('lifecycle-smoke', 'all-defaults'), false)
    assert.equal(t18bEvidenceApplies('full', 'solution-exception'), false)
    assert.equal(t18bEvidenceApplies('full', 'all-defaults'), true)
    const prepare = assembleBusinessDbChecks(empty(), 'all-defaults', { status: 'missing' }, { requireT18b: t18bEvidenceApplies('prepare', 'all-defaults') })
    assert.equal(prepare.some((check) => check.name.includes('stranded-restart')), false)
    const other = assembleBusinessDbChecks(empty(), 'solution-exception', { status: 'missing' }, { requireT18b: false })
    assert.equal(other.some((check) => check.name.includes('stranded-restart')), false)
  })
})

describe('T18B identity before restart', () => {
  const utf8 = (text: string) => new TextEncoder().encode(text)
  const ACTION_ID = 'action-create-request'
  const TITLE = 'Business T18B 1789800000000-1'
  const body = (title: string) => JSON.stringify([{
    title,
    description: 'T18B: every captured approver goes inactive while the attempt is pending.',
    inlineImageSessionId: 'session',
    stagedAttachmentIds: [],
  }])
  const flight = (root: string, extra = '') => `${root}\n${extra}`
  const observation = (over: Partial<{ actionId: string | null; postData: string | null; responseBytes: Uint8Array }> = {}) => ({
    actionId: ACTION_ID,
    postData: body(TITLE),
    responseBytes: utf8(flight('0:{"a":{"success":true,"requestId":"req-created"},"f":null,"b":"build"}')),
    ...over,
  })

  it('keeps a promised action result when a development D debug row reuses a model id', async () => {
    const text = [
      '2:D{"time":1}',
      '2:{"unrelated":"tree"}',
      '0:{"a":"$@1","f":null}',
      '1:{"success":true,"requestId":"req-created"}',
    ].join('\n')
    const { createRequire } = await import('node:module')
    const client = createRequire(process.cwd() + '/package.json')('next/dist/compiled/react-server-dom-webpack/client.node.js') as {
      createFromReadableStream: (stream: unknown, options: unknown) => Promise<unknown>
    }
    const decoded = await client.createFromReadableStream(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(text + '\n'))
        controller.close()
      },
    }), {
      serverConsumerManifest: { moduleMap: {}, moduleLoading: { prefix: '', crossOrigin: null }, serverModuleMap: null },
    })
    const installed = (decoded as { a?: unknown }).a
    const settled = installed && typeof (installed as { then?: unknown }).then === 'function' ? await installed : installed
    assert.equal((settled as { requestId?: string }).requestId, 'req-created', 'the installed DEV decoder accepts the D debug row sharing a model id')
    assert.equal(await readCreatedRequestIdFromCreateAction({
      expectedActionId: ACTION_ID,
      expectedTitle: TITLE,
      observations: [observation({ responseBytes: utf8(text) })],
    }), 'req-created')
  })

  it('rejects duplicate VALUE definitions while the shared D debug row stays legitimate', async () => {
    await assert.rejects(readCreatedRequestIdFromCreateAction({
      expectedActionId: ACTION_ID,
      expectedTitle: TITLE,
      observations: [observation({
        responseBytes: utf8('2:{"unrelated":"tree"}\n2:{"other":"row"}\n0:{"a":"$@1","f":null}\n1:{"success":true,"requestId":"req-created"}'),
      })],
    }), /could not be decoded/)
  })

  it('reads a promised action result when a revalidated I record precedes it', async () => {
    const text = [
      '1:I["app/requests/page.js",["chunk.js"],"default"]',
      '0:{"a":"$@2","f":"$1","b":"build"}',
      '2:{"success":true,"requestId":"req-created"}',
    ].join('\n')
    const { createRequire } = await import('node:module')
    const client = createRequire(process.cwd() + '/package.json')('next/dist/compiled/react-server-dom-webpack/client.node.js') as {
      createFromReadableStream: (stream: unknown, options: unknown) => Promise<unknown>
    }
    await assert.rejects(client.createFromReadableStream(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(text + '\n'))
        controller.close()
      },
    }), {
      serverConsumerManifest: { moduleMap: {}, moduleLoading: { prefix: '', crossOrigin: null }, serverModuleMap: null },
    }), /Could not find the module/)
    assert.equal(await readCreatedRequestIdFromCreateAction({
      expectedActionId: ACTION_ID,
      expectedTitle: TITLE,
      observations: [observation({ responseBytes: utf8(text) })],
    }), 'req-created')
    await assert.rejects(readCreatedRequestIdFromCreateAction({
      expectedActionId: ACTION_ID,
      expectedTitle: TITLE,
      observations: [observation({
        responseBytes: utf8('0:{"a":"$@1","f":null}\n1:I["app/requests/page.js",["chunk.js"],"default"]'),
      })],
    }), /could not be decoded/)
  })

  it('reads a direct Flight action result and a referenced response.a, not response.f', async () => {
    assert.equal(await readCreatedRequestIdFromCreateAction({
      expectedActionId: ACTION_ID,
      expectedTitle: TITLE,
      observations: [observation()],
    }), 'req-created')
    assert.equal(await readCreatedRequestIdFromCreateAction({
      expectedActionId: ACTION_ID,
      expectedTitle: TITLE,
      observations: [observation({
        responseBytes: utf8(flight('0:{"a":"$@1","f":[{"success":true,"requestId":"req-other"}],"b":"build"}', '1:{"success":true,"requestId":"req-ref"}')),
      })],
    }), 'req-ref')
  })

  it('rejects the response.f counterexample and unrelated action, title, or non-action payload before accepting an id', async () => {
    const counterexample = '0:{"a":null,"f":[{"success":true,"requestId":"req-other"}]}'
    await assert.rejects(readCreatedRequestIdFromCreateAction({
      expectedActionId: ACTION_ID,
      expectedTitle: TITLE,
      observations: [observation({ responseBytes: utf8(counterexample) })],
    }), /result/)
    await assert.rejects(readCreatedRequestIdFromCreateAction({
      expectedActionId: ACTION_ID,
      expectedTitle: TITLE,
      observations: [observation({ actionId: 'other-action', responseBytes: utf8(counterexample) })],
    }), /result/)
    await assert.rejects(readCreatedRequestIdFromCreateAction({
      expectedActionId: ACTION_ID,
      expectedTitle: TITLE,
      observations: [observation({ postData: body('Business T18B other'), responseBytes: utf8(counterexample) })],
    }), /result/)
    await assert.rejects(readCreatedRequestIdFromCreateAction({
      expectedActionId: ACTION_ID,
      expectedTitle: TITLE,
      observations: [{ actionId: null, postData: 'not-an-action', responseBytes: utf8(counterexample) }],
    }), /result/)
    await assert.rejects(readCreatedRequestIdFromCreateAction({
      expectedActionId: ACTION_ID,
      expectedTitle: TITLE,
      observations: [observation(), observation()],
    }), /result/)
  })

  it('resolves createRequest from the same-run manifest and ignores encryptionKey text', () => {
    const actions = JSON.stringify([['/abs/requests.ts', [{ id: ACTION_ID, exportedName: 'createRequest', filename: 'server-actions/requests.ts' }]]])
    const moduleId = `next-flight-action-entry-loader.js?actions=${encodeURIComponent(actions)}&__client_imported__=!`
    const manifest = JSON.stringify({
      encryptionKey: '0:{"a":{"success":true,"requestId":"req-other"}}',
      node: { one: { workers: { w: { moduleId } } } },
    })
    assert.equal(readCreateRequestActionId(manifest), ACTION_ID)
    assert.throws(() => readCreateRequestActionId('{"encryptionKey":"secret"}'), /action id/)
  })

  it('rejects a stranded row that belongs to a different request', () => {
    const rows = [
      { requestId: 'req-other', instanceId: 'inst-other' },
      { requestId: 'req-created', instanceId: 'inst-created' },
    ]
    assert.equal(selectStrandedRowForRequest(rows, 'req-created').instanceId, 'inst-created')
    assert.throws(() => selectStrandedRowForRequest(rows, 'req-missing'), /matched 0/)
    assert.throws(() => selectStrandedRowForRequest([
      { requestId: 'req-created', instanceId: 'inst-a' },
      { requestId: 'req-created', instanceId: 'inst-b' },
    ], 'req-created'), /matched 2/)
  })
})

describe('T18B createRequest Flight byte framing', () => {
  const ACTION_ID = 'action-create-request'
  const TITLE = 'Business T18B 1789800000000-1'
  const utf8 = (text: string) => new TextEncoder().encode(text)
  const postBody = JSON.stringify([{
    title: TITLE,
    description: 'T18B: every captured approver goes inactive while the attempt is pending.',
    inlineImageSessionId: 'session',
    stagedAttachmentIds: [],
  }])
  const concat = (...parts: Uint8Array[]): Uint8Array => {
    const total = parts.reduce((sum, part) => sum + part.byteLength, 0)
    const out = new Uint8Array(total)
    let offset = 0
    for (const part of parts) { out.set(part, offset); offset += part.byteLength }
    return out
  }
  // emitTextChunk shape (installed react-server-dom-webpack server bundle):
  // `id.toString(16) + ':T' + Buffer.byteLength(text, 'utf8').toString(16) + ','` + raw unescaped text.
  const textRow = (id: number, text: string) => `${id.toString(16)}:T${Buffer.byteLength(text, 'utf8').toString(16)},${text}`
  // emitTypedArrayChunk shape: `id.toString(16) + ':' + tag + byteLength.toString(16) + ','` + raw bytes.
  const binaryRow = (id: number, tag: string, raw: Uint8Array) => concat(utf8(`${id.toString(16)}:${tag}${raw.byteLength.toString(16)},`), raw)
  const observation = (responseBytes: Uint8Array) => ({
    actionId: ACTION_ID,
    postData: postBody,
    responseBytes,
  })
  const readId = (responseBytes: Uint8Array) => readCreatedRequestIdFromCreateAction({
    expectedActionId: ACTION_ID,
    expectedTitle: TITLE,
    observations: [observation(responseBytes)],
  })
  const rejectionMessage = (responseBytes: Uint8Array): Promise<string> => readId(responseBytes).then(
    () => { throw new Error('expected a framing rejection') },
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  )
  const modelRows = utf8('0:{"a":"$@1","f":null}\n1:{"success":true,"requestId":"req-created"}\n')
  const installedClient = async (wire: Uint8Array): Promise<unknown> => {
    const { createRequire } = await import('node:module')
    const client = createRequire(process.cwd() + '/package.json')('next/dist/compiled/react-server-dom-webpack/client.node.js') as {
      createFromReadableStream: (stream: unknown, options: unknown) => Promise<unknown>
    }
    const decoded = await client.createFromReadableStream(new ReadableStream({
      start(controller) { controller.enqueue(wire); controller.close() },
    }), {
      serverConsumerManifest: { moduleMap: {}, moduleLoading: { prefix: '', crossOrigin: null }, serverModuleMap: null },
    })
    const installed = (decoded as { a?: unknown }).a
    return installed && typeof (installed as { then?: unknown }).then === 'function' ? await (installed as Promise<unknown>) : installed
  }

  it('reads requestId past an unrelated multiline T row (installed emitTextChunk shape, correct UTF-8 byte count)', async () => {
    assert.equal(Buffer.byteLength('X\nY', 'utf8'), 3)
    const wire = concat(utf8('2:D{"time":1}\n'), utf8(textRow(5, 'X\nY')), modelRows)
    assert.equal(await readId(wire), 'req-created')
  })

  it('the installed DEV decoder accepts the same multiline T wire bytes adjacent to the next row', async () => {
    const wire = concat(utf8('2:D{"time":1}\n'), utf8(textRow(5, 'X\nY')), modelRows)
    const settled = await installedClient(wire)
    assert.equal((settled as { requestId?: string }).requestId, 'req-created')
  })

  it('reads requestId past a T row whose text is multi-byte UTF-8 adjacent to the next row', async () => {
    // '\u00e9' is one UTF-16 code unit <= 0xFF but two UTF-8 bytes: a character-count
    // skip would eat the next row's first header byte, so only byte-exact framing is safe.
    assert.equal(Buffer.byteLength('\u00e9', 'utf8'), 2)
    const wire = concat(utf8('2:D{"time":1}\n'), utf8(textRow(4, '\u00e9')), modelRows)
    assert.equal(await readId(wire), 'req-created')
  })

  it('reads requestId past an unrelated binary row that embeds a newline', async () => {
    const raw = Uint8Array.of(0x01, 0x0a, 0x02)
    const wire = concat(utf8('2:D{"time":1}\n'), binaryRow(3, 'o', raw), modelRows)
    assert.equal(await readId(wire), 'req-created')
  })

  // The installed DEV serializer emits omitted-ID control records: `:N<timeOrigin>\n`
  // (Request construction, server bundle L1015-1016/L3370), `:W<args>\n` console
  // forward (L871), `:H<code><model>\n` hint (L1392). The installed client keeps the
  // rowID=0 default and never routes N/W/H into _chunks, so the scanner must consume
  // exactly these three newline-framed records and omit them before the value-map and
  // duplicate checks — never executing console/hints/module loads.
  const installedSerializerControlRow = (): Uint8Array => {
    // Capture the real leading control row from the installed bundle with the
    // react-server condition enabled only inside the child, instead of hand-writing
    // `:N` + timeOrigin bytes.
    const script = [
      'const server = require("next/dist/compiled/react-server-dom-webpack/server.node.js");',
      'const React = require("react");',
      'server.renderToReadableStream(React.createElement("div", null, "hi")).getReader().read().then(({ done, value }) => {',
      '  if (done || value[0] !== 0x3a || value[1] !== 0x4e) process.exit(3);',
      '  const newline = value.indexOf(10);',
      '  if (newline === -1) process.exit(4);',
      '  process.stdout.write(Buffer.from(value.subarray(0, newline + 1)));',
      '});',
    ].join('')
    return new Uint8Array(execFileSync(process.execPath, ['--conditions', 'react-server', '-e', script], {
      stdio: ['ignore', 'pipe', 'inherit'],
      maxBuffer: 4096,
    }))
  }

  it('reads requestId when the installed serializer\'s leading :N time-origin control row precedes the model rows', async () => {
    const control = installedSerializerControlRow()
    assert.equal(control[0], 0x3a)
    assert.equal(control[1], 0x4e)
    assert.equal(control[control.byteLength - 1], 0x0a)
    assert.equal(await readId(concat(control, modelRows)), 'req-created')
  })

  it('reads requestId past :W console-forward and :H hint control rows before and between model rows', async () => {
    // `:W` + JSON args and `:H` + code + JSON model mirror emitConsoleChunk/emitHint shapes.
    const w = utf8(':W[["log","before"]]\n')
    const h = utf8(':HL["/font.woff2","font"]\n')
    assert.equal(await readId(concat(w, h, modelRows)), 'req-created')
    assert.equal(await readId(
      concat(utf8('0:{"a":"$@1","f":null}\n'), w, utf8('1:{"success":true,"requestId":"req-created"}\n'), h),
    ), 'req-created')
  })

  it('the installed DEV decoder keeps the root id 0 default across leading omitted-id control rows', async () => {
    // Control rows never reach the decoder in the production slice path, but this pins
    // why root 0 survives: the installed parser defaults rowID=0 when `:` leads.
    const settled = await installedClient(concat(installedSerializerControlRow(), utf8(':W[["log","hi"]]\n'), modelRows))
    assert.equal((settled as { requestId?: string }).requestId, 'req-created')
  })

  it('fails closed on unknown or empty control tags and on truncated control frames', async () => {
    const unknownTagMessage = await rejectionMessage(utf8(':Q\n'))
    assert.equal(
      unknownTagMessage,
      'createRequest action result could not be decoded (flight-scan reason=empty-id off=0 len=3 rows=0 last=none)',
    )
    await assert.rejects(readId(utf8(':\n')), /could not be decoded/)
    await assert.rejects(readId(concat(modelRows, utf8(':N123'))), /could not be decoded/)
    await assert.rejects(readId(concat(utf8('0:{"a":"$@1","f":null}\n'), utf8(':W[["log"'))), /could not be decoded/)
  })

  it('omitted-id control rows do not mask duplicate VALUE definitions or the f-only counterexample', async () => {
    await assert.rejects(readId(concat(
      utf8(':N1.5\n'),
      utf8('2:{"unrelated":"tree"}\n2:{"other":"row"}\n0:{"a":"$@1","f":null}\n1:{"success":true,"requestId":"req-created"}\n'),
    )), /could not be decoded/)
    await assert.rejects(readId(concat(
      utf8(':N1.5\n'),
      utf8('0:{"a":null,"f":[{"success":true,"requestId":"req-other"}]}\n'),
    )), /result/)
  })

  it('fails closed on a T row truncated below its declared byte length', async () => {
    await assert.rejects(readId(concat(modelRows, utf8('5:T5,X\n'))), /could not be decoded/)
  })

  it('fails closed on a T row with an invalid (non-hex) length field', async () => {
    await assert.rejects(readId(concat(modelRows, utf8('5:Tz,XY'))), /could not be decoded/)
  })

  it('fails closed when the a graph requires a T row instead of silently dropping it', async () => {
    const wire = concat(utf8('0:{"a":"$@5","f":null}\n1:{"success":true,"requestId":"req-created"}\n'), utf8(textRow(5, 'X\nY')))
    await assert.rejects(readId(wire), /could not be decoded/)
  })

  it('fails closed on a truncated row header and on an oversized response', async () => {
    await assert.rejects(readId(utf8('0')), /could not be decoded/)
    await assert.rejects(readId(concat(modelRows, new Uint8Array(16 * 1024 * 1024).fill(0x20))), /could not be decoded/)
  })

  it('fails closed at the id terminator with a bounded numbers-only diagnostic that survives the consumer chain', async () => {
    // The live 2026-09-24 run failed at the `i === bytes.length || i === idStart`
    // seam. The diagnostic must carry only a fixed reason token and finite
    // counters through readCreatedRequestIdFromCreateAction, never the
    // secret-bearing payload text that sits in the scanned buffer.
    const secret = 'SECRET-FLIGHT-PAYLOAD-1790293262360'
    const eofWire = concat(modelRows, utf8(textRow(5, secret)), utf8('9'))
    const eofLen = eofWire.byteLength
    const eofMessage = await rejectionMessage(eofWire)
    assert.equal(
      eofMessage,
      `createRequest action result could not be decoded (flight-scan reason=eof-before-colon off=${eofLen} len=${eofLen} rows=3 last=length)`,
    )
    assert.equal(eofMessage.includes(secret), false, 'payload text must not leak into the diagnostic')
    assert.ok(eofMessage.length < 160, 'the diagnostic stays bounded in size')

    const emptyIdMessage = await rejectionMessage(utf8(':\n'))
    assert.equal(
      emptyIdMessage,
      'createRequest action result could not be decoded (flight-scan reason=empty-id off=0 len=2 rows=0 last=none)',
    )
  })
})

describe('createRequest response observer', () => {
  const utf8 = (text: string) => new TextEncoder().encode(text)
  const source = (over: Partial<ResponseBodySource> = {}): ResponseBodySource => ({
    headers: () => ({ 'content-type': 'text/x-component' }),
    request: () => ({
      headers: () => ({ 'next-action': 'action-create-request' }),
      postData: () => '[]',
    }),
    body: () => Promise.resolve(utf8('0:{}\n')),
    ...over,
  })

  it('reads next-action from the request headers, not the response headers', async () => {
    const seen: string[] = []
    const observations = await collectCreateRequestObservations({
      expectedActionId: 'action-create-request',
      arm: (listener) => {
        listener({
          headers: () => ({ 'content-type': 'text/x-component', 'next-action': 'response-only' }),
          request: () => ({
            headers: () => ({ 'next-action': 'action-create-request' }),
            postData: () => '[]',
          }),
          body: () => Promise.resolve(utf8('0:{"a":null}\n')),
        })
      },
      disarm: () => { seen.push('disarmed') },
      run: async () => undefined,
      deadlineMs: 20,
    })
    assert.equal(observations.length, 1)
    assert.equal(observations[0]?.actionId, 'action-create-request')
    assert.deepEqual(seen, ['disarmed'])
  })

  it('does not leave a read rejection unhandled while creation is still pending', async () => {
    const unhandled: unknown[] = []
    const onUnhandled = (error: unknown) => { unhandled.push(error) }
    process.on('unhandledRejection', onUnhandled)
    let rejectBody: (error: Error) => void = () => undefined
    let finishRun: (error?: Error) => void = () => undefined
    let disarmed = false
    const primary = new Error('toast missing')
    const pending = collectCreateRequestObservations({
      expectedActionId: 'action-create-request',
      arm: (listener) => {
        listener({
          headers: () => ({ 'content-type': 'text/x-component', 'next-action': 'action-create-request' }),
          request: () => ({
            headers: () => ({ 'next-action': 'action-create-request' }),
            postData: () => '[]',
          }),
          body: () => new Promise((_resolve, reject) => { rejectBody = reject }),
        })
      },
      disarm: () => { disarmed = true },
      run: () => new Promise((_resolve, reject) => {
        finishRun = (error) => error ? reject(error) : _resolve(undefined)
      }),
      deadlineMs: 50,
    })
    rejectBody(new Error('body secret'))
    await new Promise((resolve) => setTimeout(resolve, 15))
    assert.equal(unhandled.length, 0)
    finishRun(primary)
    try {
      await assert.rejects(pending, (error: unknown) => error === primary)
      assert.equal(disarmed, true)
      assert.equal(unhandled.length, 0)
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })

  it('does not leave a deadline rejection unhandled while creation is still pending', async () => {
    const unhandled: unknown[] = []
    const onUnhandled = (error: unknown) => { unhandled.push(error) }
    process.on('unhandledRejection', onUnhandled)
    let finishRun: (error?: Error) => void = () => undefined
    let disarmed = false
    const recorded: string[] = []
    const pending = collectCreateRequestObservations({
      expectedActionId: 'action-create-request',
      arm: (listener) => {
        listener({
          headers: () => ({ 'content-type': 'text/x-component', 'next-action': 'action-create-request' }),
          request: () => ({
            headers: () => ({ 'next-action': 'action-create-request' }),
            postData: () => '[]',
          }),
          body: () => new Promise(() => undefined),
        })
      },
      disarm: () => { disarmed = true },
      run: () => new Promise((_resolve, reject) => {
        finishRun = (error) => error ? reject(error) : _resolve(undefined)
      }),
      deadlineMs: 20,
      onSecondaryRead: (kind) => { recorded.push(kind) },
    })
    await new Promise((resolve) => setTimeout(resolve, 40))
    assert.equal(unhandled.length, 0)
    assert.ok(recorded.includes('deadline'))
    const primary = new Error('row missing')
    finishRun(primary)
    try {
      await assert.rejects(pending, (error: unknown) => error === primary)
      assert.equal(disarmed, true)
      assert.equal(unhandled.length, 0)
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })

  it('handles an early body rejection without an unhandled rejection and always disarms', async () => {
    const unhandled: unknown[] = []
    const onUnhandled = (error: unknown) => { unhandled.push(error) }
    process.on('unhandledRejection', onUnhandled)
    let armed = 0
    const primary = new Error('toast missing')
    try {
      await assert.rejects(collectCreateRequestObservations({
        expectedActionId: 'action-create-request',
        arm: (listener) => {
          armed += 1
          listener(source({ body: () => Promise.reject(new Error('body failed secret')) }))
        },
        disarm: () => { armed -= 1 },
        run: async () => { throw primary },
        deadlineMs: 20,
      }), (error: unknown) => error === primary)
      await new Promise((resolve) => setTimeout(resolve, 30))
      assert.equal(unhandled.length, 0)
      assert.equal(armed, 0)
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })

  it('fails a stalled body read at the deadline and handles a later rejection', async () => {
    const unhandled: unknown[] = []
    const onUnhandled = (error: unknown) => { unhandled.push(error) }
    process.on('unhandledRejection', onUnhandled)
    let late: (error: Error) => void = () => undefined
    let disarmed = false
    try {
      await assert.rejects(collectCreateRequestObservations({
        expectedActionId: 'action-create-request',
        arm: (listener) => {
          listener(source({
            body: () => new Promise((_resolve, reject) => { late = reject }),
          }))
        },
        disarm: () => { disarmed = true },
        run: async () => undefined,
        deadlineMs: 20,
      }), /deadline exceeded/)
      late(new Error('late body secret'))
      await new Promise((resolve) => setTimeout(resolve, 20))
      assert.equal(disarmed, true)
      assert.equal(unhandled.length, 0)
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })
})

describe('business evidence gate consumed by the runner', () => {
  const runnerSource = readFileSync('tests/support/native/run-native-business-tests.ts', 'utf8')

  it('the runner calls the gate and scopes T18B to full all-defaults (focused non-T18B selections excluded)', () => {
    assert.match(runnerSource, /decideBusinessEvidenceGate/)
    assert.match(runnerSource, /t18bEvidenceApplies\(options\.mode, options\.routesConfig, options\.scenario\)/)
    assert.match(runnerSource, /requireT18b: t18bEvidenceApplies/)
    assert.match(runnerSource, /focusedScenario: options\.scenario/)
  })

  it('thrown, null, and failed captures fail applicable runs nonzero and keep the primary', () => {
    for (const dbCapture of ['thrown', 'null', 'failed'] as const) {
      const decision = decideBusinessEvidenceGate({
        mode: 'full',
        routesConfig: 'all-defaults',
        dbCapture,
        dbFailureCount: dbCapture === 'failed' ? 2 : 0,
        primaryError: 'browser assertion failed',
        cleanupFailures: [],
        mailCapture: 'success',
      })
      assert.equal(decision.exitCode, 1)
      assert.equal(decision.status, 'failed')
      assert.equal(decision.runCleanup, true)
      assert.equal(decision.preservedPrimary, 'browser assertion failed')
      assert.match(decision.error ?? '', /^browser assertion failed/)
    }
  })

  it('a successful full capture passes, and prepare/lifecycle do not invent a T18B failure', () => {
    const success = decideBusinessEvidenceGate({
      mode: 'full', routesConfig: 'all-defaults', dbCapture: 'success', dbFailureCount: 0, mailCapture: 'success',
    })
    assert.equal(success.exitCode, 0)
    assert.equal(success.status, 'passed')
    assert.equal(success.runCleanup, true)

    const prepare = decideBusinessEvidenceGate({
      mode: 'prepare', routesConfig: 'all-defaults', dbCapture: 'success', dbFailureCount: 0, mailCapture: 'not-applicable',
    })
    assert.equal(prepare.exitCode, 0)

    const smoke = decideBusinessEvidenceGate({
      mode: 'lifecycle-smoke', routesConfig: 'all-defaults', dbCapture: 'not-applicable', mailCapture: 'not-applicable',
    })
    assert.equal(smoke.exitCode, 0)
    assert.equal(smoke.status, 'passed')
  })

  it('a required evidence failure on prepare exits nonzero instead of status-failed exit 0', () => {
    const decision = decideBusinessEvidenceGate({
      mode: 'prepare',
      routesConfig: 'all-defaults',
      dbCapture: 'failed',
      dbFailureCount: 1,
      mailCapture: 'not-applicable',
    })
    assert.equal(decision.status, 'failed')
    assert.equal(decision.exitCode, 1)
    assert.equal(decision.runCleanup, true)

    const thrown = decideBusinessEvidenceGate({
      mode: 'full',
      routesConfig: 'final-exception',
      dbCapture: 'thrown',
      mailCapture: 'success',
    })
    assert.equal(thrown.exitCode, 1)
    assert.match(thrown.error ?? '', /capture threw/)
  })
})

describe('T18B cleanup: remove-spare browser seam closes the manage drawer before the tree chip click', () => {
  // Source-order lock for the spec seam ONLY: it pins the real helper
  // ordering (unit panel opened, drawer closed via its own scoped Close,
  // unmount asserted, and only then the tree person-chip click) so the
  // 2026-09-25 overlay-timeout regression cannot silently return. A pure
  // source check does NOT prove browser behavior — the focused T18B
  // native run owns that proof.
  const specSource = readFileSync('tests/business-e2e/business-approver-availability.spec.ts', 'utf8')
  const seamStart = specSource.indexOf('removeTemporarySpareAssignment: async () => {')
  const seamEnd = seamStart >= 0 ? specSource.indexOf('verifyRestoration: async () => {', seamStart) : -1
  const seam = seamStart >= 0 && seamEnd > seamStart ? specSource.slice(seamStart, seamEnd) : ''

  it('the seam exists and still opens the unit panel first', () => {
    assert.ok(seamStart >= 0, 'removeTemporarySpareAssignment step found in the spec')
    assert.ok(seamEnd > seamStart, 'the step is followed by verifyRestoration')
    assert.ok(seam.includes('openProduction1UnitPanel(session.page)'), 'dependency step (unit panel for the spare) unchanged')
  })

  it('closes the manage drawer via its own scoped Close and asserts it unmounted before the tree chip click', () => {
    const drawerLocator = seam.indexOf("getByTestId('organization-manage-drawer')")
    const scopedClose = seam.indexOf("manageDrawer.getByRole('button', { name: 'Close' })")
    const drawerGone = seam.indexOf('await expect(manageDrawer).toHaveCount(0)')
    const chipClick = seam.indexOf('await spareChip.click()')
    assert.ok(drawerLocator >= 0, 'the manage drawer locator is defined inside the seam')
    assert.ok(scopedClose > drawerLocator, 'Close is chained on the drawer locator (InTreeModal header), not a page-global button')
    assert.ok(!seam.includes("page.getByRole('button', { name: 'Close' })"), 'no ambiguous page-level Close click')
    assert.ok(drawerGone > scopedClose, 'drawer unmount is asserted after the Close click (InTreeModal returns null when closed)')
    assert.ok(chipClick > drawerGone, 'the tree person-chip click happens only after the drawer is gone (overlay no longer covers the tree)')
  })

  it('keeps the person-panel removal flow after the chip click, with no forced clicks', () => {
    const chipClick = seam.indexOf('await spareChip.click()')
    const panelVisible = seam.indexOf("getByTestId('person-assignment-panel')")
    const removeClick = seam.indexOf("getByTestId('assignment-remove')")
    assert.ok(chipClick >= 0, 'the spare-chip click is present')
    assert.ok(panelVisible > chipClick, 'person-assignment-panel is expected after the chip click')
    assert.ok(removeClick > panelVisible, 'assignment-remove is clicked inside the panel')
    assert.doesNotMatch(seam, /force:\s*true/, 'no force-click anywhere in the seam')
  })
})
