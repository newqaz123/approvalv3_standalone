/**
 * T15A FINAL-phase notification multiplicity evidence — REQUIRED,
 * runner-owned, READ-ONLY (Task59; test-only). Separate small module so the
 * T15A DB-capture file keeps its Task56 shape (the 12 persisted checks are
 * untouched; these checks are appended by the assembler separately).
 *
 * What this layer proves (and only this): after the T15A double-click Final
 * trigger and the normal completion of the single attempt, the PERSISTED
 * notifications for the browser-correlated exact request title hold EXACTLY
 * the FINAL-phase event multiplicity the product contract produces —
 * verified against the ACTUAL sources, nothing invented:
 *  - `final_approval_needed` rows (solutions.ts queueNextFinalApprover
 *    notifications: one post-commit plan per resolved active candidate of
 *    the CURRENT pending FINAL row, then again after the section manager
 *    decides): exactly ONE row for the section manager
 *    (user-section-manager-p) and exactly ONE row for the department
 *    manager (user-department-manager). A duplicate row for ANY recipient,
 *    a missing recipient, or a wrong recipient FAILS.
 *  - completion notification to the requester ONCE (solutions.ts
 *    approveFinalApproval statusChange branch → mapEventRecipients
 *    'approval_granted' → requester only; type approval_granted, the only
 *    producer of that type in the codebase): exactly ONE approval_granted
 *    row for user-requester-a. The losing double-click may create NONE of
 *    these twice: the duplicate-alert claim is exactly this multiplicity.
 *
 * Scope honesty: REQUEST/SOLUTION-phase notification types are NOT asserted
 * here (T15A evidence is FINAL-phase scoped; other scenarios' requirements
 * are unchanged), and nothing here proves simultaneous server execution —
 * the server-race proof stays a separate pending task.
 *
 * The evaluator is pure (no SQL). Structural projection only: id,
 * requestId, userId, type — no titles, no message bodies.
 */

import type { DbEvidenceData, DbEvidenceRow, WorkflowCheck } from './capture-workflow-db-evidence'

export const T15A_NOTIFICATION_CHECK_PREFIX = 'db-evidence/Business T15A/notification-multiplicity'

/** FINAL-phase recipients pinned against the all-defaults T15A chain. */
export const T15A_FINAL_STEP_RECIPIENTS = ['user-section-manager-p', 'user-department-manager'] as const
export const T15A_COMPLETION_RECIPIENT = 'user-requester-a'

export interface T15aNotificationEvidenceInput {
  /** Exact title from t15a-browser-correlation.json — never a prefix match. */
  exactTitle: string
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/**
 * Pure REQUIRED evaluator for the FINAL-phase notification multiplicity of
 * ONE exact request (matched by the browser-recorded exact title — zero or
 * multiple matches FAIL). Duplicate / missing / wrong-recipient rows FAIL —
 * never skip; a missing notifications capture reads as zero rows and fails.
 */
export function evaluateT15aNotificationEvidence(
  data: DbEvidenceData,
  input: T15aNotificationEvidenceInput,
): WorkflowCheck[] {
  const n = (name: string) => `${T15A_NOTIFICATION_CHECK_PREFIX}/${name}`
  const checks: WorkflowCheck[] = []
  const titled = data.requests.filter((row) => str(row.title) === input.exactTitle)
  const request = titled.length === 1 ? titled[0] : undefined
  if (!request) {
    checks.push({
      name: n('request-present'),
      status: 'fail',
      detail: titled.length === 0
        ? `REQUIRED T15A request "${input.exactTitle}" not found — notification evidence is missing, not skipped`
        : `REQUIRED T15A request title "${input.exactTitle}" matched ${titled.length} rows — identity is ambiguous`,
    })
    return checks
  }
  const requestId = str(request.id)
  const title = str(request.title)
  checks.push({
    name: n('request-present'),
    status: 'pass',
    detail: `${title}: exactly one request matches the browser-correlated exact title`,
  })

  const rows = data.notifications ?? []
  const finalNeeded = rows.filter(
    (row) => str(row.requestId) === requestId && str(row.type) === 'final_approval_needed',
  )
  const perRecipient = new Map<string, number>()
  for (const row of finalNeeded) {
    const userId = str(row.userId)
    perRecipient.set(userId, (perRecipient.get(userId) ?? 0) + 1)
  }
  const expected = T15A_FINAL_STEP_RECIPIENTS.map((userId) => [userId, perRecipient.get(userId) ?? 0] as const)
  const observed = [...perRecipient.entries()]
    .filter(([userId]) => !(T15A_FINAL_STEP_RECIPIENTS as readonly string[]).includes(userId))
    .map(([userId, count]) => `${userId}×${count}`)
  const multisetOk = finalNeeded.length === T15A_FINAL_STEP_RECIPIENTS.length
    && expected.every(([, count]) => count === 1)
    && observed.length === 0
  checks.push({
    name: n('final-approval-needed-multiset'),
    status: multisetOk ? 'pass' : 'fail',
    detail: multisetOk
      ? `${title}: exactly two final_approval_needed rows — one for user-section-manager-p (initiation step) and one for user-department-manager (after the section manager decided); no duplicate alert for any recipient`
      : `${title}: final_approval_needed multiplicity mismatch — expected exactly [${T15A_FINAL_STEP_RECIPIENTS.map((userId) => `${userId}×1`).join(', ')}], observed [${[...expected.map(([userId, count]) => `${userId}×${count}`), ...observed].join(', ') || 'none'}]${rows.length === 0 ? ' (notifications capture held zero rows — missing capture fails closed)' : ''}`,
  })

  const completions = rows.filter(
    (row) => str(row.requestId) === requestId && str(row.type) === 'approval_granted',
  )
  const completionOk = completions.length === 1 && str(completions[0]?.userId) === T15A_COMPLETION_RECIPIENT
  checks.push({
    name: n('completion-notification-once-to-requester'),
    status: completionOk ? 'pass' : 'fail',
    detail: completionOk
      ? `${title}: exactly one approval_granted completion row for user-requester-a (approveFinalApproval statusChange branch — the sole producer of this type); no duplicate completion notification`
      : `${title}: expected exactly one approval_granted row (user ${T15A_COMPLETION_RECIPIENT}), observed ${completions.length} (${completions.map((row) => str(row.userId)).join(', ') || 'none'})`,
  })

  return checks
}
