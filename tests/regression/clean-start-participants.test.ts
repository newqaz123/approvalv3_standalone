// Clean-start participants-only notifications (Plan B Task 11).
// Re-bases tests/regression/notification-compatibility.test.ts.
// Fake db only: NO SNAPSHOT harness expansion, NO OrganizationPositionCode.
// Participant membership is the exact production-evidenced union. Sharing
// viewers, unit members, and managers without a candidate/actor row are
// never members. Event mapping is authority: status_changed → requester only.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  resolveRequestParticipants,
  type RequestParticipantsDb,
} from '@/lib/request-participants'
import {
  resolveApprovalNeededRecipients,
  type NotificationRecipientDb,
} from '@/lib/notification-recipients'

const read = (path: string) => readFileSync(path, 'utf8')

const VIEWER_ID = 'sharing-viewer-1'
const UNIT_MEMBER_ID = 'unit-member-1'
const MANAGER_ID = 'manager-no-row-1'

function fakeParticipantsDb(over: {
  requesterId?: string | null
  solutionSubmitterIds?: readonly string[]
  approvalActorIds?: readonly string[]
  solutionApprovalActorIds?: readonly string[]
  candidateMemberIds?: readonly string[]
  assignedEngineerIds?: readonly string[]
} = {}): RequestParticipantsDb {
  return {
    async findRequesterId() {
      return over.requesterId === undefined ? 'requester-1' : over.requesterId
    },
    async findSolutionSubmitterIds() {
      return over.solutionSubmitterIds ?? ['solution-submitter-1']
    },
    async findApprovalActorIds() {
      return over.approvalActorIds ?? ['approver-1', 'required-approver-1']
    },
    async findSolutionApprovalActorIds() {
      return over.solutionApprovalActorIds ?? ['solution-approver-1']
    },
    async findCurrentInstanceCandidateMemberIds() {
      return over.candidateMemberIds ?? ['candidate-1', 'candidate-2']
    },
    async findAssignedEngineerIds() {
      return over.assignedEngineerIds ?? ['engineer-1']
    },
  }
}

function fakeRecipientDb(over: {
  row?: {
    routingMode: 'SNAPSHOT_GROUP' | 'CUSTOM_PERSON'
    candidateGroupId: string | null
    requiredApproverId: string | null
    requestId: string
    isCurrentInstance: boolean
    status: string
  } | null
  groups?: Record<string, string[]>
  activeUsers?: readonly string[]
}): NotificationRecipientDb {
  return {
    async findApprovalRow() {
      if (over.row === null) return null
      return over.row ?? {
        routingMode: 'SNAPSHOT_GROUP',
        candidateGroupId: 'group-current',
        requiredApproverId: null,
        requestId: 'req-1',
        isCurrentInstance: true,
        status: 'pending',
      }
    },
    async findCandidateGroupMemberIds(candidateGroupId) {
      return over.groups?.[candidateGroupId] ?? []
    },
    async findActiveUserIds(userIds) {
      const allowed = new Set(over.activeUsers ?? userIds)
      const seen = new Set<string>()
      const ordered: string[] = []
      for (const userId of userIds) {
        if (seen.has(userId) || !allowed.has(userId)) continue
        seen.add(userId)
        ordered.push(userId)
      }
      return ordered
    },
  }
}

describe('request participant membership — exact union', () => {
  it('returns requester, solution submitters, approval actors, solution-approval actors, current-instance candidates, and assigned engineers', async () => {
    const membership = await resolveRequestParticipants(fakeParticipantsDb(), 'req-1')
    assert.deepEqual(membership, {
      requesterId: 'requester-1',
      solutionSubmitterIds: ['solution-submitter-1'],
      approvalActorIds: ['approver-1', 'required-approver-1'],
      solutionApprovalActorIds: ['solution-approver-1'],
      candidateMemberIds: ['candidate-1', 'candidate-2'],
      assignedEngineerIds: ['engineer-1'],
    })
  })

  it('keeps historical approval actors (approverId ∪ requiredApproverId) in membership', async () => {
    const membership = await resolveRequestParticipants(fakeParticipantsDb({
      approvalActorIds: ['historical-approver', 'custom-required'],
    }), 'req-1')
    assert.deepEqual(membership.approvalActorIds, ['historical-approver', 'custom-required'])
  })

  it('excludes sharing viewers, unit members, and managers without a candidate/actor row', async () => {
    const membership = await resolveRequestParticipants(fakeParticipantsDb(), 'req-1')
    const union = new Set<string>([
      membership.requesterId,
      ...membership.solutionSubmitterIds,
      ...membership.approvalActorIds,
      ...membership.solutionApprovalActorIds,
      ...membership.candidateMemberIds,
      ...membership.assignedEngineerIds,
    ])
    assert.equal(union.has(VIEWER_ID), false)
    assert.equal(union.has(UNIT_MEMBER_ID), false)
    assert.equal(union.has(MANAGER_ID), false)
  })
})

describe('approval_needed — current-step active candidates only', () => {
  it('notifies every current-step active candidate, including multiple holders, deduped', async () => {
    const recipients = await resolveApprovalNeededRecipients(fakeRecipientDb({
      row: {
        routingMode: 'SNAPSHOT_GROUP',
        candidateGroupId: 'group-current',
        requiredApproverId: 'required-1',
        requestId: 'req-1',
        isCurrentInstance: true,
        status: 'pending',
      },
      groups: { 'group-current': ['holder-a', 'holder-a', 'holder-b', 'required-1'] },
      activeUsers: ['holder-a', 'holder-b', 'required-1'],
    }), { approvalId: 'a1', phase: 'REQUEST' })
    assert.deepEqual(recipients, ['holder-a', 'holder-b', 'required-1'])
  })

  it('includes custom requiredApproverId with current-step candidates', async () => {
    const recipients = await resolveApprovalNeededRecipients(fakeRecipientDb({
      row: {
        routingMode: 'CUSTOM_PERSON',
        candidateGroupId: null,
        requiredApproverId: 'custom-2',
        requestId: 'req-1',
        isCurrentInstance: true,
        status: 'pending',
      },
      activeUsers: ['custom-2'],
    }), { approvalId: 'custom-a1', phase: 'SOLUTION' })
    assert.deepEqual(recipients, ['custom-2'])
  })

  it('excludes inactive current-step members', async () => {
    const recipients = await resolveApprovalNeededRecipients(fakeRecipientDb({
      groups: { 'group-current': ['active-1', 'inactive-2'] },
      activeUsers: ['active-1'],
    }), { approvalId: 'a1', phase: 'REQUEST' })
    assert.deepEqual(recipients, ['active-1'])
  })

  it('produces no recipients for a superseded instance', async () => {
    const recipients = await resolveApprovalNeededRecipients(fakeRecipientDb({
      row: {
        routingMode: 'SNAPSHOT_GROUP',
        candidateGroupId: 'group-old',
        requiredApproverId: null,
        requestId: 'req-1',
        isCurrentInstance: false,
        status: 'pending',
      },
      groups: { 'group-old': ['holder-a'] },
      activeUsers: ['holder-a'],
    }), { approvalId: 'superseded-a1', phase: 'REQUEST' })
    assert.deepEqual(recipients, [])
  })

  it('does not notify a sharing viewer with no candidate/actor relationship', async () => {
    const recipients = await resolveApprovalNeededRecipients(fakeRecipientDb({
      groups: { 'group-current': ['holder-a'] },
      activeUsers: ['holder-a', VIEWER_ID],
    }), { approvalId: 'a1', phase: 'REQUEST' })
    assert.equal(recipients.includes(VIEWER_ID), false)
    assert.deepEqual(recipients, ['holder-a'])
  })
})

describe('deleted broadcast helpers', () => {
  it('notifyUsersInDepartment no longer exists', () => {
    const notifications = read('src/server-actions/notifications.ts')
    assert.doesNotMatch(notifications, /export async function notifyUsersInDepartment/)
    assert.doesNotMatch(notifications, /notifyUsersInDepartment/)
  })

  it('legacy recipient lookups and status broadcasts are gone', () => {
    const recipients = read('src/lib/notification-recipients.ts')
    assert.doesNotMatch(recipients, /findLegacyApproverIds/)
    assert.doesNotMatch(recipients, /findReviewedSectionRecipientIds/)
    assert.doesNotMatch(recipients, /resolveStatusBroadcastRecipients/)
  })
})
