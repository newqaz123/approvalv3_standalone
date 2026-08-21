import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
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
 */

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const payload = {
  type: 'approval_rejected' as const,
  title: 'Final Approval Rejected',
  message: 'The request was returned to engineering.',
  requestId: 'request-1',
}

describe('post-commit notification transactions', () => {
  it('commits before starting both independent notification dispatches', async () => {
    let transactionOpen = false
    const order: string[] = []
    const userGate = deferred()
    const departmentGate = deferred()
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
        notifications.department('requester-department', payload, ['rejector-1'])
        return { status: 'SentToEngineer' as const }
      },
      dispatchers: {
        notifyUser: async (notification) => {
          assert.equal(transactionOpen, false)
          order.push('user-notification-started')
          observedPlans.push({ target: 'user', notification })
          await userGate.promise
        },
        notifyDepartment: async (departmentId, notification, excludeUserIds) => {
          assert.equal(transactionOpen, false)
          order.push('department-notification-started')
          observedPlans.push({
            target: 'department',
            departmentId,
            notification,
            excludeUserIds,
          })
          await departmentGate.promise
        },
      },
    })

    // Promise.allSettled-style dispatch starts both independent operations
    // before either deferred operation completes.
    await new Promise<void>((resolve) => setImmediate(resolve))

    try {
      assert.equal(transactionOpen, false)
      assert.deepEqual(order, [
        'transaction-started',
        'transaction-work-finished',
        'transaction-committed',
        'user-notification-started',
        'department-notification-started',
      ])
      assert.equal(observedPlans.length, 2)
    } finally {
      userGate.resolve()
      departmentGate.resolve()
    }

    assert.deepEqual(await action, { status: 'SentToEngineer' })
    assert.deepEqual(observedPlans, [
      {
        target: 'user',
        notification: { userId: 'engineer-1', ...payload },
      },
      {
        target: 'department',
        departmentId: 'requester-department',
        notification: payload,
        excludeUserIds: ['rejector-1'],
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
          notifications.department('engineering', payload, ['rejector-1'])
          return 'uncommitted'
        },
        dispatchers: {
          notifyUser: async (notification) => {
            dispatched.push({ target: 'user', notification })
          },
          notifyDepartment: async (departmentId, notification, excludeUserIds) => {
            dispatched.push({
              target: 'department',
              departmentId,
              notification,
              excludeUserIds,
            })
          },
        },
      }),
      /database rollback/,
    )

    assert.deepEqual(dispatched, [])
  })

  it('logs a post-commit dispatch failure without falsely failing the committed workflow', async () => {
    const dispatchedTargets: string[] = []
    const logged: Array<{ plan: PostCommitNotificationPlan; error: unknown }> = []

    const result = await runTransactionWithPostCommitNotifications({
      runTransaction: async (work) => work({ connection: 'transaction-client' }),
      work: async (_tx, notifications) => {
        notifications.user({ userId: 'engineer-1', ...payload })
        notifications.department('requester-department', payload)
        return { committed: true }
      },
      dispatchers: {
        notifyUser: async () => {
          dispatchedTargets.push('user')
          throw new Error('notification database unavailable')
        },
        notifyDepartment: async () => {
          dispatchedTargets.push('department')
        },
      },
      onDispatchError: (plan, error) => {
        logged.push({ plan, error })
      },
    })

    assert.deepEqual(result, { committed: true })
    assert.deepEqual(dispatchedTargets.sort(), ['department', 'user'])
    assert.equal(logged.length, 1)
    assert.equal(logged[0]?.plan.target, 'user')
    assert.match(String(logged[0]?.error), /notification database unavailable/)
  })
})
