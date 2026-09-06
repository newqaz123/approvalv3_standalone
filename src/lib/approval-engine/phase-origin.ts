import type { ReportingBranch } from '@/lib/organization/types'
import { resolveReportingBranch } from '@/lib/organization/repository'
import type { OrganizationRepository } from '@/lib/organization/repository'
import { ApprovalRouteConfigurationError } from '@/lib/approval-routes/validation'
import type { PhaseOrigin, PhaseOriginQuery } from './types'

/**
 * Structural port over the document tables the phase-origin derivation reads.
 * Satisfied by `Prisma.TransactionClient` and by structural test fakes.
 */
export interface PhaseOriginTx {
  requests: {
    findUnique(args: {
      where: { id: string }
      select: { requesterId: true; departmentId: true }
    }): Promise<{ requesterId: string; departmentId: string | null } | null>
  }
  solutions: {
    findUnique(args: {
      where: { id: string }
      select: { requestId: true; submittedById: true }
    }): Promise<{ requestId: string; submittedById: string } | null>
  }
}

export type PhaseOriginRepository = PhaseOriginTx & OrganizationRepository

/**
 * Exact phase origins for NEW instances:
 * - REQUEST: the stored `requests.requesterId`.
 * - SOLUTION: the stored `solutions.submittedById` (the engineering
 *   submitter) and that submitter's organization branch.
 * - FINAL: the authenticated final initiator (trusted action input) while
 *   retaining the stored request department as legacy context. Legacy final
 *   initiation keeps its same-department check and NEW final initiation uses
 *   direct originating-unit membership; neither substitutes for the
 *   initiator's route origin resolved here.
 *
 * The adapter never trusts an arbitrary client originUserId: for
 * REQUEST/SOLUTION the stored document identity wins and a mismatched actor
 * input is rejected. `requestDepartmentId` is nullable legacy context only.
 */
export async function resolvePhaseOrigin(db: PhaseOriginRepository, query: PhaseOriginQuery): Promise<PhaseOrigin> {
  if (query.phase === 'SOLUTION') {
    if (!query.solutionId) {
      throw new ApprovalRouteConfigurationError('Solution phase origin requires the solution document id')
    }
    const solution = await db.solutions.findUnique({
      where: { id: query.solutionId },
      select: { requestId: true, submittedById: true },
    })
    if (!solution) {
      throw new ApprovalRouteConfigurationError(`Solution ${query.solutionId} no longer exists`)
    }
    assertTrustedActor(query, solution.submittedById, 'solution submitter')
    const request = await requireStoredRequest(db, solution.requestId)
    const branch = await loadOriginBranch(db, solution.submittedById)
    return {
      phase: 'SOLUTION',
      originUserId: solution.submittedById,
      originUnitId: branch.primaryUnitId,
      branch,
      originalRequestId: solution.requestId,
      requestDepartmentId: request.departmentId,
      source: 'SOLUTION_SUBMITTER',
    }
  }

  const request = await requireStoredRequest(db, query.requestId)
  if (query.phase === 'FINAL') {
    if (!query.originUserId) {
      throw new ApprovalRouteConfigurationError('Final phase origin requires the authenticated final initiator')
    }
    const branch = await loadOriginBranch(db, query.originUserId)
    return {
      phase: 'FINAL',
      originUserId: query.originUserId,
      originUnitId: branch.primaryUnitId,
      branch,
      originalRequestId: query.requestId,
      requestDepartmentId: request.departmentId,
      source: 'FINAL_INITIATOR',
    }
  }

  assertTrustedActor(query, request.requesterId, 'requester')
  const branch = await loadOriginBranch(db, request.requesterId)
  return {
    phase: 'REQUEST',
    originUserId: request.requesterId,
    originUnitId: branch.primaryUnitId,
    branch,
    originalRequestId: query.requestId,
    requestDepartmentId: request.departmentId,
    source: 'REQUESTER',
  }
}

async function requireStoredRequest(db: PhaseOriginRepository, requestId: string): Promise<{ requesterId: string; departmentId: string | null }> {
  const request = await db.requests.findUnique({
    where: { id: requestId },
    select: { requesterId: true, departmentId: true },
  })
  if (!request) {
    throw new ApprovalRouteConfigurationError(`Request ${requestId} no longer exists`)
  }
  return request
}

function assertTrustedActor(query: PhaseOriginQuery, storedOriginUserId: string, label: string): void {
  if (query.originUserId !== undefined && query.originUserId !== storedOriginUserId) {
    throw new ApprovalRouteConfigurationError(
      `Authenticated actor does not match the stored ${label} origin of the document`,
    )
  }
}

async function loadOriginBranch(db: PhaseOriginRepository, originUserId: string): Promise<ReportingBranch> {
  // resolveReportingBranch returns null only for missing/inactive or
  // completely unmapped users; malformed mapped configuration throws inside.
  const branch = await resolveReportingBranch(originUserId, db)
  if (!branch) {
    throw new ApprovalRouteConfigurationError(`No unambiguous origin reporting branch for user ${originUserId}`)
  }
  return branch
}
