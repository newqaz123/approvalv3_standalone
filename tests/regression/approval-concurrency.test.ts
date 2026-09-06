import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { advanceApprovalAtomically, canUserApproveRequest } from '@/lib/approval-engine/transactions'
import {
  fakeTransactionalApprovalDb,
  fakeLegacyApprovalDb,
  fakeCustomPersonApprovalDb,
  ORGANIZATION_APPROVAL_FIXTURE,
} from '../fixtures/organization-approval-fixtures'

describe('approval advancement', () => {
  it('allows one active member of a NEW candidate group to advance exactly once', async () => {
    const db = fakeTransactionalApprovalDb({
      approval: { id: 'a1', requestId: 'r1', routingMode: 'SNAPSHOT_GROUP', candidateUserIds: ['u1', 'u2'], status: 'pending', order: 1 },
      requestStatus: 'ImprovementRequest',
    })
    const first = await advanceApprovalAtomically(db, { approvalId: 'a1', actorId: 'u1', phase: 'REQUEST', comments: 'ok' })
    assert.equal(first.actualActorId, 'u1')
    await assert.rejects(
      advanceApprovalAtomically(db, { approvalId: 'a1', actorId: 'u2', phase: 'REQUEST' }),
      /pending|already|conflict/i,
    )
    assert.equal(db.statusTransitionCount('r1'), 1)
  })

  it('keeps legacy numeric-level eligibility live for a legacy row', async () => {
    const db = fakeLegacyApprovalDb({ requiredLevel: 3, userLevel: 3, status: 'pending' })
    const result = await advanceApprovalAtomically(db, { approvalId: 'legacy-a1', actorId: 'legacy-user', phase: 'REQUEST' })
    assert.equal(result.routingMode, 'LEGACY_LEVEL')
  })

  it('makes a duplicate serial double-click transition impossible', async () => {
    const db = fakeTransactionalApprovalDb({
      approval: { id: 'a1', requestId: 'r1', routingMode: 'SNAPSHOT_GROUP', candidateUserIds: ['u1', 'u2'], status: 'pending', order: 1 },
      requestStatus: 'ImprovementRequest',
    })
    await advanceApprovalAtomically(db, { approvalId: 'a1', actorId: 'u1', phase: 'REQUEST' })
    await assert.rejects(
      advanceApprovalAtomically(db, { approvalId: 'a1', actorId: 'u1', phase: 'REQUEST' }),
      /pending|already|conflict/i,
    )
    assert.equal(db.statusTransitionCount('r1'), 1)
    assert.equal(db.activities.length, 1)
  })

  it('fails closed for a current inactive snapshot member', async () => {
    const db = fakeTransactionalApprovalDb({
      approval: {
        id: 'a1',
        requestId: 'r1',
        routingMode: 'SNAPSHOT_GROUP',
        candidateUserIds: [ORGANIZATION_APPROVAL_FIXTURE.inactiveCandidateId, 'u2'],
        status: 'pending',
        order: 1,
      },
      requestStatus: 'ImprovementRequest',
    })
    const eligibility = await canUserApproveRequest(db, {
      approvalId: 'a1',
      actorId: ORGANIZATION_APPROVAL_FIXTURE.inactiveCandidateId,
    })
    assert.equal(eligibility.canApprove, false)
    assert.equal(eligibility.reason, 'INACTIVE_USER')
    await assert.rejects(
      advanceApprovalAtomically(db, {
        approvalId: 'a1',
        actorId: ORGANIZATION_APPROVAL_FIXTURE.inactiveCandidateId,
        phase: 'REQUEST',
      }),
      /pending|already|conflict|inactive/i,
    )
    assert.equal(db.statusTransitionCount('r1'), 0)
    assert.equal(db.activities.length, 0)
  })

  it('does not treat a live level match as SNAPSHOT eligibility', async () => {
    const db = fakeTransactionalApprovalDb({
      approval: { id: 'a1', requestId: 'r1', routingMode: 'SNAPSHOT_GROUP', candidateUserIds: ['u1', 'u2'], status: 'pending', order: 1 },
      requestStatus: 'ImprovementRequest',
    })
    const outsider = await canUserApproveRequest(db, { approvalId: 'a1', actorId: 'not-in-group' })
    assert.equal(outsider.canApprove, false)
    assert.equal(outsider.reason, 'NOT_CANDIDATE')
  })

  it('keeps custom rows exact-person', async () => {
    const db = fakeCustomPersonApprovalDb({ requiredApproverId: 'person-1' })
    const allowed = await canUserApproveRequest(db, { approvalId: 'custom-a1', actorId: 'person-1' })
    assert.equal(allowed.canApprove, true)
    assert.equal(allowed.routingMode, 'CUSTOM_PERSON')
    const denied = await canUserApproveRequest(db, { approvalId: 'custom-a1', actorId: 'person-2' })
    assert.equal(denied.canApprove, false)
    assert.equal(denied.reason, 'CUSTOM_MISMATCH')
    const result = await advanceApprovalAtomically(db, { approvalId: 'custom-a1', actorId: 'person-1', phase: 'REQUEST' })
    assert.equal(result.routingMode, 'CUSTOM_PERSON')
    assert.equal(result.actualActorId, 'person-1')
  })

  it('rejects a legacy actor whose live level no longer matches', async () => {
    const db = fakeLegacyApprovalDb({ requiredLevel: 3, userLevel: 4, status: 'pending' })
    await assert.rejects(
      advanceApprovalAtomically(db, { approvalId: 'legacy-a1', actorId: 'legacy-user', phase: 'REQUEST' }),
      /pending|already|conflict|legacy/i,
    )
  })

  it('rolls back advancement when cancellation wins the race', async () => {
    const db = fakeTransactionalApprovalDb({
      approval: { id: 'a1', requestId: 'r1', routingMode: 'SNAPSHOT_GROUP', candidateUserIds: ['u1', 'u2'], status: 'pending', order: 1 },
      requestStatus: 'ImprovementRequest',
    })
    db.afterLoad = () => {
      db.cancelRequest()
    }
    await assert.rejects(
      advanceApprovalAtomically(db, { approvalId: 'a1', actorId: 'u1', phase: 'REQUEST' }),
      /pending|already|conflict/i,
    )
    assert.equal(db.statusTransitionCount('r1'), 0)
    assert.equal(db.activities.length, 0)
  })
})
