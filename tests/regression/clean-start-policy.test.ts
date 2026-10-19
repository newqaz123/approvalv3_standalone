// Clean-start action policy (Plan B Task 10).
// Re-bases tests/regression/organization-approval-{authorization,request-actions,
// solution-actions,final-actions}.test.ts and
// tests/regression/approval-action-pending-state.test.ts.
// Fake-unit tests only: NO SNAPSHOT harness expansion, NO OrganizationPositionCode.
// Solution work is A5 canWorkOnSolutions (unit flag inherited). Request submit is
// every active assignment. Admin is separate. Approval is chain-only.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import type { OrganizationUnitNode } from '@/lib/organization/model'
import {
  canInitiateFinalApproval,
  canSubmitSolutionWork,
  canUserAssignEngineers,
  getModalTypeForStatus,
} from '@/lib/permission-checks'
import {
  evaluateRequestAction,
  existingAssignEngineersDecision,
  existingDeleteAttachmentDecision,
  existingInitiateFinalApprovalDecision,
  existingResubmitFinalApprovalDecision,
  existingResubmitSolutionDecision,
  existingSubmitSolutionDecision,
  existingUploadAttachmentDecision,
  shouldShowActionButton,
  type ActionPermissionContext,
} from '@/lib/action-permissions'

const read = (path: string) => readFileSync(path, 'utf8')

const u = (id: string, parentId: string | null, over: Partial<OrganizationUnitNode> = {}): OrganizationUnitNode =>
  ({ id, name: id, parentId, isActive: true, shareRequests: false, canWorkOnSolutions: false, managerUserId: null, ...over })

const units = [
  u('company', null),
  u('engineering', 'company', { canWorkOnSolutions: true }),
  u('web', 'engineering'),
  u('sales', 'company'),
]

function policyContext(
  existingActionDecisions: ActionPermissionContext['existingActionDecisions'],
  over: Partial<ActionPermissionContext> = {},
): ActionPermissionContext {
  return {
    actor: {
      id: 'worker-1',
      role: 'general_dept',
      isActive: true,
      assignmentUnitId: 'web',
    },
    request: {
      requesterId: 'requester-1',
      organizationUnitId: 'sales',
      status: 'SentToEngineer',
    },
    canView: true,
    approval: { canApprove: false },
    assignedEngineer: false,
    existingActionDecisions,
    ...over,
  }
}

describe('canSubmitSolutionWork — A5 unit flag inherited; not role, not admin', () => {
  it('allows an active assignment on the flagged unit', () => {
    assert.equal(canSubmitSolutionWork({ isActive: true, assignmentUnitId: 'engineering', units }), true)
  })

  it('allows an active assignment on a descendant of a flagged unit', () => {
    assert.equal(canSubmitSolutionWork({ isActive: true, assignmentUnitId: 'web', units }), true)
  })

  it('denies unassigned, inactive, and unflagged assignments', () => {
    assert.equal(canSubmitSolutionWork({ isActive: true, assignmentUnitId: null, units }), false)
    assert.equal(canSubmitSolutionWork({ isActive: false, assignmentUnitId: 'engineering', units }), false)
    assert.equal(canSubmitSolutionWork({ isActive: true, assignmentUnitId: 'sales', units }), false)
  })

  it('does not grant eligibility from the engineering ROLE or admin ROLE', () => {
    assert.equal(canSubmitSolutionWork({ isActive: true, assignmentUnitId: 'sales', units }), false)
    assert.equal(canUserAssignEngineers('engineering'), true)
    assert.equal(canUserAssignEngineers('admin'), false)
  })
})

describe('canInitiateFinalApproval — origin unit or ancestor hierarchy', () => {
  it('allows an active assignment in the request origin unit', () => {
    assert.equal(canInitiateFinalApproval({
      isActive: true,
      assignmentUnitId: 'sales',
      requestOriginUnitId: 'sales',
      units,
    }), true)
  })

  it('allows an ancestor-unit assignment (department/company managers)', () => {
    assert.equal(canInitiateFinalApproval({
      isActive: true,
      assignmentUnitId: 'company',
      requestOriginUnitId: 'sales',
      units,
    }), true)
  })

  it('denies unrelated branches, inactive, unassigned, and empty origin', () => {
    assert.equal(canInitiateFinalApproval({
      isActive: true,
      assignmentUnitId: 'web',
      requestOriginUnitId: 'sales',
      units,
    }), false)
    assert.equal(canInitiateFinalApproval({
      isActive: false,
      assignmentUnitId: 'sales',
      requestOriginUnitId: 'sales',
      units,
    }), false)
    assert.equal(canInitiateFinalApproval({
      isActive: true,
      assignmentUnitId: null,
      requestOriginUnitId: 'sales',
      units,
    }), false)
    assert.equal(canInitiateFinalApproval({
      isActive: true,
      assignmentUnitId: 'sales',
      requestOriginUnitId: '',
      units,
    }), false)
  })
})

describe('extracted action guards use assignment inputs, not departmentType/role for solution work', () => {
  it('SUBMIT_SOLUTION follows canSubmitSolutionWork and SentToEngineer', () => {
    const allowed = existingSubmitSolutionDecision({
      isActive: true,
      assignmentUnitId: 'web',
      units,
      status: 'SentToEngineer',
    })
    assert.equal(allowed.allowed, true)

    const engineeringRoleUnflagged = existingSubmitSolutionDecision({
      isActive: true,
      assignmentUnitId: 'sales',
      units,
      status: 'SentToEngineer',
    })
    assert.equal(engineeringRoleUnflagged.allowed, false)
    assert.equal(engineeringRoleUnflagged.reason, 'WRONG_ROLE')

    const wrongStatus = existingSubmitSolutionDecision({
      isActive: true,
      assignmentUnitId: 'web',
      units,
      status: 'ImprovementRequest',
    })
    assert.equal(wrongStatus.allowed, false)
    assert.equal(wrongStatus.reason, 'WRONG_STATUS')
  })

  it('RESUBMIT_SOLUTION follows canSubmitSolutionWork and rejection evidence', () => {
    const allowed = existingResubmitSolutionDecision({
      isActive: true,
      assignmentUnitId: 'engineering',
      units,
      hasSolutionRejection: true,
      hasFinalApprovalRejection: false,
    })
    assert.equal(allowed.allowed, true)

    const adminUnflagged = existingResubmitSolutionDecision({
      isActive: true,
      assignmentUnitId: 'sales',
      units,
      hasSolutionRejection: true,
      hasFinalApprovalRejection: false,
    })
    assert.equal(adminUnflagged.allowed, false)
    assert.equal(adminUnflagged.reason, 'WRONG_ROLE')
  })

  it('INITIATE_FINAL_APPROVAL requires origin-unit assignment, not department type', () => {
    const allowed = existingInitiateFinalApprovalDecision({
      isActive: true,
      assignmentUnitId: 'sales',
      requestOriginUnitId: 'sales',
      units,
      status: 'SendBackToRequester',
    })
    assert.equal(allowed.allowed, true)

    const ancestorOnly = existingInitiateFinalApprovalDecision({
      isActive: true,
      assignmentUnitId: 'company',
      requestOriginUnitId: 'sales',
      units,
      status: 'SendBackToRequester',
    })
    assert.equal(ancestorOnly.allowed, true)

    const missingOrigin = existingInitiateFinalApprovalDecision({
      isActive: true,
      assignmentUnitId: 'sales',
      requestOriginUnitId: '',
      units,
      status: 'SendBackToRequester',
    })
    assert.equal(missingOrigin.allowed, false)
  })

  it('RESUBMIT_FINAL_APPROVAL keeps origin membership and rejection evidence', () => {
    const denied = existingResubmitFinalApprovalDecision({
      isActive: true,
      assignmentUnitId: 'web',
      requestOriginUnitId: 'sales',
      units,
      status: 'SendBackToRequester',
      hasFinalApprovalRejection: true,
    })
    assert.equal(denied.allowed, false)

    const allowed = existingResubmitFinalApprovalDecision({
      isActive: true,
      assignmentUnitId: 'sales',
      requestOriginUnitId: 'sales',
      units,
      status: 'SendBackToRequester',
      hasFinalApprovalRejection: true,
    })
    assert.equal(allowed.allowed, true)
  })

  it('ASSIGN_ENGINEERS stays on the engineering ROLE', () => {
    assert.equal(existingAssignEngineersDecision({ userRole: 'engineering', status: 'SentToEngineer' }).allowed, true)
    assert.equal(existingAssignEngineersDecision({ userRole: 'admin', status: 'SentToEngineer' }).allowed, false)
    assert.equal(existingAssignEngineersDecision({ userRole: 'general_dept', status: 'SentToEngineer' }).reason, 'WRONG_ROLE')
  })
})

describe('evaluateRequestAction gating is unchanged (active / visible / current-step)', () => {
  it('does not grant operations from canView or admin/engineering role alone', () => {
    const context = policyContext({
      ASSIGN_ENGINEERS: { allowed: true, reason: 'ALLOWED' },
      RESUBMIT_REQUEST: { allowed: false, reason: 'NOT_OWNER' },
      APPROVE_REQUEST: { allowed: false, reason: 'NOT_PENDING_APPROVAL' },
    })
    assert.equal(evaluateRequestAction('ASSIGN_ENGINEERS', context).allowed, true)
    assert.equal(evaluateRequestAction('RESUBMIT_REQUEST', context).allowed, false)
    assert.equal(evaluateRequestAction('APPROVE_REQUEST', context).allowed, false)
  })

  it('denies inactive and not-visible actors even when an existing guard allows the action', () => {
    const inactive = policyContext(
      { ASSIGN_ENGINEERS: { allowed: true, reason: 'ALLOWED' } },
      { actor: { id: 'worker-1', role: 'engineering', isActive: false, assignmentUnitId: 'web' } },
    )
    assert.equal(evaluateRequestAction('ASSIGN_ENGINEERS', inactive).reason, 'INACTIVE')

    const hidden = policyContext(
      { ASSIGN_ENGINEERS: { allowed: true, reason: 'ALLOWED' } },
      { canView: false },
    )
    assert.equal(evaluateRequestAction('ASSIGN_ENGINEERS', hidden).reason, 'NOT_VISIBLE')
  })

  it('approval and rejection stay on the current-step checker, never a level helper', () => {
    const context = policyContext({
      APPROVE_REQUEST: { allowed: true, reason: 'ALLOWED' },
      REJECT_REQUEST: { allowed: true, reason: 'ALLOWED' },
    })
    assert.equal(evaluateRequestAction('APPROVE_REQUEST', context).reason, 'NOT_PENDING_APPROVAL')
    assert.equal(evaluateRequestAction('REJECT_REQUEST', context).reason, 'NOT_PENDING_APPROVAL')
    assert.equal(shouldShowActionButton('APPROVE_REQUEST', { allowed: false, reason: 'NOT_PENDING_APPROVAL' }), false)
  })
})

describe('getModalTypeForStatus still consumes capability booleans', () => {
  it('shows submit-solution on SentToEngineer when solution-work is allowed', () => {
    const config = getModalTypeForStatus(
      'SentToEngineer',
      false,
      false,
      false,
      false,
      false,
      true,
    )
    assert.equal(config.modalType, 'completed-request')
    assert.equal(config.showSubmitSolutionButton, true)
  })

  it('shows submit-final on SendBackToRequester when origin-unit initiation is allowed', () => {
    const config = getModalTypeForStatus(
      'SendBackToRequester',
      false,
      true,
      false,
      false,
      true,
      false,
    )
    assert.equal(config.modalType, 'completed-solution')
    assert.equal(config.showSubmitFinalApprovalButton, true)
  })
})

describe('B10 source contract — department-typed helpers gone; engineering ROLE is assignment/sub-task only', () => {
  it('removes canUserApproveAtLevel and department-typed submit helpers', () => {
    const source = read('src/lib/permission-checks.ts')
    assert.match(source, /export function canSubmitSolutionWork/)
    assert.match(source, /export function canInitiateFinalApproval/)
    assert.match(source, /canWorkOnSolutions/)
    assert.doesNotMatch(source, /export function canUserApproveAtLevel/)
    assert.doesNotMatch(source, /export function canUserSubmitSolution/)
    assert.doesNotMatch(source, /export function canUserSubmitFinalApproval/)
    assert.doesNotMatch(source, /canInitiateFinalApprovalByOrigin/)
    assert.doesNotMatch(source, /userDepartmentType === ['"]ENGINEERING['"]/)
    assert.match(source, /export function canUserAssignEngineers/)
    assert.match(source, /userRole === ['"]engineering['"]/)
    const solutionWork = source.slice(source.indexOf('export function canSubmitSolutionWork'), source.indexOf('export function canInitiateFinalApproval'))
    assert.doesNotMatch(solutionWork, /userRole === ['"]engineering['"]/)
    const initiate = source.slice(source.indexOf('export function canInitiateFinalApproval'), source.indexOf('export function canUserAssignEngineers'))
    assert.doesNotMatch(initiate, /userRole === ['"]engineering['"]/)
  })

  it('action-permissions inputs are assignmentUnitId + units + requestOriginUnitId', () => {
    const source = read('src/lib/action-permissions.ts')
    assert.match(source, /assignmentUnitId/)
    assert.match(source, /requestOriginUnitId/)
    assert.match(source, /canSubmitSolutionWork/)
    assert.match(source, /canInitiateFinalApproval/)
    assert.doesNotMatch(source, /departmentType/)
    assert.doesNotMatch(source, /userDepartmentId/)
    assert.doesNotMatch(source, /isTypedUnitRequest/)
    assert.doesNotMatch(source, /isEngineeringUser/)
    assert.match(source, /canUserAssignEngineers/)
    assert.match(source, /CURRENT_STEP_ACTIONS/)
  })

  it('capabilities load assignment/units, not organization_position_assignments or department type', () => {
    const source = read('src/server-actions/request-action-capabilities.ts')
    assert.match(source, /organization_assignments/)
    assert.match(source, /canSubmitSolutionWork|assignmentUnitId/)
    assert.doesNotMatch(source, /organization_position_assignments/)
    assert.doesNotMatch(source, /departmentType/)
    assert.doesNotMatch(source, /department: \{ select: \{ type: true \} \}/)
  })

  it('completed-request submit button is capability-driven, not canUserSubmitSolution', () => {
    const modal = read('src/components/requests/completed-request-modal.tsx')
    assert.doesNotMatch(modal, /canUserSubmitSolution/)
    assert.match(modal, /onSubmitSolution/)
  })
})

describe('re-based approval-action-pending-state source contracts', () => {
  function selfClosingTags(source: string, component: string): string[] {
    return [...source.matchAll(new RegExp(`<${component}\\b[\\s\\S]*?\\n\\s*/>`, 'g'))].map((match) => match[0])
  }

  it('wires the router pending state into every active approval action modal', () => {
    const router = read('src/components/requests/request-modal-router.tsx')
    const expectedInstances = new Map([
      ['ApproverModal', 1],
      ['SolutionModal', 1],
      ['SubmitFinalApprovalModal', 2],
      ['FinalApprovalResubmitModal', 1],
    ])
    for (const [component, count] of expectedInstances) {
      const tags = selfClosingTags(router, component)
      assert.equal(tags.length, count, `expected ${count} ${component} instance(s) in the request modal router`)
      for (const tag of tags) {
        assert.match(tag, /\bisSubmitting=\{isSubmitting\}/, `${component} must receive the authoritative router pending state`)
      }
    }
  })

  it('keeps request, solution, and final decision controls locked until their callbacks settle', () => {
    const approverModal = read('src/components/requests/approver-modal.tsx')
    const solutionModal = read('src/components/requests/solution-modal.tsx')
    for (const [name, source] of [
      ['ApproverModal', approverModal],
      ['SolutionModal', solutionModal],
    ] as const) {
      assert.match(source, /isSubmitting\?: boolean;/, `${name} needs a pending prop`)
      assert.match(source, /await onApprove\?\./, `${name} must await approval completion`)
      assert.match(source, /await onReject\?\./, `${name} must await rejection completion`)
      assert.match(source, /disabled=\{isSubmitting\}/, `${name} must disable action controls while pending`)
      assert.match(
        source,
        /isSubmitting\s*\?\s*"Approving\.\.\."\s*:\s*"(?:Confirm Approval|Approve Solution)"/,
        `${name} must expose approval progress`,
      )
      assert.match(
        source,
        /isSubmitting\s*\?\s*"Rejecting\.\.\."\s*:\s*"Confirm Rejection"/,
        `${name} must expose rejection progress`,
      )
    }
  })

  it('keeps final approval start and restart controls locked until their callbacks settle', () => {
    const startModal = read('src/components/requests/submit-final-approval-modal.tsx')
    const restartModal = read('src/components/requests/final-approval-resubmit-modal.tsx')
    assert.match(startModal, /isSubmitting\?: boolean;/)
    assert.match(startModal, /await onSubmit\(/)
    assert.match(startModal, /disabled=\{isSubmitting\}/)
    assert.match(startModal, /isSubmitting\s*\?\s*"Starting\.\.\."\s*:\s*"Start Final Approval"/)
    assert.match(restartModal, /isSubmitting\?: boolean;/)
    assert.match(restartModal, /await onRestart\(/)
    assert.match(restartModal, /disabled=\{isSubmitting\}/)
    assert.match(restartModal, /isSubmitting\s*\?\s*"Restarting\.\.\."\s*:\s*"Restart Final Approval"/)
  })

  it('announces pending actions and locks an already-open approver search', () => {
    const actionSources = [
      read('src/components/requests/approver-modal.tsx'),
      read('src/components/requests/solution-modal.tsx'),
      read('src/components/requests/submit-final-approval-modal.tsx'),
      read('src/components/requests/final-approval-resubmit-modal.tsx'),
    ]
    for (const source of actionSources) {
      assert.match(source, /aria-busy=\{isSubmitting\}/)
    }
    const searchField = read('src/components/approvals/approver-search-field.tsx')
    assert.match(searchField, /disabled\?: boolean/)
    assert.match(searchField, /disabled=\{disabled\}/)
    for (const source of actionSources.slice(2)) {
      assert.match(source, /<ApproverSearchField[\s\S]*?disabled=\{disabled\}[\s\S]*?\/>/)
    }
  })
})

describe('attachment write guards are assignment-based, not engineering ROLE', () => {
  it('upload allows requester or solution-work assignment in SentToEngineer', () => {
    const requester = existingUploadAttachmentDecision({
      isRequester: true,
      isActive: true,
      assignmentUnitId: 'sales',
      units,
      status: 'ImprovementRequest',
    })
    assert.equal(requester.allowed, true)

    const solutionWork = existingUploadAttachmentDecision({
      isRequester: false,
      isActive: true,
      assignmentUnitId: 'web',
      units,
      status: 'SentToEngineer',
    })
    assert.equal(solutionWork.allowed, true)

    const engineeringRoleOnly = existingUploadAttachmentDecision({
      isRequester: false,
      isActive: true,
      assignmentUnitId: 'sales',
      units,
      status: 'SentToEngineer',
    })
    assert.equal(engineeringRoleOnly.allowed, false)
  })

  it('delete allows uploader, requester, or solution-work assignment in engineering-phase', () => {
    const uploader = existingDeleteAttachmentDecision({
      isUploader: true,
      isRequester: false,
      isActive: true,
      assignmentUnitId: 'sales',
      units,
      status: 'ImprovementRequest',
    })
    assert.equal(uploader.allowed, true)

    const solutionWork = existingDeleteAttachmentDecision({
      isUploader: false,
      isRequester: false,
      isActive: true,
      assignmentUnitId: 'engineering',
      units,
      status: 'DesignCostEstimationApproval',
    })
    assert.equal(solutionWork.allowed, true)

    const viewer = existingDeleteAttachmentDecision({
      isUploader: false,
      isRequester: false,
      isActive: true,
      assignmentUnitId: 'sales',
      units,
      status: 'SentToEngineer',
    })
    assert.equal(viewer.allowed, false)
  })
})
