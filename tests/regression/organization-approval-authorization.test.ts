/**
 * Read- and action-authorization characterization with real actor identities:
 * canUserViewRequest (request-access.ts) for same-section and unrelated
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
  it('grants same-department members and denies unrelated general users', async () => {
    const harness = createHarness({
      departments: departmentRows(),
      users: workflowUsers(),
      requests: [baselineRequest()],
    })
    harness.state.authUserId = null // read helper takes userId, not auth()

    assert.equal(await harness.requestAccess.canUserViewRequest('staff-1', SCENARIO.requestId), true)
    assert.equal(await harness.requestAccess.canUserViewRequest('supervisor-1', SCENARIO.requestId), true)
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
    const harness = createHarness({
      departments: departmentRows(),
      users: [...workflowUsers(), { id: 'inactive-viewer', departmentId: 'department-pd', level: 2, isActive: false, role: 'general', name: 'Inactive Viewer', email: null }],
      requests: [baselineRequest({ id: 'deleted-request', isDeleted: true })],
    })
    harness.state.authUserId = null

    assert.equal(await harness.requestAccess.canUserViewRequest('inactive-viewer', SCENARIO.requestId), false)
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
