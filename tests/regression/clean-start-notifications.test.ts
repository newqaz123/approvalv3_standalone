// Clean-start participants-only event mapping and post-commit contracts
// (Plan B Task 11). Fake-unit + source contracts only: NO SNAPSHOT harness
// expansion, NO OrganizationPositionCode. Event mapping is authority and
// overrides Step 1 wording that said status_changed includes prior actors.
// Ledger R6: solution-submitter and assigned-engineer inclusion where
// specified; sharing viewers never subscribers.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  mapEventRecipients,
  PARTICIPANTS_ONLY_NOTIFICATION_POLICY,
} from '@/lib/notification-recipients'
import {
  runTransactionWithPostCommitNotifications,
  type PostCommitNotificationPlan,
} from '@/lib/post-commit-notifications'

const read = (path: string) => readFileSync(path, 'utf8')

const VIEWER_ID = 'sharing-viewer-1'
const REQUESTER_ID = 'requester-1'
const SUBMITTER_ID = 'solution-submitter-1'
const ENGINEER_ID = 'engineer-1'
const DECIDED_ACTOR_ID = 'decided-actor-1'
const NEXT_CANDIDATE_ID = 'next-candidate-1'
const CURRENT_A = 'current-a'
const CURRENT_B = 'current-b'

const base = {
  requesterId: REQUESTER_ID,
  solutionSubmitterIds: [SUBMITTER_ID] as const,
  assignedEngineerIds: [ENGINEER_ID] as const,
  currentStepActiveCandidateIds: [CURRENT_A, CURRENT_B] as const,
  nextStepActiveCandidateIds: [NEXT_CANDIDATE_ID] as const,
  decidedActorId: DECIDED_ACTOR_ID,
}

describe('event mapping is authority', () => {
  it('approval_needed → current-step active candidates only', () => {
    assert.deepEqual(
      mapEventRecipients({ type: 'approval_needed', ...base }),
      [CURRENT_A, CURRENT_B],
    )
  })

  it('approval_granted → requester + next-step candidates', () => {
    assert.deepEqual(
      mapEventRecipients({ type: 'approval_granted', ...base }),
      [REQUESTER_ID, NEXT_CANDIDATE_ID],
    )
  })

  it('approval_rejected → requester (+ decided actor)', () => {
    assert.deepEqual(
      mapEventRecipients({ type: 'approval_rejected', ...base }),
      [REQUESTER_ID, DECIDED_ACTOR_ID],
    )
  })

  it('status_changed → requester only (not prior actors)', () => {
    assert.deepEqual(
      mapEventRecipients({ type: 'status_changed', ...base }),
      [REQUESTER_ID],
    )
  })

  it('request_assigned → assigned engineers + requester', () => {
    assert.deepEqual(
      mapEventRecipients({ type: 'request_assigned', ...base }),
      [REQUESTER_ID, ENGINEER_ID],
    )
  })

  it('solution_ready → requester + solution submitter', () => {
    assert.deepEqual(
      mapEventRecipients({ type: 'solution_ready', ...base }),
      [REQUESTER_ID, SUBMITTER_ID],
    )
  })

  it('final_approval_needed → FINAL current-step candidates', () => {
    assert.deepEqual(
      mapEventRecipients({ type: 'final_approval_needed', ...base }),
      [CURRENT_A, CURRENT_B],
    )
  })

  it('a viewer-with-no-relationship receives nothing for every event', () => {
    const types = PARTICIPANTS_ONLY_NOTIFICATION_POLICY.preserveEventTypes
    for (const type of types) {
      const recipients = mapEventRecipients({ type, ...base })
      assert.equal(
        recipients.includes(VIEWER_ID),
        false,
        `${type} must not notify a sharing viewer with no relationship`,
      )
    }
  })

  it('does not treat viewing access as a subscription', () => {
    assert.equal(PARTICIPANTS_ONLY_NOTIFICATION_POLICY.allowVisibilityAsSubscription, false)
    assert.equal(PARTICIPANTS_ONLY_NOTIFICATION_POLICY.preserveSectionWideStatusBroadcasts, false)
    assert.equal(PARTICIPANTS_ONLY_NOTIFICATION_POLICY.preserveCustomNotifyAllAtSubmit, false)
  })
})

describe('post-commit plan has no department target', () => {
  const payload = {
    type: 'approval_rejected' as const,
    title: 'Rejected',
    message: 'Returned.',
    requestId: 'request-1',
  }

  it('commits before starting independent user dispatches', async () => {
    let transactionOpen = false
    const order: string[] = []
    const observedPlans: PostCommitNotificationPlan[] = []
    let releaseFirst!: () => void
    let releaseSecond!: () => void
    const firstGate = new Promise<void>((done) => {
      releaseFirst = done
    })
    const secondGate = new Promise<void>((done) => {
      releaseSecond = done
    })

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
        notifications.user({ userId: REQUESTER_ID, ...payload })
        return { status: 'SentToEngineer' as const }
      },
      dispatchers: {
        notifyUser: async (notification) => {
          assert.equal(transactionOpen, false)
          order.push(`user-${notification.userId}-started`)
          observedPlans.push({ target: 'user', notification })
          if (notification.userId === 'engineer-1') await firstGate
          else await secondGate
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
        `user-${REQUESTER_ID}-started`,
      ])
    } finally {
      releaseFirst()
      releaseSecond()
    }

    assert.deepEqual(await action, { status: 'SentToEngineer' })
    assert.equal(observedPlans.length, 2)
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
          notifications.user({ userId: REQUESTER_ID, ...payload })
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

  it('logs a post-commit dispatch failure without failing the committed workflow', async () => {
    const logged: Array<{ plan: PostCommitNotificationPlan; error: unknown }> = []

    const result = await runTransactionWithPostCommitNotifications({
      runTransaction: async (work) => work({ connection: 'transaction-client' }),
      work: async (_tx, notifications) => {
        notifications.user({ userId: REQUESTER_ID, ...payload })
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

  it('retains only the user delivery target', () => {
    const source = read('src/lib/post-commit-notifications.ts')
    assert.match(source, /target: 'user'/)
    assert.doesNotMatch(source, /target: 'department'/)
    assert.doesNotMatch(source, /target: 'unit'/)
    assert.doesNotMatch(source, /notifyDepartment/)
    assert.doesNotMatch(source, /department\(/)
  })
})

describe('production wiring removes broadcasts', () => {
  it('removes the engineering-department New Task Available broadcast', () => {
    const approvals = read('src/server-actions/approvals.ts')
    const statusChange =
      approvals.match(/async function notifyRequestStatusChange[\s\S]*?\n\}/)?.[0] ?? ''
    assert.doesNotMatch(statusChange, /New Task Available/)
    assert.doesNotMatch(statusChange, /notifyUsersInDepartment/)
    assert.doesNotMatch(statusChange, /type: 'ENGINEERING'/)
    assert.match(statusChange, /status_changed/)
  })

  it('solutions post-commit dispatcher has no department target', () => {
    const solutions = read('src/server-actions/solutions.ts')
    assert.doesNotMatch(solutions, /notifyUsersInDepartment/)
    assert.doesNotMatch(solutions, /notifyDepartment/)
    assert.doesNotMatch(solutions, /notifications\.department\(/)
    assert.doesNotMatch(solutions, /resolveStatusBroadcastRecipients/)
    assert.doesNotMatch(solutions, /queueOriginUnitStatusBroadcast/)
  })

  it('post-commit dispatcher notifies users only after commit', () => {
    const solutions = read('src/server-actions/solutions.ts')
    assert.match(solutions, /runTransactionWithPostCommitNotifications/)
    assert.match(solutions, /notifyUser: async \(notification\)/)
  })
})
