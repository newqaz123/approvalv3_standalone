import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as ts from 'typescript'
import {
  NOTIFICATION_COMPATIBILITY_POLICY,
  resolveApprovalNeededRecipients,
  resolveStatusBroadcastRecipients,
} from '@/lib/notification-recipients'
import {
  LEGACY_NOTIFICATION_EXPECTATIONS,
  fakeNotificationDb,
} from '../fixtures/organization-approval-fixtures'
import {
  SCENARIO,
  baselineRequest,
  baselineSolution,
  createHarness,
  departmentRows,
  enableTestSmtp,
  workflowUsers,
} from '../fixtures/organization-approval-harness'

const REQUEST_ID = SCENARIO.requestId
const SOLUTION_ID = SCENARIO.solutionId

describe('compatibility-first notifications', () => {
  it('uses only the immutable current NEW candidate group', async () => {
    const recipients = await resolveApprovalNeededRecipients(fakeNotificationDb({
      row: { routingMode: 'SNAPSHOT_GROUP', candidateGroupId: 'group-1', requiredLevel: null },
      groups: { 'group-1': ['u1', 'u1', 'inactive-u2'] },
      activeUsers: ['u1'],
      livePositionHolders: ['replacement-u3'],
    }), { approvalId: 'a1', phase: 'REQUEST' })
    assert.deepEqual(recipients, ['u1'])
  })

  it('uses legacy level lookup for pre-cutover rows', async () => {
    const recipients = await resolveApprovalNeededRecipients(fakeNotificationDb({
      row: { routingMode: 'LEGACY_LEVEL', candidateGroupId: null, requiredLevel: 3 },
      legacyLevelHolders: ['legacy-u3'],
    }), { approvalId: 'legacy-a1', phase: 'REQUEST' })
    assert.deepEqual(recipients, ['legacy-u3'])
  })

  it('never consults live position holders, descendants, or ancestor managers for SNAPSHOT_GROUP', async () => {
    const db = fakeNotificationDb({
      row: { routingMode: 'SNAPSHOT_GROUP', candidateGroupId: 'group-1', requiredLevel: null },
      groups: { 'group-1': ['u1'] },
      activeUsers: ['u1', 'replacement-u3', 'ancestor-manager', 'descendant-staff'],
      livePositionHolders: ['replacement-u3', 'ancestor-manager', 'descendant-staff'],
    })
    const recipients = await resolveApprovalNeededRecipients(db, { approvalId: 'a1', phase: 'REQUEST' })
    assert.deepEqual(recipients, ['u1'])
    assert.equal(
      'findLivePositionHolders' in db,
      false,
      'the recipient port has no live-holder lookup; SNAPSHOT resolution cannot consult replacements',
    )
  })

  it('preserves custom ordered IDs: solution notify-all vs final current-person only', async () => {
    const all = await resolveApprovalNeededRecipients(fakeNotificationDb({
      row: { routingMode: 'CUSTOM_PERSON', candidateGroupId: null, requiredLevel: null },
      customRecipientIds: ['custom-1', 'custom-1', 'custom-2', 'custom-3'],
    }), { approvalId: 'sol-custom-1', phase: 'SOLUTION' })
    assert.deepEqual(all, ['custom-1', 'custom-2', 'custom-3'])

    const currentPerson = await resolveApprovalNeededRecipients(fakeNotificationDb({
      row: { routingMode: 'CUSTOM_PERSON', candidateGroupId: null, requiredLevel: null },
      customRecipientIds: ['custom-2'],
    }), { approvalId: 'final-custom-2', phase: 'FINAL' })
    assert.deepEqual(currentPerson, ['custom-2'])
  })

  it('maps a legacy department audience to reviewed section members and honors exclusions', async () => {
    const recipients = await resolveStatusBroadcastRecipients(fakeNotificationDb({
      row: { routingMode: 'LEGACY_LEVEL', candidateGroupId: null, requiredLevel: 2 },
      reviewedSectionRecipientIds: ['staff-1', 'staff-1', 'supervisor-1', 'inactive-section'],
      activeUsers: ['staff-1', 'supervisor-1'],
    }), { legacyDepartmentId: 'department-pd', requestId: 'req-1', excludeUserIds: ['supervisor-1'] })
    assert.deepEqual(recipients, ['staff-1'])
  })

  it('uses persisted origin-unit direct members when departmentId is null, never the first legacy department', async () => {
    const recipients = await resolveStatusBroadcastRecipients(fakeNotificationDb({
      row: { routingMode: 'SNAPSHOT_GROUP', candidateGroupId: 'group-1', requiredLevel: null },
      originUnitMemberIds: ['department-manager-1', 'department-manager-1'],
      firstLegacyDepartmentMemberIds: ['staff-1', 'supervisor-1'],
      activeUsers: ['department-manager-1', 'staff-1', 'supervisor-1'],
    }), { legacyDepartmentId: null, requestId: 'org-owned-1' })
    assert.deepEqual(recipients, ['department-manager-1'])
  })

  it('keeps visibility from becoming a notification subscription', () => {
    assert.equal(NOTIFICATION_COMPATIBILITY_POLICY.allowVisibilityAsSubscription, false)
    assert.deepEqual(NOTIFICATION_COMPATIBILITY_POLICY.preserveEventTypes, [
      'approval_needed',
      'approval_granted',
      'approval_rejected',
      'status_changed',
      'request_assigned',
      'solution_ready',
      'final_approval_needed',
    ])
    assert.equal(NOTIFICATION_COMPATIBILITY_POLICY.preserveCustomNotifyAllAtSubmit, true)
    assert.equal(NOTIFICATION_COMPATIBILITY_POLICY.preserveSectionWideStatusBroadcasts, true)
  })
})

describe('Task 1 baseline notification matrix stays exact for legacy events', () => {
  it('records the full event/channel/recipient sequence and does not invent cancellation or resubmission events', () => {
    const cases = LEGACY_NOTIFICATION_EXPECTATIONS.map((entry) => ({
      case: entry.case,
      eventType: entry.eventType,
      channel: entry.channel,
      recipientIds: [...entry.recipientIds],
    }))
    assert.deepEqual(cases, [
      { case: 'request submit approval needed', eventType: 'approval_needed', channel: 'in_app+email', recipientIds: ['supervisor-1'] },
      { case: 'request approval intermediate next approver', eventType: 'approval_needed', channel: 'in_app+email', recipientIds: ['department-manager-1'] },
      { case: 'request approval phase completed engineering task broadcast', eventType: 'request_assigned', channel: 'in_app_department_broadcast+email', recipientIds: [] },
      { case: 'request approval phase other status requester notice', eventType: 'status_changed', channel: 'in_app+email', recipientIds: ['staff-1'] },
      { case: 'solution submit custom chain all at submit', eventType: 'approval_needed', channel: 'in_app+email', recipientIds: [] },
      { case: 'solution submit hierarchy chain first level', eventType: 'approval_needed', channel: 'in_app+email', recipientIds: [] },
      { case: 'solution submit auto top level requester ready', eventType: 'solution_ready', channel: 'in_app+email', recipientIds: ['staff-1'] },
      { case: 'solution approval intermediate next approver', eventType: 'approval_needed', channel: 'in_app+email', recipientIds: ['supervisor-1'] },
      { case: 'solution approval completed requester department ready', eventType: 'solution_ready', channel: 'in_app_department_broadcast+email', recipientIds: [] },
      { case: 'solution rejected submitter rework', eventType: 'approval_rejected', channel: 'in_app+email', recipientIds: ['engineer-1'] },
      { case: 'solution resubmit custom chain all approvers', eventType: 'approval_needed', channel: 'in_app+email', recipientIds: [] },
      { case: 'final initiate custom chain first step only', eventType: 'final_approval_needed', channel: 'in_app+email', recipientIds: [] },
      { case: 'final initiate hierarchy chain first level', eventType: 'final_approval_needed', channel: 'in_app+email', recipientIds: [] },
      { case: 'final initiate auto top level completed notice', eventType: 'status_changed', channel: 'in_app', recipientIds: ['staff-1'] },
      { case: 'final approval intermediate next approver', eventType: 'final_approval_needed', channel: 'in_app+email', recipientIds: [] },
      { case: 'final approval completed department broadcast', eventType: 'approval_granted', channel: 'in_app_department_broadcast+email', recipientIds: [] },
      { case: 'final approval rejected engineering rework', eventType: 'approval_rejected', channel: 'in_app_department_broadcast+email', recipientIds: [] },
      { case: 'request cancelled', eventType: null, channel: 'in_app', recipientIds: [] },
      { case: 'request completed manual', eventType: 'status_changed', channel: 'in_app', recipientIds: ['staff-1'] },
    ])
    const cancellation = LEGACY_NOTIFICATION_EXPECTATIONS.find((entry) => entry.case === 'request cancelled')
    assert.equal(cancellation?.eventType, null)
    const customSolution = LEGACY_NOTIFICATION_EXPECTATIONS.find((entry) => entry.case === 'solution submit custom chain all at submit')
    const customFinal = LEGACY_NOTIFICATION_EXPECTATIONS.find((entry) => entry.case === 'final initiate custom chain first step only')
    assert.match(customSolution?.recipientsRule ?? '', /every id in the submitted customApproverIds array verbatim/)
    assert.match(customFinal?.recipientsRule ?? '', /first pending final-approval row only/)
  })
})

function requestSnapshotSeed(input: {
  actorId: string
  nextMemberId: string
  inactiveMemberId?: string
}): Record<string, unknown> {
  return {
    organization_units: [
      { id: 'section-pd1', name: 'PD1', unitType: 'SECTION', operationalType: 'GENERAL', isActive: true },
    ],
    approval_instances: [
      {
        id: 'instance-req-snap-1',
        requestId: REQUEST_ID,
        phase: 'REQUEST',
        originUserId: 'staff-1',
        originUnitId: 'section-pd1',
        originContext: {},
        routingMode: 'SNAPSHOT_GROUP',
        state: 'PENDING',
        attempt: 1,
        supersededAt: null,
      },
    ],
    approval_candidate_groups: [
      {
        id: 'group-req-current',
        approvalInstanceId: 'instance-req-snap-1',
        requiredPosition: 'SUPERVISOR',
        scopeUnitId: 'section-pd1',
      },
      {
        id: 'group-req-next',
        approvalInstanceId: 'instance-req-snap-1',
        requiredPosition: 'DEPARTMENT_MANAGER',
        scopeUnitId: 'department-pd',
      },
    ],
    approval_candidate_group_members: [
      {
        id: 'member-req-current',
        candidateGroupId: 'group-req-current',
        userId: input.actorId,
        capturedDisplayName: input.actorId,
      },
      {
        id: 'member-req-next',
        candidateGroupId: 'group-req-next',
        userId: input.nextMemberId,
        capturedDisplayName: input.nextMemberId,
      },
      ...(input.inactiveMemberId
        ? [{
            id: 'member-req-next-inactive',
            candidateGroupId: 'group-req-next',
            userId: input.inactiveMemberId,
            capturedDisplayName: input.inactiveMemberId,
          }]
        : []),
    ],
    request_approvals: [
      {
        id: 'ra-snap-1',
        requestId: REQUEST_ID,
        order: 1,
        status: 'pending',
        isFinalApproval: false,
        routingMode: 'SNAPSHOT_GROUP',
        integrityVersion: 1,
        instanceId: 'instance-req-snap-1',
        candidateGroupId: 'group-req-current',
        requiredPosition: 'SUPERVISOR',
        requiredLevel: null,
      },
      {
        id: 'ra-snap-2',
        requestId: REQUEST_ID,
        order: 2,
        status: 'pending',
        isFinalApproval: false,
        routingMode: 'SNAPSHOT_GROUP',
        integrityVersion: 1,
        instanceId: 'instance-req-snap-1',
        candidateGroupId: 'group-req-next',
        requiredPosition: 'DEPARTMENT_MANAGER',
        requiredLevel: null,
      },
    ],
  }
}

describe('NEW SNAPSHOT pending-group lookup (the intended difference from Task 1)', () => {
  it('notifies only active persisted members of the next SNAPSHOT group after an intermediate request approval', async () => {
    const actorId = 'supervisor-1'
    const seed = requestSnapshotSeed({
      actorId,
      nextMemberId: 'department-manager-1',
      inactiveMemberId: 'inactive-1',
    })
    const harness = createHarness({
      departments: departmentRows(),
      users: workflowUsers(),
      requests: [baselineRequest({ status: 'ImprovementRequest' })],
      ...seed,
    })
    enableTestSmtp(harness.state)
    harness.state.authUserId = actorId

    const result = (await harness.approvals.approveRequest(REQUEST_ID)) as { success: boolean }
    assert.equal(result.success, true)
    assert.equal(harness.db.requests.rows.get(REQUEST_ID)?.status, 'ImprovementRequest')
    assert.deepEqual(
      [...harness.db.rows.notifications.values()].map((row) => ({ userId: row.userId, type: row.type })),
      [{ userId: 'department-manager-1', type: 'approval_needed' }],
    )
    assert.deepEqual(harness.state.smtpMessages.map((mail) => mail.to), ['department-manager-1@example.test'])
  })

  it('broadcasts last-row org-owned SOLUTION completion to the origin unit’s direct members only', async () => {
    const actorId = SCENARIO.engineeringSupervisorId
    const harness = createHarness({
      departments: departmentRows(),
      users: workflowUsers(),
      requests: [baselineRequest({
        departmentId: null,
        organizationUnitId: 'department-pd-unit',
        status: 'DesignCostEstimationApproval',
      })],
      solutions: [baselineSolution()],
      organization_units: [
        { id: 'department-pd-unit', name: 'PD', unitType: 'DEPARTMENT', operationalType: 'GENERAL', isActive: true },
        { id: 'section-pd1', name: 'PD1', unitType: 'SECTION', parentId: 'department-pd-unit', operationalType: 'GENERAL', isActive: true },
      ],
      organization_position_assignments: [
        {
          id: 'assign-dm',
          userId: 'department-manager-1',
          unitId: 'department-pd-unit',
          positionCode: 'DEPARTMENT_MANAGER',
          isPrimary: true,
          isActive: true,
        },
        {
          id: 'assign-section-supervisor',
          userId: 'supervisor-1',
          unitId: 'section-pd1',
          positionCode: 'SUPERVISOR',
          isPrimary: true,
          isActive: true,
        },
        {
          id: 'assign-inactive',
          userId: 'inactive-1',
          unitId: 'department-pd-unit',
          positionCode: 'DEPARTMENT_MANAGER',
          isPrimary: false,
          isActive: false,
        },
      ],
      approval_instances: [
        {
          id: 'instance-sol-origin-1',
          requestId: null,
          solutionId: SOLUTION_ID,
          phase: 'SOLUTION',
          originUserId: 'engineer-1',
          originUnitId: 'department-pd-unit',
          originContext: {},
          routingMode: 'SNAPSHOT_GROUP',
          state: 'PENDING',
          attempt: 1,
          supersededAt: null,
        },
      ],
      approval_candidate_groups: [
        {
          id: 'group-sol-origin-1',
          approvalInstanceId: 'instance-sol-origin-1',
          requiredPosition: 'SUPERVISOR',
          scopeUnitId: 'department-pd-unit',
        },
      ],
      approval_candidate_group_members: [
        {
          id: 'member-sol-origin-1',
          candidateGroupId: 'group-sol-origin-1',
          userId: actorId,
          capturedDisplayName: actorId,
        },
      ],
      solution_approvals: [
        {
          id: 'sa-origin-1',
          solutionId: SOLUTION_ID,
          order: 1,
          status: 'pending',
          routingMode: 'SNAPSHOT_GROUP',
          integrityVersion: 1,
          instanceId: 'instance-sol-origin-1',
          candidateGroupId: 'group-sol-origin-1',
          requiredPosition: 'SUPERVISOR',
          requiredLevel: null,
          isCustomChain: false,
        },
      ],
    })
    enableTestSmtp(harness.state)
    harness.state.authUserId = actorId

    const result = (await harness.solutions.approveSolution(SOLUTION_ID)) as { success: boolean }
    assert.equal(result.success, true)
    assert.equal(harness.db.requests.rows.get(REQUEST_ID)?.status, 'SendBackToRequester')
    assert.deepEqual(
      [...harness.db.rows.notifications.values()].map((row) => ({ userId: row.userId, type: row.type })),
      [{ userId: 'department-manager-1', type: 'solution_ready' }],
    )
  })
})

describe('production notification wiring stays post-commit and does not add transports', () => {
  it('keeps global notification helpers out of solutions transaction callbacks after SNAPSHOT wiring', () => {
    const filePath = resolve(process.cwd(), 'src/server-actions/solutions.ts')
    const sourceText = readFileSync(filePath, 'utf8')
    const source = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    const forbiddenCalls = new Set([
      'createNotification',
      'notifyUsersInDepartment',
      'sendEmailNotification',
      'notifyNextSolutionApprover',
      'notifyNextFinalApprover',
      'notifyResolvedRecipientGroup',
    ])
    const transactionBoundaries = new Set(['$transaction', 'runSolutionTransactionWithNotifications'])
    const violations: string[] = []
    const calledName = (expression: ts.LeftHandSideExpression): string | null => {
      if (ts.isIdentifier(expression)) return expression.text
      if (ts.isPropertyAccessExpression(expression)) return expression.name.text
      return null
    }
    const inspectTransactionCallback = (callback: ts.Node) => {
      const inspect = (node: ts.Node) => {
        if (ts.isCallExpression(node)) {
          const name = calledName(node.expression)
          if (name && forbiddenCalls.has(name)) {
            const position = source.getLineAndCharacterOfPosition(node.getStart(source))
            violations.push(`${name} at line ${position.line + 1}`)
          }
        }
        ts.forEachChild(node, inspect)
      }
      inspect(callback)
    }
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        const boundaryName = calledName(node.expression)
        const callback = node.arguments[0]
        if (
          boundaryName &&
          transactionBoundaries.has(boundaryName) &&
          callback &&
          (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))
        ) {
          inspectTransactionCallback(callback.body)
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
    assert.deepEqual(violations, [], `Unsafe notification work found inside transaction callbacks:\n${violations.join('\n')}`)
  })
})
