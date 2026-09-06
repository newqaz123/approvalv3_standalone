/**
 * Approval routing rollout gate.
 *
 * Task 8 introduces the legacy-default gate for the NEW approval engine:
 * creation flows consult `getApprovalRolloutMode` and keep their existing
 * legacy builders unless the operator opts into `shadow` (legacy result plus a
 * read-only NEW comparison) or `new` (NEW creation, which stays denied until
 * the Task 15 activation support validates the completed import digest and
 * origin/route coverage). The mode affects CREATION ONLY: approval rows and
 * instances that already exist keep their persisted routing semantics in every
 * mode, and legacy in-flight rows are never rebuilt.
 *
 * The mode is read from the `APPROVAL_ROUTING_MODE` environment variable with
 * `legacy` as the documented default. Any other value — including a typo —
 * falls back to `legacy` and is reported once per read, so a misconfigured
 * rollout can never silently enable NEW creation.
 */

export type ApprovalRolloutMode = 'legacy' | 'shadow' | 'new'

export const APPROVAL_ROUTING_MODE_ENV = 'APPROVAL_ROUTING_MODE'

function reportUnknownMode(value: string): void {
  console.error(
    `[approval-rollout] Unknown ${APPROVAL_ROUTING_MODE_ENV} value "${value}"; using the legacy default. Expected one of: legacy, shadow, new.`,
  )
}

/**
 * Resolve the creation rollout mode from an explicit environment record
 * (production passes `process.env`; tests pass their own record and never read
 * the real environment). Unknown values fail closed to the legacy default.
 */
export function getApprovalRolloutMode(env: Record<string, string | undefined>): ApprovalRolloutMode {
  const raw = env[APPROVAL_ROUTING_MODE_ENV]
  if (raw === 'shadow' || raw === 'new') return raw
  if (raw !== undefined && raw !== 'legacy') reportUnknownMode(raw)
  return 'legacy'
}
