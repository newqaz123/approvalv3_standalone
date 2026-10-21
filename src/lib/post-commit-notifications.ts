export type WorkflowNotificationType =
  | 'approval_needed'
  | 'approval_granted'
  | 'approval_rejected'
  | 'status_changed'
  | 'request_assigned'
  | 'solution_ready'
  | 'final_approval_needed'

export interface NotificationPayload {
  type: WorkflowNotificationType
  title: string
  message: string
  requestId?: string
}

export interface UserNotification extends NotificationPayload {
  userId: string
}

export type PostCommitNotificationPlan = {
  target: 'user'
  notification: UserNotification
}

export interface PostCommitNotificationCollector {
  user(notification: UserNotification): void
}

export interface PostCommitNotificationDispatchers {
  notifyUser(notification: UserNotification): Promise<unknown>
}

export async function runTransactionWithPostCommitNotifications<T, Tx>(options: {
  runTransaction(work: (tx: Tx) => Promise<T>): Promise<T>
  work(tx: Tx, notifications: PostCommitNotificationCollector): Promise<T>
  dispatchers: PostCommitNotificationDispatchers
  onDispatchError?: (plan: PostCommitNotificationPlan, error: unknown) => void
}): Promise<T> {
  const plans: PostCommitNotificationPlan[] = []
  const notifications: PostCommitNotificationCollector = {
    user: (notification) => {
      plans.push({
        target: 'user',
        notification: { ...notification },
      })
    },
  }

  // The transaction must resolve (commit) before any global-Prisma or SMTP
  // notification work begins. If the transaction rejects, execution never
  // reaches dispatch and every queued description is discarded.
  const result = await options.runTransaction((tx) =>
    options.work(tx, notifications),
  )

  const outcomes = await Promise.allSettled(
    plans.map((plan) => options.dispatchers.notifyUser(plan.notification)),
  )

  outcomes.forEach((outcome, index) => {
    if (outcome.status !== 'rejected') return

    const plan = plans[index]
    if (!plan) return

    if (options.onDispatchError) {
      options.onDispatchError(plan, outcome.reason)
      return
    }

    console.error(
      `[post-commit-notifications] Failed to dispatch ${plan.target} notification`,
      outcome.reason,
    )
  })

  // Notification delivery is ancillary. A failed post-commit dispatch must
  // not make callers report that the already-committed workflow rolled back.
  return result
}
