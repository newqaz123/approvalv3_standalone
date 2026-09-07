/**
 * Read- and action-authorization characterization with real actor identities:
 * canUserViewRequest (request-access.ts) for requester, unmapped, and unrelated
 * viewers, plus the action assignment guards canUserApprove,
 * canUserApproveSolution, and canUserApproveFinalApproval executed through the
 * transpile+vm harness.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  SCENARIO,
  baselineRequest,
  baselineSolution,
  createHarness,
  departmentRows,
  workflowUsers,
} from '../fixtures/organization-approval-harness'

describe('canUserViewRequest: same-section, unrelated, and privileged viewers', () => {
  it('grants the requester and denies unmapped ordinary non-requesters', async () => {
    const harness = createHarness({
      departments: departmentRows(),
      users: workflowUsers(),
      requests: [baselineRequest()],
    })
    harness.state.authUserId = null // read helper takes userId, not auth()

    assert.equal(await harness.requestAccess.canUserViewRequest('staff-1', SCENARIO.requestId), true)
    // Same-department non-requester on an unmapped request is fail-closed.
    assert.equal(await harness.requestAccess.canUserViewRequest('supervisor-1', SCENARIO.requestId), false)
    // Unrelated general user: different department, no assignment.
    assert.equal(await harness.requestAccess.canUserViewRequest('null-org-1', SCENARIO.requestId), false)
  })

  it('lets engineering users read any non-deleted request regardless of department', async () => {
    const harness = createHarness({
      departments: departmentRows(),
      users: workflowUsers(),
      requests: [baselineRequest()],
    })
    harness.state.authUserId = null

    assert.equal(await harness.requestAccess.canUserViewRequest('engineer-1', SCENARIO.requestId), true)
    // Assigned custom approver from outside the department reads via assignment.
    assert.equal(await harness.requestAccess.canUserViewRequest(SCENARIO.customApproverA, SCENARIO.requestId), false)
    harness.db.seed('request_approvals', [
      { id: 'a1', requestId: SCENARIO.requestId, requiredApproverId: SCENARIO.customApproverA, requiredLevel: 2, order: 1, status: 'pending' },
    ])
    assert.equal(await harness.requestAccess.canUserViewRequest(SCENARIO.customApproverA, SCENARIO.requestId), true)
  })

  it('denies inactive users, missing requests, and soft-deleted requests', async () => {
    // Active vs inactive comparison uses the SAME live requester-owned request
    // so inactivity is the only differing condition (review round 2 P2).
    const activeView = createHarness({
      departments: departmentRows(),
      users: workflowUsers(),
      requests: [baselineRequest()],
    })
    activeView.state.authUserId = null
    assert.equal(await activeView.requestAccess.canUserViewRequest('staff-1', SCENARIO.requestId), true)

    const inactiveView = createHarness({
      departments: departmentRows(),
      users: workflowUsers().map((user) => user.id === 'staff-1' ? { ...user, isActive: false } : user),
      requests: [baselineRequest()],
    })
    inactiveView.state.authUserId = null
    assert.equal(await inactiveView.requestAccess.canUserViewRequest('staff-1', SCENARIO.requestId), false)

    const harness = createHarness({
      departments: departmentRows(),
      users: workflowUsers(),
      requests: [baselineRequest({ id: 'deleted-request', isDeleted: true })],
    })
    harness.state.authUserId = null

    assert.equal(await harness.requestAccess.canUserViewRequest('staff-1', 'missing-request'), false)
    assert.equal(await harness.requestAccess.canUserViewRequest('staff-1', 'deleted-request'), false)
  })
})

describe('canUserApprove assignment negatives (real action guard)', () => {
  it('accepts the assigned internal approver and a designated external approver, rejects the unassigned', async () => {
    const harness = createHarness({
      departments: departmentRows(),
      users: workflowUsers(),
      requests: [baselineRequest()],
      request_approvals: [
        { id: 'a1', requestId: SCENARIO.requestId, requiredLevel: 2, order: 1, status: 'pending', requiredApproverId: 'supervisor-1', isFinalApproval: false },
      ],
      department_approvers: [
        { id: 'ext-1', departmentId: 'department-pd', approverId: 'engineer-1', approverLevel: 2 },
      ],
    })

    harness.state.authUserId = 'supervisor-1'
    const assigned = (await harness.approvals.canUserApprove(SCENARIO.requestId)) as { canApprove: boolean }
    assert.equal(assigned.canApprove, true)

    // External DepartmentApprover at level 2 (user's own department differs).
    harness.state.authUserId = 'engineer-1'
    const external = (await harness.approvals.canUserApprove(SCENARIO.requestId)) as { canApprove: boolean }
    assert.equal(external.canApprove, true)

    harness.state.authUserId = 'null-org-1'
    const unassigned = (await harness.approvals.canUserApprove(SCENARIO.requestId)) as { canApprove: boolean }
    assert.equal(unassigned.canApprove, false)
  })
})

describe('canUserApproveSolution assignment negatives (real action guard)', () => {
  function harnessWithChain(approvals: Array<Record<string, unknown>>): ReturnType<typeof createHarness> {
    return createHarness({
      departments: departmentRows(),
      users: workflowUsers(),
      requests: [baselineRequest({ status: 'DesignCostEstimationApproval' })],
      solutions: [baselineSolution()],
      solution_approvals: approvals,
    })
  }

  it('accepts the assigned custom approver, rejects other custom candidates', async () => {
    const custom = harnessWithChain([
      { id: 'sa-1', solutionId: SCENARIO.solutionId, requiredApproverId: SCENARIO.customApproverA, order: 1, status: 'pending', isCustomChain: true },
    ])
    custom.state.authUserId = SCENARIO.customApproverA
    assert.equal(((await custom.solutions.canUserApproveSolution(SCENARIO.solutionId)) as { canApprove: boolean }).canApprove, true)
    custom.state.authUserId = SCENARIO.customApproverB
    assert.equal(((await custom.solutions.canUserApproveSolution(SCENARIO.solutionId)) as { canApprove: boolean }).canApprove, false)
  })

  it('accepts only engineering users whose level matches the pending hierarchy step', async () => {
    const hierarchy = harnessWithChain([
      { id: 'sa-1', solutionId: SCENARIO.solutionId, requiredLevel: 2, order: 1, status: 'pending', isCustomChain: false },
    ])
    hierarchy.state.authUserId = SCENARIO.engineeringSupervisorId
    assert.equal(((await hierarchy.solutions.canUserApproveSolution(SCENARIO.solutionId)) as { canApprove: boolean }).canApprove, true)

    // Same level but not an engineering user: hierarchy eligibility denied.
    const generalAtLevel2 = harnessWithChain([
      { id: 'sa-1', solutionId: SCENARIO.solutionId, requiredLevel: 2, order: 1, status: 'pending', isCustomChain: false },
    ])
    generalAtLevel2.db.seed('user', [{ id: 'general-l2', departmentId: 'department-pd', level: 2, isActive: true, role: 'general', name: 'General L2', email: null }])
    generalAtLevel2.state.authUserId = 'general-l2'
    assert.equal(((await generalAtLevel2.solutions.canUserApproveSolution(SCENARIO.solutionId)) as { canApprove: boolean }).canApprove, false)

    // Engineering user at the wrong level.
    hierarchy.state.authUserId = 'engineer-1'
    assert.equal(((await hierarchy.solutions.canUserApproveSolution(SCENARIO.solutionId)) as { canApprove: boolean }).canApprove, false)
  })

  it('rejects when the request is not awaiting solution approvals', async () => {
    const wrongStatus = createHarness({
      departments: departmentRows(),
      users: workflowUsers(),
      requests: [baselineRequest({ status: 'SentToEngineer' })],
      solutions: [baselineSolution()],
      solution_approvals: [
        { id: 'sa-1', solutionId: SCENARIO.solutionId, requiredApproverId: SCENARIO.customApproverA, order: 1, status: 'pending', isCustomChain: true },
      ],
    })
    wrongStatus.state.authUserId = SCENARIO.customApproverA
    assert.equal(((await wrongStatus.solutions.canUserApproveSolution(SCENARIO.solutionId)) as { canApprove: boolean }).canApprove, false)
  })
})

describe('canUserApproveFinalApproval assignment negatives (real action guard)', () => {
  function harnessWithFinalChain(approvals: Array<Record<string, unknown>>): ReturnType<typeof createHarness> {
    return createHarness({
      departments: departmentRows(),
      users: workflowUsers(),
      requests: [baselineRequest({ status: 'FinalApproval' })],
      request_approvals: approvals,
    })
  }

  it('accepts the assigned custom approver and rejects the unassigned', async () => {
    const custom = harnessWithFinalChain([
      { id: 'fa-1', requestId: SCENARIO.requestId, requiredApproverId: SCENARIO.customApproverA, order: 1, status: 'pending', isCustomChain: true, isFinalApproval: true },
    ])
    custom.state.authUserId = SCENARIO.customApproverA
    assert.equal(((await custom.solutions.canUserApproveFinalApproval(SCENARIO.requestId)) as { canApprove: boolean }).canApprove, true)
    custom.state.authUserId = SCENARIO.customApproverB
    assert.equal(((await custom.solutions.canUserApproveFinalApproval(SCENARIO.requestId)) as { canApprove: boolean }).canApprove, false)
  })

  it('accepts the department member at the pending level and rejects the wrong level', async () => {
    const hierarchy = harnessWithFinalChain([
      { id: 'fa-1', requestId: SCENARIO.requestId, requiredLevel: 2, order: 1, status: 'pending', isCustomChain: false, isFinalApproval: true },
    ])
    hierarchy.state.authUserId = 'supervisor-1'
    assert.equal(((await hierarchy.solutions.canUserApproveFinalApproval(SCENARIO.requestId)) as { canApprove: boolean }).canApprove, true)
    hierarchy.state.authUserId = 'staff-1'
    assert.equal(((await hierarchy.solutions.canUserApproveFinalApproval(SCENARIO.requestId)) as { canApprove: boolean }).canApprove, false)
  })
})

// ---------------------------------------------------------------------------
// Solution read surfaces follow the shared request visibility policy (I2)
// ---------------------------------------------------------------------------

describe('solution read surfaces authenticate then apply canUserViewRequest', () => {
  function solutionIsolationHarness() {
    return createHarness({
      departments: departmentRows(),
      users: [
        { id: 'staff-pd1', departmentId: 'department-pd', level: 1, isActive: true, role: 'general', name: 'PD1 Staff', email: 'staff-pd1@example.test' },
        { id: 'staff-pd2', departmentId: 'department-pd', level: 1, isActive: true, role: 'general', name: 'PD2 Staff', email: 'staff-pd2@example.test' },
        { id: 'inactive-pd2', departmentId: 'department-pd', level: 1, isActive: false, role: 'general', name: 'Inactive PD2', email: 'inactive-pd2@example.test' },
        { id: 'department-manager', departmentId: 'department-pd', level: 4, isActive: true, role: 'general', name: 'PD Manager', email: 'dept-mgr@example.test' },
        { id: 'eng-sup-1', departmentId: 'department-engineering', level: 2, isActive: true, role: 'engineering', name: 'Engineering Supervisor', email: 'eng-sup-1@example.test' },
        { id: 'admin-1', departmentId: null, level: 1, isActive: true, role: 'admin', name: 'Admin', email: 'admin-1@example.test' },
      ],
      organization_units: [
        { id: 'factory-1', name: 'Factory', unitType: 'FACTORY', parentId: null, isActive: true, operationalType: 'GENERAL' },
        { id: 'division-1', name: 'Division', unitType: 'DIVISION', parentId: 'factory-1', isActive: true, operationalType: 'GENERAL' },
        { id: 'department-pd-unit', name: 'PD Department', unitType: 'DEPARTMENT', parentId: 'division-1', isActive: true, operationalType: 'GENERAL' },
        { id: 'section-pd1', name: 'PD1', unitType: 'SECTION', parentId: 'department-pd-unit', isActive: true, operationalType: 'GENERAL' },
        { id: 'section-pd2', name: 'PD2', unitType: 'SECTION', parentId: 'department-pd-unit', isActive: true, operationalType: 'GENERAL' },
      ],
      organization_position_assignments: [
        { id: 'asg-pd1', userId: 'staff-pd1', unitId: 'section-pd1', positionCode: 'STAFF', isPrimary: true, isActive: true },
        { id: 'asg-pd2', userId: 'staff-pd2', unitId: 'section-pd2', positionCode: 'STAFF', isPrimary: true, isActive: true },
        { id: 'asg-mgr', userId: 'department-manager', unitId: 'department-pd-unit', positionCode: 'DEPARTMENT_MANAGER', isPrimary: true, isActive: true },
      ],
      requests: [
        { id: 'pd1-r1', status: 'DesignCostEstimationApproval', requesterId: 'staff-pd1', title: 'PD1 request', description: '<p>PD1</p>', departmentId: 'department-pd', organizationUnitId: 'section-pd1', isDeleted: false, isArchived: false },
        { id: 'pd2-r1', status: 'DesignCostEstimationApproval', requesterId: 'staff-pd2', title: 'PD2 request', description: '<p>PD2</p>', departmentId: 'department-pd', organizationUnitId: 'section-pd2', isDeleted: false, isArchived: false },
        { id: 'pd2-deleted', status: 'DesignCostEstimationApproval', requesterId: 'staff-pd2', title: 'PD2 deleted', description: '<p>PD2d</p>', departmentId: 'department-pd', organizationUnitId: 'section-pd2', isDeleted: true, isArchived: false },
      ],
      solutions: [
        { id: 'sol-pd1', requestId: 'pd1-r1', title: 'PD1 solution', description: '<p>s</p>', costEstimate: 100, currency: 'THB', timeline: '1 week', submittedById: 'eng-sup-1' },
        { id: 'sol-pd2', requestId: 'pd2-r1', title: 'PD2 solution', description: '<p>s</p>', costEstimate: 200, currency: 'THB', timeline: '2 weeks', submittedById: 'eng-sup-1' },
        { id: 'sol-pd2-deleted', requestId: 'pd2-deleted', title: 'PD2 deleted solution', description: '<p>s</p>', costEstimate: 300, currency: 'THB', timeline: '3 weeks', submittedById: 'eng-sup-1' },
      ],
      solution_approvals: [
        { id: 'sa-pd1', solutionId: 'sol-pd1', requiredLevel: 2, order: 1, status: 'pending', isCustomChain: false },
        { id: 'sa-pd2', solutionId: 'sol-pd2', requiredLevel: 2, order: 1, status: 'pending', isCustomChain: false },
      ],
    })
  }

  it('denies a sibling-section staff the solution by request id, by solution id, and its approval metadata', async () => {
    const harness = solutionIsolationHarness()
    harness.state.authUserId = 'staff-pd1'

    assert.equal(await harness.solutions.getSolutionByRequestId('pd2-r1'), null)
    assert.equal(await harness.solutions.getSolutionBySolutionId('sol-pd2'), null)
    assert.equal(((await harness.solutions.getSolutionApprovals('sol-pd2')) as unknown[]).length, 0)

    // The same caller still reads their own section's solution.
    const own = (await harness.solutions.getSolutionByRequestId('pd1-r1')) as { id: string; costEstimate: number } | null
    assert.equal(own?.id, 'sol-pd1')
    assert.equal(own?.costEstimate, 100)
    const ownById = (await harness.solutions.getSolutionBySolutionId('sol-pd1')) as { id: string } | null
    assert.equal(ownById?.id, 'sol-pd1')
    const ownApprovals = (await harness.solutions.getSolutionApprovals('sol-pd1')) as Array<{ id: string }>
    assert.equal(ownApprovals.length, 1)
    assert.equal(ownApprovals[0]?.id, 'sa-pd1')
  })

  it('denies inactive users and soft-deleted requests on every solution read surface', async () => {
    const harness = solutionIsolationHarness()

    harness.state.authUserId = 'inactive-pd2'
    assert.equal(await harness.solutions.getSolutionByRequestId('pd2-r1'), null)
    assert.equal(await harness.solutions.getSolutionBySolutionId('sol-pd2'), null)
    assert.equal(((await harness.solutions.getSolutionApprovals('sol-pd2')) as unknown[]).length, 0)

    harness.state.authUserId = 'staff-pd2'
    assert.equal(await harness.solutions.getSolutionByRequestId('pd2-deleted'), null)
    assert.equal(await harness.solutions.getSolutionBySolutionId('sol-pd2-deleted'), null)
    assert.equal(((await harness.solutions.getSolutionApprovals('sol-pd2-deleted')) as unknown[]).length, 0)
  })

  it('rejects unauthenticated callers before any solution query result is returned', async () => {
    const harness = solutionIsolationHarness()
    harness.state.authUserId = null

    await assert.rejects(harness.solutions.getSolutionByRequestId('pd2-r1'), /Unauthorized/)
    await assert.rejects(harness.solutions.getSolutionBySolutionId('sol-pd2'), /Unauthorized/)
    await assert.rejects(harness.solutions.getSolutionApprovals('sol-pd2'), /Unauthorized/)
  })

  it('keeps action eligibility separate: ineligible callers get no solution payload, eligible approvers do', async () => {
    const harness = solutionIsolationHarness()

    // Sibling staff: not the current approver, so the response carries no
    // serialized solution (read surfaces are the visibility gate).
    harness.state.authUserId = 'staff-pd1'
    const ineligible = (await harness.solutions.canUserApproveSolution('sol-pd2')) as { canApprove: boolean; approval?: unknown; solution?: unknown }
    assert.equal(ineligible.canApprove, false)
    assert.equal(ineligible.approval, undefined)
    assert.equal(ineligible.solution, undefined)

    // Current-step engineering approver: eligibility true, payload present.
    harness.state.authUserId = 'eng-sup-1'
    const eligible = (await harness.solutions.canUserApproveSolution('sol-pd1')) as { canApprove: boolean; approval?: { id: string }; solution?: { id: string } }
    assert.equal(eligible.canApprove, true)
    assert.equal(eligible.approval?.id, 'sa-pd1')
    assert.equal(eligible.solution?.id, 'sol-pd1')

    // Even the owning requester (visible) gets no payload while ineligible.
    harness.state.authUserId = 'staff-pd2'
    const ownerIneligible = (await harness.solutions.canUserApproveSolution('sol-pd1')) as { canApprove: boolean; solution?: unknown }
    assert.equal(ownerIneligible.canApprove, false)
    assert.equal(ownerIneligible.solution, undefined)
  })
})
