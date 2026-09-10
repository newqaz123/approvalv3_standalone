// Clean-start approval candidate selection — option A (Plan B Task 3).
// Pure structural set-builder: NO Prisma, NO database, no legacy engine
// imports, no per-step account lookup, no rank-inferred substitution.
//
// Candidates for requiredPositionId are persons holding EXACTLY that
// position who are (a) ACTIVE members in ownTeamMemberAssignments or
// (b) persons on the reporting path (reports-to, then own-unit manager,
// then ancestors). Search order is own team then path; the result is the
// deduplicated union keyed by userId (first occurrence wins).
//
// Ledger R-A6-2: the reporting path is structural, not authorization.
// This module must not treat path membership as an action grant. Inactive
// own-team assignments are skipped and never silently replaced. Account
// activity is not looked up here — action-time checks stay with later
// engine tasks. The origin userId is never a candidate. Sibling-team
// members are never in ownTeamMemberAssignments (caller contract).

import type { AssignmentNode, ReportingPath } from '@/lib/organization/model'

export interface CandidateSelectionInput {
  path: ReportingPath
  requiredPositionId: string
  /** ACTIVE assignments of the origin's own team (empty when ungrouped). */
  ownTeamMemberAssignments: readonly AssignmentNode[]
}

export function selectStepCandidates(
  input: CandidateSelectionInput,
): ReadonlyArray<{ userId: string; assignmentId: string }> {
  const { path, requiredPositionId, ownTeamMemberAssignments } = input
  const originUserId = path.originUserId
  const seenUserIds = new Set<string>()
  const selected: Array<{ userId: string; assignmentId: string }> = []

  const pushExact = (userId: string, assignmentId: string): void => {
    if (userId === originUserId) return
    if (seenUserIds.has(userId)) return
    seenUserIds.add(userId)
    selected.push({ userId, assignmentId })
  }

  for (const assignment of ownTeamMemberAssignments) {
    if (!assignment.isActive) continue
    if (assignment.positionId !== requiredPositionId) continue
    pushExact(assignment.userId, assignment.id)
  }

  for (const step of path.steps) {
    if (step.positionId !== requiredPositionId) continue
    pushExact(step.userId, step.assignmentId)
  }

  return selected
}
