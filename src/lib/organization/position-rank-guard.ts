// Clean-start position rank-change impact guard (Plan A Task 4).
// Pure block-and-list assessment over the A2/A3 domain model: applies a
// proposed company-wide rank to an internal copy, then re-checks the Task 3
// team reporting rule and every supplied published route's ascending/limit
// invariants. It never mutates its input, never auto-repairs anything, and
// never consults approval attempt snapshots — existing attempts keep their
// immutable snapshot values. Imports the canonical ApprovalPhase from the
// existing approval-routes types (plan Task 4 + ruling R5; B15 rewires this
// import once B2's definition.ts owns the union). Type-only legacy surface:
// no runtime import of legacy organization modules.
import type { ApprovalPhase } from '@/lib/approval-routes/definition'
import { OrganizationValidationError } from './assignments'
import type { AssignmentNode, PositionNode, TeamNode } from './model'

export interface RankChangeImpact {
  blocked: boolean
  affectedReportingRelationships: ReadonlyArray<{ teamId: string; teamName: string; unitId: string }>
  affectedPublishedRoutes: ReadonlyArray<{
    routeVersionId: string; scopeUnitId: string; phase: ApprovalPhase
    problem: 'STEP_NOT_ASCENDING' | 'STEP_EXCEEDS_LIMIT'
  }>
}

/**
 * Assesses the organization state that would result from changing one
 * position's company-wide rank (a limit-position change is assessed the same
 * way — the limit is just a position reference).
 *
 * Blocked when the proposed rank would break (1) an ACTIVE team's
 * reports-to-strictly-above-every-ACTIVE-member invariant, (2) a supplied
 * published route's strictly-ascending step ranks (steps are compared in
 * stepOrder order — the persisted row order — never in input array order),
 * or (3) a step rank above the route's approval-limit rank. Inactive teams
 * and inactive assignments are history and are exempt from the relationship
 * checks; global tree/unique-id invariants are validateOrganization's job
 * and are not re-checked here.
 *
 * publishedRoutes CALLER CONTRACT: this input deliberately carries no status
 * field. The caller must supply ONLY PUBLISHED route versions — drafts never
 * block, and the guard neither filters drafts nor invents a status field.
 *
 * Malformed CONSULTED input throws OrganizationValidationError instead of
 * pretending a safe impact (parent A4 ruling): a missing change target or
 * non-finite proposed rank always throws; duplicate position ids are
 * rejected globally (historical rows included) and the consulted assignment
 * id map never silently overwrites duplicates; an ACTIVE team's
 * missing/inactive/wrong-unit/self-member reports-to throws; live
 * relationships must reference existing ACTIVE positions with finite ranks;
 * supplied routes' missing step/limit position refs, non-finite stepOrder,
 * and duplicate stepOrder throw; finiteness is required only for consulted ranks — irrelevant
 * inactive historical position ranks are tolerated. A VALID proposed change
 * that merely creates a rank/order/limit violation is never malformed: it is
 * the principal blocked-and-listed result.
 *
 * Output ordering is deterministic: relationships in input team order, route
 * problems in input route order, and within one route STEP_NOT_ASCENDING
 * before STEP_EXCEEDS_LIMIT.
 */
export function assessPositionRankChange(input: {
  positions: readonly PositionNode[]
  teams: readonly TeamNode[]
  assignments: readonly AssignmentNode[]
  publishedRoutes: ReadonlyArray<{
    id: string; scopeUnitId: string; phase: ApprovalPhase
    approvalLimitPositionId: string
    /** persisted step rows; compared in stepOrder order regardless of array order */
    steps: ReadonlyArray<{ stepOrder: number; positionId: string }>
  }>
  positionId: string
  proposedRank: number
}): RankChangeImpact {
  const { positions, teams, assignments, publishedRoutes, positionId, proposedRank } = input

  if (!Number.isFinite(proposedRank)) {
    throw new OrganizationValidationError(
      `proposed rank for position "${positionId}" is not a finite number: ${proposedRank}`,
    )
  }

  // Identity maps reject duplicates instead of silently overwriting (parent
  // A4 ruling); duplicate position ids are rejected globally, historical
  // rows included, mirroring validateOrganization's up-front rejection.
  const positionById = new Map<string, PositionNode>()
  for (const position of positions) {
    if (positionById.has(position.id)) {
      throw new OrganizationValidationError(`duplicate position id "${position.id}"`)
    }
    positionById.set(position.id, position)
  }
  const assignmentById = new Map<string, AssignmentNode>()
  for (const assignment of assignments) {
    if (assignmentById.has(assignment.id)) {
      throw new OrganizationValidationError(`duplicate assignment id "${assignment.id}"`)
    }
    assignmentById.set(assignment.id, assignment)
  }

  const target = positionById.get(positionId)
  if (target === undefined) {
    throw new OrganizationValidationError(`rank change target position id "${positionId}" is missing from the given positions`)
  }
  if (!Number.isFinite(target.rank)) {
    throw new OrganizationValidationError(`rank change target position "${positionId}" has non-finite rank ${target.rank}`)
  }

  // Rank under the proposed change: the target uses proposedRank (applied to
  // a copy — the input arrays are never mutated); every other position keeps
  // its current rank, finiteness-checked at consultation time only. The
  // referenced position is resolved and validated BEFORE the substitution so
  // the change target cannot bypass live-reference activity validation
  // (fix1 P1-1): an inactive target throws when a live relationship consults
  // it and stays changeable when only routes (or nothing) reference it.
  const rankOf = (referencer: string, refPositionId: string, requireActivePosition: boolean): number => {
    const position = positionById.get(refPositionId)
    if (position === undefined) {
      throw new OrganizationValidationError(`${referencer} references missing position id "${refPositionId}"`)
    }
    if (requireActivePosition && !position.isActive) {
      throw new OrganizationValidationError(`${referencer} references inactive position "${refPositionId}"`)
    }
    if (!Number.isFinite(position.rank)) {
      throw new OrganizationValidationError(`${referencer} references position "${refPositionId}" with non-finite rank ${position.rank}`)
    }
    return refPositionId === positionId ? proposedRank : position.rank
  }

  // Active teams: reports-to must stay strictly above every active member.
  // A malformed current reports-to (missing/inactive/wrong-unit/self-member)
  // throws rather than disappearing from the comparison (parent A4 ruling).
  const affectedReportingRelationships: Array<{ teamId: string; teamName: string; unitId: string }> = []
  for (const team of teams) {
    if (!team.isActive) continue
    const reportsTo = assignmentById.get(team.reportsToAssignmentId)
    if (reportsTo === undefined) {
      throw new OrganizationValidationError(
        `team "${team.id}" (unit "${team.unitId}") reports-to references missing assignment id "${team.reportsToAssignmentId}"`,
      )
    }
    if (!reportsTo.isActive) {
      throw new OrganizationValidationError(
        `team "${team.id}" (unit "${team.unitId}") reports-to assignment "${reportsTo.id}" is inactive`,
      )
    }
    if (reportsTo.unitId !== team.unitId) {
      throw new OrganizationValidationError(
        `team "${team.id}" (unit "${team.unitId}") reports-to assignment "${reportsTo.id}" is active in unit "${reportsTo.unitId}", not in unit "${team.unitId}"`,
      )
    }
    if (reportsTo.teamId === team.id) {
      throw new OrganizationValidationError(
        `team "${team.id}" (unit "${team.unitId}") reports-to assignment "${reportsTo.id}" is itself a member of the team`,
      )
    }
    const reportsToRank = rankOf(
      `team "${team.id}" (unit "${team.unitId}") reports-to assignment "${reportsTo.id}"`,
      reportsTo.positionId,
      true,
    )
    let memberViolates = false
    // EVERY active member is validated (fix1 P1-3): no early break, so a
    // malformed later reference always throws regardless of whether an
    // earlier member already violates the relationship; the team is listed
    // once afterward.
    for (const member of assignments) {
      if (!member.isActive || member.teamId !== team.id) continue
      const memberRank = rankOf(
        `team "${team.id}" (unit "${team.unitId}") active member assignment "${member.id}"`,
        member.positionId,
        true,
      )
      if (reportsToRank <= memberRank) memberViolates = true
    }
    if (memberViolates) {
      affectedReportingRelationships.push({ teamId: team.id, teamName: team.name, unitId: team.unitId })
    }
  }

  // Supplied published routes (caller-filtered): steps must ascend in
  // stepOrder order and no step may exceed the approval-limit rank.
  const affectedPublishedRoutes: Array<{
    routeVersionId: string; scopeUnitId: string; phase: ApprovalPhase
    problem: 'STEP_NOT_ASCENDING' | 'STEP_EXCEEDS_LIMIT'
  }> = []
  for (const route of publishedRoutes) {
    // Non-finite stepOrder is malformed consulted ordering input and throws
    // BEFORE duplicate detection and sorting (fix1 P1-2, parent adjudication:
    // fail-closed, no new business constraints) — even a single such step
    // cannot establish the persisted ordering.
    for (const step of route.steps) {
      if (!Number.isFinite(step.stepOrder)) {
        throw new OrganizationValidationError(`published route "${route.id}" has non-finite stepOrder ${step.stepOrder}`)
      }
    }
    const seenStepOrder = new Set<number>()
    for (const step of route.steps) {
      if (seenStepOrder.has(step.stepOrder)) {
        throw new OrganizationValidationError(`published route "${route.id}" has duplicate stepOrder ${step.stepOrder}`)
      }
      seenStepOrder.add(step.stepOrder)
    }
    const limitRank = rankOf(`published route "${route.id}" approval limit`, route.approvalLimitPositionId, false)
    const orderedSteps = [...route.steps].sort((a, b) => a.stepOrder - b.stepOrder)
    const stepRanks: number[] = []
    let ascending = true
    for (const step of orderedSteps) {
      const rank = rankOf(`published route "${route.id}" step (stepOrder ${step.stepOrder})`, step.positionId, false)
      const previous = stepRanks[stepRanks.length - 1]
      if (previous !== undefined && rank <= previous) ascending = false
      stepRanks.push(rank)
    }
    if (!ascending) {
      affectedPublishedRoutes.push({
        routeVersionId: route.id, scopeUnitId: route.scopeUnitId, phase: route.phase, problem: 'STEP_NOT_ASCENDING',
      })
    }
    if (stepRanks.some((rank) => rank > limitRank)) {
      affectedPublishedRoutes.push({
        routeVersionId: route.id, scopeUnitId: route.scopeUnitId, phase: route.phase, problem: 'STEP_EXCEEDS_LIMIT',
      })
    }
  }

  return {
    blocked: affectedReportingRelationships.length > 0 || affectedPublishedRoutes.length > 0,
    affectedReportingRelationships,
    affectedPublishedRoutes,
  }
}
