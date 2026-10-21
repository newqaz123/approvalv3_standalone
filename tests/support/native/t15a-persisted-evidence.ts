/**
 * T15A persisted single-transition evidence — REQUIRED, runner-owned,
 * READ-ONLY (Task56; test-only). Deliberately a SEPARATE small module so the
 * T15 evaluator does not grow the already-huge DB-capture file.
 *
 * What this layer proves (and only this): after the T15A browser spec's
 * rapid double-click Final trigger and the normal completion of the single
 * attempt, the PERSISTED database holds exactly ONE transition:
 *  - exactly one FINAL approval instance for the browser-correlated exact
 *    request title (attempt 1, current/not superseded, NO restart linkage);
 *  - instance state APPROVED (the actual persisted terminal state after the
 *    last step — decisions.ts sets it PENDING-guarded; never inventing a
 *    "COMPLETED" state that does not exist for decided instances);
 *  - request status Completed (the spec's ACTUAL endpoint — the FULL chain
 *    completes; a PENDING expectation is never implemented);
 *  - exactly TWO approved FINAL rows (Section manager P → Department manager
 *    in order, isFinalApproval=true, no duplicate decisions), the expected
 *    route `all-defaults-final-default` (scope unit-company) and origin
 *    user-requester-a per the ACTUAL spec (Requester A creates AND triggers);
 *  - exact per-step captured candidate groups (members + group scope);
 *  - exactly ONE `final_approval_initiated` audit with the ACTUAL product
 *    enum/comment/source (solutions.ts: action 'final_approval_initiated',
 *    userId = the trigger actor, comments 'Final approval attempt created
 *    from the published route' — nothing invented) plus the reliable
 *    activity counts ('final_approval_approved' × 2, exactly one
 *    FinalApproval→Completed 'status_changed').
 *
 * Both observed browser branches (1 or 2 initiateFinalApproval POSTs) share
 * these SAME persisted expectations: whichever click lost, no second attempt,
 * decision, audit or restart may exist.
 *
 * Honest limits (never claim full T15 proof): duplicate alerts/mail evidence
 * is a PENDING separate task (notifications SELECT untouched this slice);
 * nothing here proves simultaneous server execution.
 *
 * The evaluator is pure (no SQL). Type-only imports keep this module free of
 * a runtime cycle with the capture file that calls it.
 */

import type { DbEvidenceData, DbEvidenceRow, WorkflowCheck } from './capture-workflow-db-evidence'

export const T15A_CHECK_PREFIX = 'db-evidence/Business T15A/persisted-single-transition'

/** Exact initiation audit strings pinned against src/server-actions/solutions.ts (:1353-1361). */
export const T15A_FINAL_INITIATION_ACTION = 'final_approval_initiated'
export const T15A_FINAL_INITIATION_COMMENT = 'Final approval attempt created from the published route'
/** Approval-decision audit action for FINAL rows (transaction-adapter.ts approvalActivityAction). */
export const T15A_FINAL_APPROVAL_ACTIVITY_ACTION = 'final_approval_approved'

export interface T15aPersistedEvidenceInput {
  /** Exact title from t15a-browser-correlation.json — never a prefix match. */
  exactTitle: string
  /** Expected FINAL route version id (defaults to the all-defaults FINAL default — T15A exists only on that profile). */
  expectedRouteVersionId?: string
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function memberIdsOf(data: DbEvidenceData, candidateGroupId: string): string[] {
  const group = data.candidateGroups.find((row) => str(row.id) === candidateGroupId)
  const members = Array.isArray(group?.members) ? (group.members as Array<{ userId?: unknown }>) : []
  return members.map((member) => str(member.userId)).sort()
}

function idsEqual(actual: string[], expected: string[]): boolean {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index])
}

/**
 * Pure REQUIRED evaluator for the T15A persisted single-transition state of
 * ONE exact request (matched by the browser-recorded exact title — zero or
 * multiple matches FAIL; an origin-only prefix is never identity). Missing
 * rows, a second/restarted attempt, duplicate decisions, a wrong actor,
 * state, route, origin, group, audit, or terminal status FAIL — never skip.
 */
export function evaluateT15aPersistedEvidence(
  data: DbEvidenceData,
  input: T15aPersistedEvidenceInput,
): WorkflowCheck[] {
  const n = (name: string) => `${T15A_CHECK_PREFIX}/${name}`
  const checks: WorkflowCheck[] = []
  const titled = data.requests.filter((row) => str(row.title) === input.exactTitle)
  const request = titled.length === 1 ? titled[0] : undefined
  if (!request) {
    checks.push({
      name: n('request-present'),
      status: 'fail',
      detail: titled.length === 0
        ? `REQUIRED T15A request "${input.exactTitle}" not found — required evidence is missing, not skipped`
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
  checks.push({
    name: n('requester-bound'),
    status: str(request.requesterId) === 'user-requester-a' ? 'pass' : 'fail',
    detail: `${title}: requester ${str(request.requesterId)} (expected user-requester-a — the T15A creator/trigger actor)`,
  })

  const finalInstances = data.approvalInstances.filter(
    (row) => str(row.requestId) === requestId && str(row.phase) === 'FINAL',
  )
  const sole = finalInstances.length === 1 ? finalInstances[0] : undefined
  const restartFields = sole === undefined ? [] : [sole.restartOfInstanceId, sole.restartReason, sole.restartedById]
  const intact = sole !== undefined
    && Number(sole.attempt ?? 0) === 1
    && sole.supersededAt == null
    && restartFields.every((field) => field == null || str(field) === '')
  checks.push({
    name: n('final-instance'),
    status: intact ? 'pass' : 'fail',
    detail: intact
      ? `${title}: exactly one FINAL approval instance (attempt 1, current, no restart linkage) — the double-click created no second attempt`
      : `${title}: expected exactly one intact attempt-1 FINAL instance (not superseded, no restart linkage), found ${finalInstances.length}${finalInstances.length === 1 ? ` (attempt ${String(finalInstances[0]?.attempt ?? '?')}${finalInstances[0]?.supersededAt != null ? ', superseded' : ''})` : ''}`,
  })

  if (sole !== undefined) {
    const expectedRoute = input.expectedRouteVersionId ?? 'all-defaults-final-default'
    checks.push({
      name: n('final-route'),
      status: str(sole.routeVersionId) === expectedRoute ? 'pass' : 'fail',
      detail: `${title}: FINAL route ${str(sole.routeVersionId)} (expected ${expectedRoute})`,
    })
    checks.push({
      name: n('final-origin'),
      status: str(sole.originUserId) === 'user-requester-a' ? 'pass' : 'fail',
      detail: `${title}: FINAL origin ${str(sole.originUserId)} (expected user-requester-a — Requester A creates and triggers this scenario)`,
    })
    checks.push({
      name: n('final-state'),
      status: str(sole.state) === 'APPROVED' ? 'pass' : 'fail',
      detail: str(sole.state) === 'APPROVED'
        ? `${title}: persisted FINAL instance state APPROVED (the actual terminal state after both steps)`
        : `${title}: FINAL instance state must be APPROVED, found ${JSON.stringify(str(sole.state) || '(missing)')}`,
    })

    // UNION ROW SCOPE (Astra round-2 P1 + round-3 P1): inspect every row that
    // is EITHER a same-request FINAL row (isFinalApproval flag; the schema
    // permits instanceId null) OR a row whose instanceId references the sole
    // FINAL instance — request_approvals.requestId and .instanceId are
    // SEPARATE foreign keys, so a foreign-request row linked to the selected
    // FINAL instance must be INSPECTED, never silently dropped. Every
    // inspected row is then REQUIRED to carry the correct requestId AND the
    // correct instanceId (below), so cross-request linkage always fails.
    const numericOrder = (row: DbEvidenceRow): number | null => {
      const parsed = Number(row.order)
      return Number.isFinite(parsed) && Number.isInteger(parsed) ? parsed : null
    }
    const unionRows = data.requestApprovals.filter(
      (row) => (str(row.requestId) === requestId && row.isFinalApproval === true)
        || str(row.instanceId) === str(sole.id),
    )
    const rows = [...unionRows].sort(
      (a, b) => (numericOrder(a) ?? Number.MAX_SAFE_INTEGER) - (numericOrder(b) ?? Number.MAX_SAFE_INTEGER),
    )
    const orders = unionRows.map(numericOrder)
    const expectedSteps = ['position-section-manager', 'position-department-manager']
    const expectedApprovers = ['user-section-manager-p', 'user-department-manager']
    // Numeric orders must be the EXACT multiset {1, 2} — parsing string
    // numerics exactly, failing null/'abc'/non-integers; duplicates (1/1,
    // 2/2) are NOT accepted by sorting alone.
    const sortedOrders = orders.length === 2 && orders.every((order) => order !== null)
      ? [...(orders as number[])].sort((a, b) => a - b)
      : null
    const ordersOk = sortedOrders !== null && sortedOrders[0] === 1 && sortedOrders[1] === 2
    const rowsOk = unionRows.length === 2
      && ordersOk
      && unionRows.every(
        (row) => str(row.requestId) === requestId
          && str(row.instanceId) === str(sole.id)
          && row.isFinalApproval === true
          && str(row.status) === 'approved'
          && row.approvedAt != null,
      )
      && idsEqual(rows.map((row) => str(row.requiredPositionId)), expectedSteps)
      && idsEqual(rows.map((row) => str(row.approverId)), expectedApprovers)
    checks.push({
      name: n('final-approved-rows'),
      status: rowsOk ? 'pass' : 'fail',
      detail: rowsOk
        ? `${title}: exactly two same-request FINAL rows in the flag-OR-instance union — orders exactly 1 and 2, both reference the sole FINAL instance, section-manager (user-section-manager-p) then department-manager (user-department-manager), both approved with isFinalApproval=true and no duplicate decisions`
        : `${title}: FINAL union rows are [${unionRows.map((row) => `order:${String(row.order)}:${str(row.requiredPositionId)}:${str(row.status)}:${str(row.approverId)}:final=${String(row.isFinalApproval)}:request=${str(row.requestId)}:instance=${str(row.instanceId)}`).join(' | ')}] — expected exactly two rows, numeric orders exactly 1 and 2, all carrying the correlated requestId AND the sole FINAL instanceId with isFinalApproval=true, [section-manager:approved:user-section-manager-p | department-manager:approved:user-department-manager]`,
    })

    // ROW-LINKED GROUP VERIFICATION (Astra round-2 P1): the instance must
    // hold the EXACT two-group set, and each FINAL row's candidateGroupId must
    // resolve (never dangling, never another instance's group, never null or
    // swapped) to the group expected for that row's numeric order — position,
    // group scope unit-company and exact members. Groups are verified THROUGH
    // the rows, never as independent existence.
    const instanceGroups = data.candidateGroups.filter(
      (row) => str(row.approvalInstanceId) === str(sole.id),
    )
    const expectedGroupsByOrder: ReadonlyArray<readonly [number, string, readonly string[]]> = [
      [1, 'position-section-manager', ['user-section-manager-p']],
      [2, 'position-department-manager', ['user-department-manager']],
    ]
    const groupResults = expectedGroupsByOrder.map(([order, positionId, expectedMembers]) => {
      const row = rows.find((candidate) => numericOrder(candidate) === order)
      const group = row === undefined ? undefined : data.candidateGroups.find((candidate) => str(candidate.id) === str(row.candidateGroupId))
      const linkedOk = row !== undefined
        && group !== undefined
        && str(group.approvalInstanceId) === str(sole.id)
        && str(group.requiredPositionId) === positionId
      const members = group === undefined ? [] : memberIdsOf(data, str(group.id))
      const membersOk = linkedOk && idsEqual(members, [...expectedMembers])
      const scopeOk = linkedOk && str(group.scopeUnitId) === 'unit-company'
      return { order, positionId, members, linkedOk, membersOk, scopeOk }
    })
    const groupsOk = instanceGroups.length === 2 && groupResults.every((result) => result.linkedOk && result.membersOk && result.scopeOk)
    checks.push({
      name: n('final-captured-groups'),
      status: groupsOk ? 'pass' : 'fail',
      detail: groupsOk
        ? `${title}: FINAL instance holds the exact two-group set and each row's candidateGroupId links order 1 -> section-manager [user-section-manager-p], order 2 -> department-manager [user-department-manager] (scope unit-company, exact members)`
        : `${title}: FINAL group linkage mismatch — instance groups ${instanceGroups.length} (expected exactly 2); ${groupResults.map((result) => `order ${result.order} ${result.positionId}:[${result.members.join(', ')}]${result.linkedOk ? '' : ' (row link dangling/null/swapped/other-instance)'}${result.scopeOk ? '' : ' (scope not unit-company)'}`).join(' | ')}`,
    })
  }

  const initiations = data.requestActivities.filter(
    (row) => str(row.requestId) === requestId && str(row.action) === T15A_FINAL_INITIATION_ACTION,
  )
  const initiationOk = initiations.length === 1
    && str(initiations[0]?.userId) === 'user-requester-a'
    && str(initiations[0]?.comments) === T15A_FINAL_INITIATION_COMMENT
  checks.push({
    name: n('final-initiation-audit'),
    status: initiationOk ? 'pass' : 'fail',
    detail: initiationOk
      ? `${title}: exactly one 'final_approval_initiated' audit by user-requester-a with the actual published-route comment — the second click left no duplicate audit`
      : `${title}: expected exactly one 'final_approval_initiated' activity (user user-requester-a, comments "${T15A_FINAL_INITIATION_COMMENT}"), found ${initiations.length} (${initiations.map((row) => `${str(row.userId)}:"${str(row.comments)}"`).join(', ') || 'none'})`,
  })

  const approvalActivities = data.requestActivities.filter(
    (row) => str(row.requestId) === requestId && str(row.action) === T15A_FINAL_APPROVAL_ACTIVITY_ACTION,
  )
  checks.push({
    name: n('final-approval-activity-count'),
    status: approvalActivities.length === 2 ? 'pass' : 'fail',
    detail: approvalActivities.length === 2
      ? `${title}: exactly two 'final_approval_approved' activities (one per decided step)`
      : `${title}: expected exactly 2 'final_approval_approved' activities, found ${approvalActivities.length}`,
  })

  const completions = data.requestActivities.filter(
    (row) => str(row.requestId) === requestId
      && str(row.action) === 'status_changed'
      && str(row.fromStatus) === 'FinalApproval'
      && str(row.toStatus) === 'Completed',
  )
  checks.push({
    name: n('completion-audit'),
    status: completions.length === 1 ? 'pass' : 'fail',
    detail: completions.length === 1
      ? `${title}: exactly one FinalApproval→Completed 'status_changed' audit`
      : `${title}: expected exactly one FinalApproval→Completed 'status_changed' activity, found ${completions.length}`,
  })

  checks.push({
    name: n('request-completed'),
    status: str(request.status) === 'Completed' ? 'pass' : 'fail',
    detail: `${title}: final persisted status ${str(request.status)} (expected Completed — the single attempt completed the FULL chain)`,
  })

  return checks
}
