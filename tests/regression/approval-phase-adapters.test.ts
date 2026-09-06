/**
 * Task 8 phase-adapter contracts: the three phase origins stay distinct, the
 * adapter computes the exact business status transitions, initial auto
 * completion differs from last-step completion, and prior attempts are
 * retained (superseded, never deleted) with attempt numbering. The fakes
 * supply plan outcomes and document status; the adapter computes every
 * transition. No Prisma.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  createRequestApprovalAttempt,
  createSolutionApprovalAttempt,
  createFinalApprovalAttempt,
  createCustomPersonAttempt,
  deriveLegacyWrap,
} from '@/lib/approval-engine/phase-adapters'
import {
  createPhaseAdapterDb,
  createPhaseAdapterDbWithRejectedAttempt,
  createPhaseAdapterFixture,
} from '../fixtures/organization-approval-fixtures'

describe('phase approval adapters', () => {
  it('uses the phase initiator without changing business transitions', async () => {
    const request = await createRequestApprovalAttempt(createPhaseAdapterDb({ phase: 'REQUEST' }), { requestId: 'r1', requesterId: 'staff-1' })
    const solution = await createSolutionApprovalAttempt(createPhaseAdapterDb({ phase: 'SOLUTION' }), { requestId: 'r1', solutionId: 's1', submittedById: 'engineer-1' })
    const final = await createFinalApprovalAttempt(createPhaseAdapterDb({ phase: 'FINAL' }), { requestId: 'r1', initiatorId: 'department-member-1' })
    assert.deepEqual(request.statusChange, { from: 'ImprovementRequest', to: 'SentToEngineer' })
    assert.deepEqual(solution.statusChange, { from: 'SentToEngineer', to: 'SendBackToRequester' })
    assert.deepEqual(final.statusChange, { from: 'SendBackToRequester', to: 'Completed' })
    assert.equal(solution.instance.originUserId, 'engineer-1')
    assert.equal(final.instance.originUserId, 'department-member-1')

    // The three origins are fully distinct attempts.
    assert.equal(request.instance.phase, 'REQUEST')
    assert.equal(solution.instance.phase, 'SOLUTION')
    assert.equal(final.instance.phase, 'FINAL')
    assert.equal(request.autoApproved, true)
    assert.equal(solution.autoApproved, true)
    assert.equal(final.autoApproved, true)
    assert.equal(request.completedWithoutSteps, false)
    assert.equal(solution.completedWithoutSteps, false)
    assert.equal(final.completedWithoutSteps, false)
  })

  it('retains prior attempts instead of deleting their rows', async () => {
    const db = createPhaseAdapterDbWithRejectedAttempt('r1')
    const result = await createRequestApprovalAttempt(db, { requestId: 'r1', requesterId: 'staff-1' })
    assert.equal(result.instance.attempt, 2)
    assert.equal(db.priorAttemptState('r1', 'REQUEST'), 'SUPERSEDED')
    assert.equal(db.priorAttemptRowsRemain('r1'), true)
  })

  it('preserves the prior terminal outcome and only marks the instance superseded', async () => {
    const db = createPhaseAdapterDbWithRejectedAttempt('r1')
    const before = db.instances().find((instance) => instance.attempt === 1)
    assert.equal(before?.state, 'REJECTED')
    assert.equal(before?.supersededAt, null)

    await createRequestApprovalAttempt(db, { requestId: 'r1', requesterId: 'staff-1' })

    const prior = db.instances().find((instance) => instance.attempt === 1)
    assert.equal(prior?.state, 'REJECTED', 'supersession must never overwrite the terminal outcome')
    assert.ok(prior?.supersededAt, 'supersession must set supersededAt')
    assert.equal(db.priorAttemptRowsRemain('r1'), true)
    // The rejected row keeps its status, level, and actor verbatim.
    const priorRow = db.approvalRows().find((row) => row.instanceId === prior?.id)
    assert.equal(priorRow?.status, 'rejected')
    assert.equal(priorRow?.requiredLevel, 2)
    assert.equal(priorRow?.approverId, 'supervisor-1')
  })

  it('supersedes a pending current attempt on resubmission and increments the attempt', async () => {
    const db = createPhaseAdapterFixture({
      phase: 'SOLUTION',
      planOutcome: 'PENDING',
      priorAttempt: {
        attempt: 1,
        state: 'PENDING',
        rows: [
          {
            id: 'row-prior-1',
            solutionId: 's1',
            order: 1,
            status: 'pending',
            isCustomChain: false,
            routingMode: 'SNAPSHOT_GROUP',
            integrityVersion: 1,
            requiredPosition: 'SUPERVISOR',
          },
        ],
      },
    })

    const result = await createSolutionApprovalAttempt(db, { requestId: 'r1', solutionId: 's1', submittedById: 'engineer-1' })

    assert.equal(result.instance.attempt, 2)
    assert.equal(db.priorAttemptState('r1', 'SOLUTION'), 'SUPERSEDED')
    const prior = db.instances().find((instance) => instance.attempt === 1)
    assert.equal(prior?.state, 'PENDING', 'a superseded pending attempt keeps its state')
    assert.ok(prior?.supersededAt)
    assert.equal(db.approvalRows().filter((row) => row.instanceId === prior?.id).length, 1)
  })

  it('completes a ceiling auto-approval with the group-less approved self-row', async () => {
    const db = createPhaseAdapterFixture({ phase: 'REQUEST', planOutcome: 'AUTO_APPROVED' })
    const result = await createRequestApprovalAttempt(db, { requestId: 'r1', requesterId: 'staff-1' })

    assert.equal(result.autoApproved, true)
    assert.equal(result.completedWithoutSteps, false)
    assert.equal(result.instance.state, 'AUTO_APPROVED')
    assert.equal(result.instance.attempt, 1)
    const rows = db.approvalRows()
    assert.equal(rows.length, 1)
    assert.deepEqual(
      { status: rows[0]?.status, approverId: rows[0]?.approverId, candidateGroupId: rows[0]?.candidateGroupId, routingMode: rows[0]?.routingMode, integrityVersion: rows[0]?.integrityVersion },
      { status: 'approved', approverId: 'staff-1', candidateGroupId: null, routingMode: 'SNAPSHOT_GROUP', integrityVersion: 1 },
    )
    assert.equal(db.requestStatus(), 'SentToEngineer')
  })

  it('completes with NO_ELIGIBLE_APPROVAL_STEPS when no candidate group remains, without approval rows', async () => {
    const db = createPhaseAdapterFixture({ phase: 'FINAL', planOutcome: 'NO_ELIGIBLE' })
    const result = await createFinalApprovalAttempt(db, { requestId: 'r1', initiatorId: 'department-member-1' })

    assert.equal(result.autoApproved, false)
    assert.equal(result.completedWithoutSteps, true)
    assert.equal(result.instance.state, 'COMPLETED_NO_ELIGIBLE_STEPS')
    assert.equal(result.instance.completionReason, 'NO_ELIGIBLE_APPROVAL_STEPS')
    assert.deepEqual(result.statusChange, { from: 'SendBackToRequester', to: 'Completed' })
    assert.equal(db.approvalRows().length, 0, 'no pending group means no approval rows')
    assert.equal(db.requestStatus(), 'Completed')
  })

  it('keeps initial pending submission distinct from last-step completion', async () => {
    // Initial submission with pending steps never completes the phase.
    const requestDb = createPhaseAdapterFixture({ phase: 'REQUEST', planOutcome: 'PENDING' })
    const request = await createRequestApprovalAttempt(requestDb, { requestId: 'r1', requesterId: 'staff-1' })
    assert.equal(request.statusChange, undefined)
    assert.equal(request.autoApproved, false)
    assert.equal(request.completedWithoutSteps, false)
    assert.equal(requestDb.requestStatus(), 'ImprovementRequest', 'pending request creation does not complete')

    const solutionDb = createPhaseAdapterFixture({ phase: 'SOLUTION', planOutcome: 'PENDING' })
    const solution = await createSolutionApprovalAttempt(solutionDb, { requestId: 'r1', solutionId: 's1', submittedById: 'engineer-1' })
    assert.deepEqual(solution.statusChange, { from: 'SentToEngineer', to: 'DesignCostEstimationApproval' })
    assert.equal(solutionDb.requestStatus(), 'DesignCostEstimationApproval', 'pending solution waits at design-cost approval, never SendBackToRequester')

    const finalDb = createPhaseAdapterFixture({ phase: 'FINAL', planOutcome: 'PENDING' })
    const final = await createFinalApprovalAttempt(finalDb, { requestId: 'r1', initiatorId: 'department-member-1' })
    assert.deepEqual(final.statusChange, { from: 'SendBackToRequester', to: 'FinalApproval' })
    assert.equal(finalDb.requestStatus(), 'FinalApproval', 'pending final waits at FinalApproval, never Completed')

    // The completion transitions (DesignCostEstimationApproval -> SendBackToRequester,
    // FinalApproval -> Completed) belong to the last-step approval actions and
    // are pinned by the Task 1 baseline; creation never emits them.
    assert.notDeepEqual(solution.statusChange?.to, 'SendBackToRequester')
    assert.notDeepEqual(final.statusChange?.to, 'Completed')
  })

  it('rejects an unexpected document status instead of guessing the transition', async () => {
    const db = createPhaseAdapterFixture({ phase: 'REQUEST', planOutcome: 'PENDING', initialStatus: 'SentToEngineer' })
    await assert.rejects(
      createRequestApprovalAttempt(db, { requestId: 'r1', requesterId: 'staff-1' }),
      /ImprovementRequest/,
    )
  })

  describe('custom person attempts', () => {
    it('creates a CUSTOM_PERSON instance with exact ordered approvers and no candidate groups', async () => {
      const db = createPhaseAdapterFixture({ phase: 'SOLUTION', planOutcome: 'PENDING' })
      const result = await createCustomPersonAttempt(db, {
        requestId: 'r1',
        solutionId: 's1',
        phase: 'SOLUTION',
        initiatorId: 'engineer-1',
        orderedApproverIds: ['custom-approver-1', 'custom-approver-2'],
      })

      assert.equal(result.autoApproved, false, 'custom chains are never auto-approved')
      assert.equal(result.completedWithoutSteps, false)
      assert.equal(result.instance.routingMode, 'CUSTOM_PERSON')
      assert.equal(result.instance.state, 'PENDING')
      assert.equal(result.instance.originUserId, 'engineer-1')
      assert.deepEqual(result.statusChange, { from: 'SentToEngineer', to: 'DesignCostEstimationApproval' })

      const rows = db.approvalRows().sort((a, b) => a.order - b.order)
      assert.deepEqual(
        rows.map((row) => ({ order: row.order, requiredApproverId: row.requiredApproverId, isCustomChain: row.isCustomChain, routingMode: row.routingMode, integrityVersion: row.integrityVersion, requiredLevel: row.requiredLevel, candidateGroupId: row.candidateGroupId, status: row.status })),
        [
          { order: 1, requiredApproverId: 'custom-approver-1', isCustomChain: true, routingMode: 'CUSTOM_PERSON', integrityVersion: 1, requiredLevel: null, candidateGroupId: null, status: 'pending' },
          { order: 2, requiredApproverId: 'custom-approver-2', isCustomChain: true, routingMode: 'CUSTOM_PERSON', integrityVersion: 1, requiredLevel: null, candidateGroupId: null, status: 'pending' },
        ],
      )
      assert.equal(rows[0]?.instanceId, result.instance.id)
      assert.equal(db.requestStatus(), 'DesignCostEstimationApproval')
    })

    it('applies exactly ONE guarded status write on the custom path (single writer)', async () => {
      const db = createPhaseAdapterFixture({ phase: 'SOLUTION', planOutcome: 'PENDING' })
      const result = await createCustomPersonAttempt(db, {
        requestId: 'r1',
        solutionId: 's1',
        phase: 'SOLUTION',
        initiatorId: 'engineer-1',
        orderedApproverIds: ['custom-approver-1'],
      })

      // The adapter is the single status writer: exactly one CAS application,
      // so an action-level second write would be a double transition.
      assert.deepEqual(db.statusUpdates(), [{ from: 'SentToEngineer', to: 'DesignCostEstimationApproval' }])
      assert.deepEqual(result.statusChange, { from: 'SentToEngineer', to: 'DesignCostEstimationApproval' })
      assert.equal(db.requestStatus(), 'DesignCostEstimationApproval')
    })

    it('custom re-attempt from DesignCostEstimationApproval writes no status and never conflicts', async () => {
      const db = createPhaseAdapterFixture({
        phase: 'SOLUTION',
        planOutcome: 'PENDING',
        initialStatus: 'DesignCostEstimationApproval',
      })
      const result = await createCustomPersonAttempt(db, {
        requestId: 'r1',
        solutionId: 's1',
        phase: 'SOLUTION',
        initiatorId: 'engineer-1',
        orderedApproverIds: ['custom-approver-2'],
      })

      // The pending target equals the current status: the guarded writer
      // no-ops instead of throwing a status conflict on the custom path.
      assert.deepEqual(db.statusUpdates(), [])
      assert.equal(result.statusChange, undefined)
      assert.equal(db.requestStatus(), 'DesignCostEstimationApproval')
    })

    it('keeps the final custom row identity on request_approvals with isFinalApproval true', async () => {
      const db = createPhaseAdapterFixture({ phase: 'FINAL', planOutcome: 'PENDING' })
      const result = await createCustomPersonAttempt(db, {
        requestId: 'r1',
        phase: 'FINAL',
        initiatorId: 'department-member-1',
        orderedApproverIds: ['custom-approver-1'],
      })

      assert.deepEqual(result.statusChange, { from: 'SendBackToRequester', to: 'FinalApproval' })
      assert.deepEqual(db.statusUpdates(), [{ from: 'SendBackToRequester', to: 'FinalApproval' }])
      const row = db.approvalRows()[0]
      assert.deepEqual(
        { requestId: row?.requestId, solutionId: row?.solutionId, isFinalApproval: row?.isFinalApproval, requiredApproverId: row?.requiredApproverId, routingMode: row?.routingMode, instanceId: row?.instanceId },
        { requestId: 'r1', solutionId: undefined, isFinalApproval: true, requiredApproverId: 'custom-approver-1', routingMode: 'CUSTOM_PERSON', instanceId: result.instance.id },
      )
    })

    it('separates repeated custom attempts by instanceId while retaining prior rows', async () => {
      const db = createPhaseAdapterFixture({
        phase: 'FINAL',
        planOutcome: 'PENDING',
        priorAttempt: {
          attempt: 1,
          state: 'REJECTED',
          rows: [
            {
              id: 'row-prior-custom-1',
              requestId: 'r1',
              isFinalApproval: true,
              order: 1,
              status: 'rejected',
              isCustomChain: true,
              routingMode: 'CUSTOM_PERSON',
              integrityVersion: 1,
              requiredApproverId: 'custom-approver-1',
              requiredLevel: null,
            },
          ],
        },
      })

      const second = await createCustomPersonAttempt(db, {
        requestId: 'r1',
        phase: 'FINAL',
        initiatorId: 'department-member-1',
        orderedApproverIds: ['custom-approver-2'],
      })

      assert.equal(second.instance.attempt, 2)
      assert.equal(db.priorAttemptState('r1', 'FINAL'), 'SUPERSEDED')
      const priorRow = db.approvalRows().find((row) => row.id === 'row-prior-custom-1')
      assert.equal(priorRow?.instanceId, 'instance-prior-FINAL')
      assert.equal(priorRow?.status, 'rejected')
      const newRow = db.approvalRows().find((row) => row.requiredApproverId === 'custom-approver-2')
      assert.equal(newRow?.instanceId, second.instance.id)
      assert.notEqual(newRow?.instanceId, priorRow?.instanceId)
    })

    it('fails closed on an empty ordered chain', async () => {
      const db = createPhaseAdapterFixture({ phase: 'SOLUTION', planOutcome: 'PENDING' })
      await assert.rejects(
        createCustomPersonAttempt(db, {
          requestId: 'r1',
          solutionId: 's1',
          phase: 'SOLUTION',
          initiatorId: 'engineer-1',
          orderedApproverIds: [],
        }),
        /at least one approver/,
      )
    })

    it('rejects a mismatched initiator for the solution phase', async () => {
      const db = createPhaseAdapterFixture({ phase: 'SOLUTION', planOutcome: 'PENDING' })
      await assert.rejects(
        createCustomPersonAttempt(db, {
          requestId: 'r1',
          solutionId: 's1',
          phase: 'SOLUTION',
          initiatorId: 'someone-else',
          orderedApproverIds: ['custom-approver-1'],
        }),
        /origin user does not match/i,
      )
    })
  })

  describe('legacy wrap derivation', () => {
    it('derives LEGACY_LEVEL/REJECTED from rejected level rows', () => {
      assert.deepEqual(
        deriveLegacyWrap([
          { status: 'rejected', isCustomChain: false },
          { status: 'approved', isCustomChain: false },
        ], { phase: 'REQUEST', fallbackOriginUserId: 'staff-1' }),
        { routingMode: 'LEGACY_LEVEL', state: 'REJECTED', originUserId: 'staff-1' },
      )
    })

    it('derives CUSTOM_PERSON and prefers the auto self-row actor for final history', () => {
      assert.deepEqual(
        deriveLegacyWrap([
          { status: 'approved', isCustomChain: false, order: 1, approverId: 'department-manager-1' },
          { status: 'pending', isCustomChain: true, order: 2 },
        ], { phase: 'FINAL', fallbackOriginUserId: 'department-member-1' }),
        { routingMode: 'CUSTOM_PERSON', state: 'PENDING', originUserId: 'department-manager-1' },
      )
    })
  })
})
