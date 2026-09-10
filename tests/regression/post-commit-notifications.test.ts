import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  runTransactionWithPostCommitNotifications,
  type PostCommitNotificationPlan,
} from '@/lib/post-commit-notifications'

/**
 * Regression contract for Prisma P2028 failures caused by notification/email
 * work inside interactive transactions.
 *
 * Production change this catches: moving a queued notification dispatch back
 * into the transaction callback. The deferred dispatchers would then observe
 * an open transaction and keep it open, reproducing the timeout boundary.
 * These tests exercise the real orchestration primitive; only the external
 * notification transports and transaction boundary are replaced.
 *
 * B11: the post-commit plan type has no department target.
 */

function deferred() {
  let resolveFn!: () => void
  const promise = new Promise<void>((done) => {
    resolveFn = done
  })
  return { promise, resolve: resolveFn }
}

const payload = {
  type: 'approval_rejected' as const,
  title: 'Final Approval Rejected',
  message: 'The request was returned to engineering.',
  requestId: 'request-1',
}

describe('post-commit notification transactions', () => {
  it('commits before starting independent user notification dispatches', async () => {
    let transactionOpen = false
    const order: string[] = []
    const firstGate = deferred()
    const secondGate = deferred()
    const observedPlans: PostCommitNotificationPlan[] = []

    const action = runTransactionWithPostCommitNotifications({
      runTransaction: async (work) => {
        transactionOpen = true
        order.push('transaction-started')
        const value = await work({ connection: 'transaction-client' })
        order.push('transaction-work-finished')
        transactionOpen = false
        order.push('transaction-committed')
        return value
      },
      work: async (_tx, notifications) => {
        notifications.user({ userId: 'engineer-1', ...payload })
        notifications.user({ userId: 'requester-1', ...payload })
        return { status: 'SentToEngineer' as const }
      },
      dispatchers: {
        notifyUser: async (notification) => {
          assert.equal(transactionOpen, false)
          order.push(`user-${notification.userId}-started`)
          observedPlans.push({ target: 'user', notification })
          if (notification.userId === 'engineer-1') await firstGate.promise
          else await secondGate.promise
        },
      },
    })

    await new Promise<void>((resolveWait) => setImmediate(resolveWait))

    try {
      assert.equal(transactionOpen, false)
      assert.deepEqual(order, [
        'transaction-started',
        'transaction-work-finished',
        'transaction-committed',
        'user-engineer-1-started',
        'user-requester-1-started',
      ])
      assert.equal(observedPlans.length, 2)
    } finally {
      firstGate.resolve()
      secondGate.resolve()
    }

    assert.deepEqual(await action, { status: 'SentToEngineer' })
    assert.deepEqual(observedPlans, [
      {
        target: 'user',
        notification: { userId: 'engineer-1', ...payload },
      },
      {
        target: 'user',
        notification: { userId: 'requester-1', ...payload },
      },
    ])
  })

  it('dispatches nothing when the workflow transaction rolls back', async () => {
    const dispatched: PostCommitNotificationPlan[] = []

    await assert.rejects(
      runTransactionWithPostCommitNotifications({
        runTransaction: async (work) => {
          await work({ connection: 'transaction-client' })
          throw new Error('database rollback')
        },
        work: async (_tx, notifications) => {
          notifications.user({ userId: 'engineer-1', ...payload })
          return 'uncommitted'
        },
        dispatchers: {
          notifyUser: async (notification) => {
            dispatched.push({ target: 'user', notification })
          },
        },
      }),
      /database rollback/,
    )

    assert.deepEqual(dispatched, [])
  })

  it('logs a post-commit dispatch failure without falsely failing the committed workflow', async () => {
    const logged: Array<{ plan: PostCommitNotificationPlan; error: unknown }> = []

    const result = await runTransactionWithPostCommitNotifications({
      runTransaction: async (work) => work({ connection: 'transaction-client' }),
      work: async (_tx, notifications) => {
        notifications.user({ userId: 'engineer-1', ...payload })
        return { committed: true }
      },
      dispatchers: {
        notifyUser: async () => {
          throw new Error('notification database unavailable')
        },
      },
      onDispatchError: (plan, error) => {
        logged.push({ plan, error })
      },
    })

    assert.deepEqual(result, { committed: true })
    assert.equal(logged.length, 1)
    assert.equal(logged[0]?.plan.target, 'user')
    assert.match(String(logged[0]?.error), /notification database unavailable/)
  })
})

describe('post-commit notification compatibility (no new channel)', () => {
  it('retains only the user delivery target', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/lib/post-commit-notifications.ts'),
      'utf8',
    )
    assert.match(source, /target: 'user'/)
    assert.doesNotMatch(source, /target: 'department'/)
    assert.doesNotMatch(source, /target: 'unit'/)
    assert.doesNotMatch(source, /target: 'section'/)
    assert.doesNotMatch(source, /target: 'subscription'/)
    assert.doesNotMatch(source, /notifyDepartment/)
    assert.doesNotMatch(source, /retryQueue|dedupeKey/)
  })
})
