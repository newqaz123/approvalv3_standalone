/**
 * Sequential-step actionability for already-loaded approval rows.
 *
 * A pending row is actionable only when its document (request or solution)
 * has no other pending current-instance row with a lower order. Dependency-free
 * so the My Actions list and the badge count can share one rule.
 */
export interface ApprovalOrderRow {
  /** Id of the request or solution the approval row belongs to. */
  parentId: string
  order: number
}

/**
 * Parent ids where one of `mine` is first in line among `pending`.
 * `pending` must hold every pending current-instance row of those parents.
 */
export function actionableParentIds(
  mine: readonly ApprovalOrderRow[],
  pending: readonly ApprovalOrderRow[],
): Set<string> {
  const firstPendingOrder = new Map<string, number>()
  for (const row of pending) {
    const current = firstPendingOrder.get(row.parentId)
    if (current === undefined || row.order < current) firstPendingOrder.set(row.parentId, row.order)
  }
  const actionable = new Set<string>()
  for (const row of mine) {
    const first = firstPendingOrder.get(row.parentId)
    if (first === undefined || row.order <= first) actionable.add(row.parentId)
  }
  return actionable
}
