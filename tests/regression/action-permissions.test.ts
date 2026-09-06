import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  evaluateRequestAction,
  existingAssignEngineersDecision,
  existingCancelRequestDecision,
  existingDeleteAttachmentDecision,
  existingInitiateFinalApprovalDecision,
  existingResubmitFinalApprovalDecision,
  existingResubmitRequestDecision,
  existingResubmitSolutionDecision,
  existingSubmitSolutionDecision,
  existingUploadAttachmentDecision,
  shouldShowActionButton,
  type ActionPermissionContext,
} from '@/lib/action-permissions'
import { canUserAssignEngineers } from '@/lib/permission-checks'

const read = (path: string) => readFileSync(path, 'utf8')

function engineeringViewerContext(
  existingActionDecisions: ActionPermissionContext['existingActionDecisions'],
): ActionPermissionContext {
  return {
    actor: {
      id: 'engineering-1',
      role: 'engineering',
      isActive: true,
      departmentId: 'eng',
      departmentType: 'ENGINEERING',
    },
    request: {
      requesterId: 'requester-1',
      departmentId: 'pd1',
      organizationUnitId: 'section-pd1',
      status: 'SentToEngineer',
    },
    canView: true,
    approval: { canApprove: false },
    assignedEngineer: false,
    existingActionDecisions,
  }
}

describe('action permissions are independent from visibility', () => {
  it('does not grant operations merely because Engineering/Admin can read', () => {
    const context = {
      actor: { id: 'engineering-1', role: 'engineering', isActive: true, departmentId: 'eng', departmentType: 'ENGINEERING' },
      request: { requesterId: 'requester-1', departmentId: 'pd1', organizationUnitId: 'section-pd1', status: 'SentToEngineer' },
      canView: true,
      approval: { canApprove: false },
      assignedEngineer: false,
      existingActionDecisions: {
        ASSIGN_ENGINEERS: { allowed: true, reason: 'ALLOWED' },
        RESUBMIT_REQUEST: { allowed: false, reason: 'NOT_OWNER' },
        APPROVE_REQUEST: { allowed: false, reason: 'NOT_PENDING_APPROVAL' },
      },
    } as const
    assert.equal(evaluateRequestAction('ASSIGN_ENGINEERS', context).allowed, true)
    assert.equal(evaluateRequestAction('RESUBMIT_REQUEST', context).allowed, false)
    assert.equal(evaluateRequestAction('APPROVE_REQUEST', context).allowed, false)
  })

  it('retains ownership, role, assignment, phase, and status guards', () => {
    const context = {
      actor: { id: 'other-user', role: 'general_dept', isActive: true, departmentId: 'pd1', departmentType: 'GENERAL' },
      request: { requesterId: 'requester-1', departmentId: 'pd1', organizationUnitId: 'section-pd1', status: 'ImprovementRequest' },
      canView: true,
      approval: { canApprove: false },
      assignedEngineer: false,
      existingActionDecisions: {
        RESUBMIT_REQUEST: { allowed: false, reason: 'NOT_OWNER' },
        INITIATE_FINAL_APPROVAL: { allowed: false, reason: 'WRONG_STATUS' },
      },
    } as const
    assert.equal(evaluateRequestAction('RESUBMIT_REQUEST', context).allowed, false)
    assert.equal(evaluateRequestAction('INITIATE_FINAL_APPROVAL', context).allowed, false)
  })

  it('does not let an admin viewer resubmit or approve from canView alone', () => {
    const context = {
      actor: { id: 'admin-1', role: 'admin', isActive: true, departmentId: 'pd1', departmentType: 'GENERAL' },
      request: { requesterId: 'requester-1', departmentId: 'pd1', organizationUnitId: 'section-pd1', status: 'ImprovementRequest' },
      canView: true,
      approval: { canApprove: false },
      assignedEngineer: false,
      existingActionDecisions: {
        RESUBMIT_REQUEST: { allowed: false, reason: 'NOT_OWNER' },
        APPROVE_REQUEST: { allowed: false, reason: 'NOT_PENDING_APPROVAL' },
      },
    } as const
    assert.equal(evaluateRequestAction('RESUBMIT_REQUEST', context).allowed, false)
    assert.equal(evaluateRequestAction('APPROVE_REQUEST', context).allowed, false)
  })
})

describe('extracted existing action guards feed existingActionDecisions', () => {
  it('ASSIGN_ENGINEERS exercises the extracted existing engineering guard', () => {
    assert.equal(canUserAssignEngineers('engineering'), true)
    assert.equal(canUserAssignEngineers('admin'), false)
    assert.equal(canUserAssignEngineers('general_dept'), false)

    const assign = existingAssignEngineersDecision({
      userRole: 'engineering',
      status: 'SentToEngineer',
    })
    assert.equal(assign.allowed, true)
    assert.equal(assign.reason, 'ALLOWED')

    const deniedAdmin = existingAssignEngineersDecision({
      userRole: 'admin',
      status: 'SentToEngineer',
    })
    assert.equal(deniedAdmin.allowed, false)
    assert.equal(deniedAdmin.reason, 'WRONG_ROLE')

    const context = engineeringViewerContext({
      ASSIGN_ENGINEERS: assign,
      RESUBMIT_REQUEST: { allowed: false, reason: 'NOT_OWNER' },
      APPROVE_REQUEST: { allowed: false, reason: 'NOT_PENDING_APPROVAL' },
    })
    assert.equal(evaluateRequestAction('ASSIGN_ENGINEERS', context).allowed, true)
    assert.equal(evaluateRequestAction('RESUBMIT_REQUEST', context).allowed, false)
    assert.equal(evaluateRequestAction('APPROVE_REQUEST', context).allowed, false)
  })

  it('blocks a manager who can see descendant requests from initiating final approval without direct section membership', () => {
    const initiation = existingInitiateFinalApprovalDecision({
      status: 'SendBackToRequester',
      isTypedUnitRequest: true,
      hasDirectOriginUnitMembership: false,
      userDepartmentId: 'department-pd',
      requestDepartmentId: 'department-pd',
    })
    assert.equal(initiation.allowed, false)

    const context: ActionPermissionContext = {
      actor: {
        id: 'department-manager-1',
        role: 'general_dept',
        isActive: true,
        departmentId: 'department-pd',
        departmentType: 'GENERAL',
      },
      request: {
        requesterId: 'staff-1',
        departmentId: 'department-pd',
        organizationUnitId: 'section-pd1',
        status: 'SendBackToRequester',
      },
      canView: true,
      approval: { canApprove: false },
      assignedEngineer: false,
      existingActionDecisions: {
        INITIATE_FINAL_APPROVAL: initiation,
      },
    }
    assert.equal(evaluateRequestAction('INITIATE_FINAL_APPROVAL', context).allowed, false)
  })

  it('retains same-section final initiation for ordinary legacy rows', () => {
    const sameSection = existingInitiateFinalApprovalDecision({
      status: 'SendBackToRequester',
      isTypedUnitRequest: false,
      hasDirectOriginUnitMembership: false,
      userDepartmentId: 'department-pd',
      requestDepartmentId: 'department-pd',
    })
    assert.equal(sameSection.allowed, true)

    const otherSection = existingInitiateFinalApprovalDecision({
      status: 'SendBackToRequester',
      isTypedUnitRequest: false,
      hasDirectOriginUnitMembership: false,
      userDepartmentId: 'department-eng',
      requestDepartmentId: 'department-pd',
    })
    assert.equal(otherSection.allowed, false)
  })

  it('replaces legacy same-department membership with direct origin-unit membership for NEW parent-unit requests', () => {
    const ancestorOnly = existingInitiateFinalApprovalDecision({
      status: 'SendBackToRequester',
      isTypedUnitRequest: true,
      hasDirectOriginUnitMembership: false,
      userDepartmentId: 'department-pd',
      requestDepartmentId: 'department-pd',
    })
    assert.equal(ancestorOnly.allowed, false)

    const directMember = existingInitiateFinalApprovalDecision({
      status: 'SendBackToRequester',
      isTypedUnitRequest: true,
      hasDirectOriginUnitMembership: true,
      userDepartmentId: 'department-pd',
      requestDepartmentId: 'department-pd',
    })
    assert.equal(directMember.allowed, true)
  })

  it('keeps solution resubmit on the engineering role/rejection guard', () => {
    const allowed = existingResubmitSolutionDecision({
      userRole: 'engineering',
      hasSolutionRejection: true,
      hasFinalApprovalRejection: false,
    })
    assert.equal(allowed.allowed, true)

    const adminViewer = existingResubmitSolutionDecision({
      userRole: 'admin',
      hasSolutionRejection: true,
      hasFinalApprovalRejection: false,
    })
    assert.equal(adminViewer.allowed, false)
    assert.equal(adminViewer.reason, 'WRONG_ROLE')

    const context = engineeringViewerContext({
      RESUBMIT_SOLUTION: allowed,
    })
    assert.equal(evaluateRequestAction('RESUBMIT_SOLUTION', context).allowed, true)
  })

  it('keeps final resubmit on origin membership rather than descendant visibility', () => {
    const denied = existingResubmitFinalApprovalDecision({
      status: 'SendBackToRequester',
      isTypedUnitRequest: true,
      hasDirectOriginUnitMembership: false,
      userDepartmentId: 'department-pd',
      requestDepartmentId: 'department-pd',
      hasFinalApprovalRejection: true,
    })
    assert.equal(denied.allowed, false)

    const allowed = existingResubmitFinalApprovalDecision({
      status: 'SendBackToRequester',
      isTypedUnitRequest: true,
      hasDirectOriginUnitMembership: true,
      userDepartmentId: 'department-pd',
      requestDepartmentId: 'department-pd',
      hasFinalApprovalRejection: true,
    })
    assert.equal(allowed.allowed, true)
  })

  it('keeps attachment mutation on write-specific guards, not section sharing', () => {
    const uploadRequester = existingUploadAttachmentDecision({
      isRequester: true,
      isEngineeringUser: false,
      status: 'ImprovementRequest',
    })
    assert.equal(uploadRequester.allowed, true)

    const uploadViewer = existingUploadAttachmentDecision({
      isRequester: false,
      isEngineeringUser: false,
      status: 'ImprovementRequest',
    })
    assert.equal(uploadViewer.allowed, false)

    const uploadEngineer = existingUploadAttachmentDecision({
      isRequester: false,
      isEngineeringUser: true,
      status: 'SentToEngineer',
    })
    assert.equal(uploadEngineer.allowed, true)

    const deleteUploader = existingDeleteAttachmentDecision({
      isUploader: true,
      isRequester: false,
      isEngineeringUser: false,
      status: 'ImprovementRequest',
    })
    assert.equal(deleteUploader.allowed, true)

    const deleteSharedViewer = existingDeleteAttachmentDecision({
      isUploader: false,
      isRequester: false,
      isEngineeringUser: false,
      status: 'SentToEngineer',
    })
    assert.equal(deleteSharedViewer.allowed, false)

    const context = engineeringViewerContext({
      UPLOAD_ATTACHMENT: uploadEngineer,
      DELETE_ATTACHMENT: deleteSharedViewer,
    })
    assert.equal(evaluateRequestAction('UPLOAD_ATTACHMENT', context).allowed, true)
    assert.equal(evaluateRequestAction('DELETE_ATTACHMENT', context).allowed, false)
  })

  it('keeps cancellation on the requester policy, not visibility', () => {
    const owner = existingCancelRequestDecision({
      userId: 'requester-1',
      requesterId: 'requester-1',
      status: 'SentToEngineer',
      hasRejectedRequestApproval: false,
      hasPendingRequestApprovals: false,
      hasPendingSolutionApprovals: false,
    })
    assert.equal(owner.allowed, true)

    const viewer = existingCancelRequestDecision({
      userId: 'engineering-1',
      requesterId: 'requester-1',
      status: 'SentToEngineer',
      hasRejectedRequestApproval: false,
      hasPendingRequestApprovals: false,
      hasPendingSolutionApprovals: false,
    })
    assert.equal(viewer.allowed, false)
    assert.equal(viewer.reason, 'NOT_OWNER')

    const context = engineeringViewerContext({
      CANCEL_REQUEST: viewer,
    })
    assert.equal(evaluateRequestAction('CANCEL_REQUEST', context).allowed, false)
  })

  it('keeps request resubmit on owner and department-approval status', () => {
    const notOwner = existingResubmitRequestDecision({
      actorId: 'other-user',
      requesterId: 'requester-1',
      status: 'ImprovementRequest',
      hasRejection: true,
    })
    assert.equal(notOwner.allowed, false)
    assert.equal(notOwner.reason, 'NOT_OWNER')

    const owner = existingResubmitRequestDecision({
      actorId: 'requester-1',
      requesterId: 'requester-1',
      status: 'ImprovementRequest',
      hasRejection: true,
    })
    assert.equal(owner.allowed, true)
  })

  it('keeps solution submit on the engineering role and SentToEngineer status', () => {
    const allowed = existingSubmitSolutionDecision({
      userRole: 'engineering',
      status: 'SentToEngineer',
    })
    assert.equal(allowed.allowed, true)

    const wrongRole = existingSubmitSolutionDecision({
      userRole: 'admin',
      status: 'SentToEngineer',
    })
    assert.equal(wrongRole.allowed, false)
  })
})

describe('evaluateRequestAction composes active/read/current-step checks', () => {
  it('denies when existingActionDecisions omit the action', () => {
    const context = engineeringViewerContext({})
    const decision = evaluateRequestAction('CANCEL_REQUEST', context)
    assert.equal(decision.allowed, false)
  })

  it('denies inactive actors even when an existing guard allows the action', () => {
    const context: ActionPermissionContext = {
      ...engineeringViewerContext({
        ASSIGN_ENGINEERS: { allowed: true, reason: 'ALLOWED' },
      }),
      actor: {
        id: 'engineering-1',
        role: 'engineering',
        isActive: false,
        departmentId: 'eng',
        departmentType: 'ENGINEERING',
      },
    }
    const decision = evaluateRequestAction('ASSIGN_ENGINEERS', context)
    assert.equal(decision.allowed, false)
    assert.equal(decision.reason, 'INACTIVE')
  })

  it('denies actors who cannot view even when an existing guard allows the action', () => {
    const context: ActionPermissionContext = {
      ...engineeringViewerContext({
        ASSIGN_ENGINEERS: { allowed: true, reason: 'ALLOWED' },
      }),
      canView: false,
    }
    const decision = evaluateRequestAction('ASSIGN_ENGINEERS', context)
    assert.equal(decision.allowed, false)
    assert.equal(decision.reason, 'NOT_VISIBLE')
  })

  it('applies the current-step checker to approval and rejection actions', () => {
    const context = engineeringViewerContext({
      APPROVE_REQUEST: { allowed: true, reason: 'ALLOWED' },
      REJECT_REQUEST: { allowed: true, reason: 'ALLOWED' },
    })
    assert.equal(evaluateRequestAction('APPROVE_REQUEST', context).allowed, false)
    assert.equal(evaluateRequestAction('APPROVE_REQUEST', context).reason, 'NOT_PENDING_APPROVAL')
    assert.equal(evaluateRequestAction('REJECT_REQUEST', context).allowed, false)
    assert.equal(evaluateRequestAction('REJECT_REQUEST', context).reason, 'NOT_PENDING_APPROVAL')
  })

  it('shows UI buttons only from the composed decision', () => {
    assert.equal(shouldShowActionButton('ASSIGN_ENGINEERS', { allowed: true, reason: 'ALLOWED' }), true)
    assert.equal(shouldShowActionButton('RESUBMIT_REQUEST', { allowed: false, reason: 'NOT_OWNER' }), false)
  })
})

describe('server and UI wiring keep action policy separate from view', () => {
  it('derives getRequestActionCapabilities from the authenticated session, not a client userId', () => {
    const source = read('src/lib/action-permissions.ts')
    assert.match(source, /export async function getRequestActionCapabilities\(requestId: string\)/)
    assert.doesNotMatch(source, /getRequestActionCapabilities\(requestId:\s*string,\s*userId/)
    assert.match(source, /auth\(\)/)
    assert.match(source, /existingActionDecisions/)
    assert.match(source, /evaluateRequestAction/)
  })

  it('wires mutating server actions through the policy after auth and before mutation', () => {
    const files: Array<[string, string[]]> = [
      ['src/server-actions/requests.ts', ['evaluateRequestAction', 'RESUBMIT_REQUEST', 'CANCEL_REQUEST', 'ASSIGN_ENGINEERS']],
      ['src/server-actions/approvals.ts', ['evaluateRequestAction', 'APPROVE_REQUEST', 'REJECT_REQUEST']],
      ['src/server-actions/solutions.ts', [
        'evaluateRequestAction',
        'SUBMIT_SOLUTION',
        'RESUBMIT_SOLUTION',
        'INITIATE_FINAL_APPROVAL',
        'APPROVE_SOLUTION',
        'REJECT_SOLUTION',
        'APPROVE_FINAL',
        'REJECT_FINAL',
      ]],
      ['src/server-actions/files.ts', ['evaluateRequestAction', 'UPLOAD_ATTACHMENT', 'DELETE_ATTACHMENT']],
      ['src/server-actions/engineering-sub-tasks.ts', ['evaluateRequestAction', 'MANAGE_SUB_TASKS']],
    ]
    for (const [path, needles] of files) {
      const source = read(path)
      for (const needle of needles) {
        assert.match(source, new RegExp(needle), `${path} must reference ${needle}`)
      }
    }
  })

  it('gates RequestModalRouter buttons from session-derived capabilities without a second handwritten policy', () => {
    const source = read('src/components/requests/request-modal-router.tsx')
    assert.match(source, /getRequestActionCapabilities/)
    assert.match(source, /shouldShowActionButton/)
    assert.doesNotMatch(source, /getRequestActionCapabilities\(\s*requestId\s*,\s*user/)
    assert.doesNotMatch(source, /candidate.?reassign/i)
  })
})
