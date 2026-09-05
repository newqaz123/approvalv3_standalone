/**
 * Harness contract tests: the in-memory fake must reject unsupported query
 * shapes loudly (UnexpectedQueryError) and never partially apply them.
 * List relation filters accept only some/none/every — a direct related-field
 * shorthand would silently impose no restriction, so it must throw instead of
 * letting a guarded write through (review P2-6).
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  ApprovalWorkflowDb,
  UnexpectedQueryError,
  baselineRequest,
} from '../fixtures/organization-approval-harness'

describe('organization approval harness: unsupported query shapes throw', () => {
  it('rejects a direct related-field shorthand on a list relation and mutates nothing', async () => {
    const db = new ApprovalWorkflowDb()
    db.seed('requests', [baselineRequest({ status: 'ImprovementRequest' })])
    db.seed('request_approvals', [
      { id: 'a1', requestId: baselineRequest().id as string, requiredLevel: 4, order: 1, status: 'pending', isFinalApproval: false },
    ])
    const rowsBefore = structuredClone([...db.rows.requests.values()])

    await assert.rejects(
      db.requests.updateMany({
        where: {
          id: baselineRequest().id as string,
          // Unsupported shape: list relation with a bare field instead of
          // some/none/every. This must throw, not act as an unconstrained filter.
          approvals: { status: 'pending' },
        },
        data: { status: 'Cancelled' },
      }),
      (error: unknown) =>
        error instanceof UnexpectedQueryError &&
        /list relation operator 'status'/.test(error.message),
    )

    assert.deepEqual([...db.rows.requests.values()], rowsBefore)
    assert.deepEqual(db.writes.at(-1), undefined)
  })

  it('applies correctly wrapped list predicates (some/none) as restrictions', async () => {
    const db = new ApprovalWorkflowDb()
    db.seed('requests', [
      baselineRequest({ id: 'req-with-pending' }),
      baselineRequest({ id: 'req-without-pending' }),
    ])
    db.seed('request_approvals', [
      { id: 'a1', requestId: 'req-with-pending', requiredLevel: 4, order: 1, status: 'pending', isFinalApproval: false },
    ])

    const nonePending = await db.requests.updateMany({
      where: { approvals: { none: { status: 'pending' } } },
      data: { status: 'Cancelled' },
    })
    assert.deepEqual(nonePending, { count: 1 })
    assert.equal(db.requests.rows.get('req-with-pending')?.status, 'ImprovementRequest')
    assert.equal(db.requests.rows.get('req-without-pending')?.status, 'Cancelled')
  })
})
