'use server'

import { auth } from '@/lib/auth-config'
import prisma from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { revalidateRequestViews } from './request-view-invalidation'
import { z } from 'zod'
import { requireAdmin } from '@/lib/auth'
import { getCurrentUser, getUserById } from '@/lib/cache/user-cache'
import {
  attachmentFileExists,
  deleteAttachmentFile,
  isRequestDraftReadyPath,
} from '@/lib/attachments/storage'
import { MAX_ATTACHMENTS_PER_FORM } from '@/lib/attachments/policy'
import { descriptionSchema } from '@/lib/schemas/solution-schemas'
import {
  prepareInlineDescription,
  reconcileInlineDescriptionImages,
} from '@/lib/inline-images/references'
import { cancellationReasonSchema } from '@/lib/schemas/cancellation-schemas'
import { buildRequestExportRows } from '@/lib/request-export'
import { APPROVAL_DISPLAY_SELECT, withApprovalDisplay } from '@/lib/approval-display'
import {
  evaluateRequesterCancellation,
  getCancellationBlockedMessage,
} from '@/lib/cancellation-policy'
import {
  buildRejectedRequestCancellationWhere,
  buildRejectedRequestResubmissionWhere,
  updateRequestStatusExpecting,
} from '@/lib/request-status-transition'
import {
  APPROVAL_ENGINE_TRANSACTION_ISOLATION,
  ApprovalEngineConflictError,
  ApprovalEnginePlanError,
} from '@/lib/approval-engine/plan'
import {
  canSubmitRequests,
  createCleanStartPhaseAttemptTx,
  createRequestApprovalAttempt,
  markCurrentInstanceOutcome,
  requireAssignableSubmitter,
  SubmissionDeniedError,
  type CleanStartAttemptStore,
} from '@/lib/approval-engine/attempts'
import { CURRENT_INSTANCE_ROW_FILTER, snapshotGroupActionWhere } from '@/lib/approval-engine/current-instance'
import { ApprovalRouteConfigurationError } from '@/lib/approval-routes/definition'
import { buildRequestVisibilityWhere, canUserViewRequest, createRequestVisibilityDb } from '@/lib/request-visibility/scope'
import { mapEventRecipients } from '@/lib/notification-recipients'
import { descendantUnitIds } from '@/lib/organization/hierarchy'
import type { OrganizationUnitNode } from '@/lib/organization/model'
import {
  evaluateRequestAction,
  existingAssignEngineersDecision,
  existingCancelRequestDecision,
  existingResubmitRequestDecision,
} from '@/lib/action-permissions'

import type { Prisma } from '@prisma/client'
import * as XLSX from 'xlsx'

const REQUEST_DRAFT_READY_PREFIX = 'request-drafts/ready/'
const ATTACHMENT_ADOPTION_ERROR = 'One or more attachments are invalid or no longer available'

async function loadOrganizationUnitNodes(): Promise<OrganizationUnitNode[]> {
  return prisma.organization_units.findMany({
    select: {
      id: true,
      name: true,
      parentId: true,
      isActive: true,
      shareRequests: true,
      canWorkOnSolutions: true,
      managerUserId: true,
    },
  })
}

function readyRequestDraftWhere(ids: string[], uploadedById: string) {
  return {
    id: { in: ids },
    uploadedById,
    requestId: null,
    solutionId: null,
    filePath: { startsWith: REQUEST_DRAFT_READY_PREFIX },
  }
}

// Zod schema for request validation
const createRequestSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200, 'Title too long'),
  description: descriptionSchema,
  inlineImageSessionId: z.string().uuid(),
  // Ready draft row IDs from the XHR stage route. createRequest adopts them
  // in the same transaction as the request so a request cannot exist without
  // its attachment rows.
  stagedAttachmentIds: z.array(z.string().uuid()).max(MAX_ATTACHMENTS_PER_FORM).refine(
    (ids) => new Set(ids).size === ids.length,
    'Attachment IDs must be unique',
  ).default([]),
})

export interface CreateRequestInput {
  title: string
  description: string
  // Callers add this during the editor-coordinator rollout; validation still
  // requires it before any description save can claim image drafts.
  inlineImageSessionId?: string
  stagedAttachmentIds?: string[]
}

/**
 * Create a new request with automatic logging to audit trail
 */
export async function createRequest(input: CreateRequestInput) {
  const user = await getCurrentUser()

  if (!user) {
    return {
      success: false,
      error: 'Active organization assignment is required to create requests',
    }
  }
  const existingAssignment = await prisma.organization_assignments.findFirst({
    where: { userId: user.id, isActive: true },
    select: { unitId: true },
  })
  if (!canSubmitRequests({ isActiveUser: user.isActive, hasActiveAssignment: Boolean(existingAssignment) })) {
    return {
      success: false,
      error: 'Active organization assignment is required to create requests',
    }
  }

  // Validate input
  const validatedFields = createRequestSchema.safeParse(input)

  if (!validatedFields.success) {
    return {
      success: false,
      errors: validatedFields.error.flatten().fieldErrors,
    }
  }

  const prepared = await prepareInlineDescription({
    description: validatedFields.data.description,
    userId: user.id,
    uploadSessionId: validatedFields.data.inlineImageSessionId,
  })

  const stagedAttachmentIds = validatedFields.data.stagedAttachmentIds

  // Precheck owner-scoped ready drafts and their physical files. The same
  // predicates are repeated on the transactional updateMany so DELETE/adopt
  // races still fail closed under READ COMMITTED.
  if (stagedAttachmentIds.length > 0) {
    const drafts = await prisma.file_attachments.findMany({
      where: readyRequestDraftWhere(stagedAttachmentIds, user.id),
      select: { id: true, filePath: true, fileName: true },
    })
    if (drafts.length !== stagedAttachmentIds.length) {
      return { success: false, error: ATTACHMENT_ADOPTION_ERROR }
    }
    for (const draft of drafts) {
      if (!isRequestDraftReadyPath(draft.filePath)) {
        return { success: false, error: ATTACHMENT_ADOPTION_ERROR }
      }
      if (!(await attachmentFileExists(draft.filePath))) {
        return {
          success: false,
          error: `${draft.fileName}: Staged file is missing — please retry the upload`,
        }
      }
    }
  }

  let request: { id: string; title: string }
  let pendingCandidateUserIds: readonly string[] = []

  try {
    const txResult = await prisma.$transaction(
      async (tx) => {
      const assignment = await tx.organization_assignments.findFirst({
        where: { userId: user.id, isActive: true },
        select: { unitId: true },
      })
      const { unitId: organizationUnitId } = requireAssignableSubmitter({
        isActiveUser: user.isActive,
        assignment,
      })

      let newRequest = await tx.requests.create({
        data: {
          title: validatedFields.data.title,
          description: prepared.html,
          requesterId: user.id,
          organizationUnitId,
          status: 'ImprovementRequest',
        },
      })

      if (stagedAttachmentIds.length > 0) {
        const adopted = await tx.file_attachments.updateMany({
          where: readyRequestDraftWhere(stagedAttachmentIds, user.id),
          data: { requestId: newRequest.id },
        })
        if (adopted.count !== stagedAttachmentIds.length) {
          throw new Error(ATTACHMENT_ADOPTION_ERROR)
        }
      }

      await reconcileInlineDescriptionImages(tx, {
        owner: { kind: 'request', id: newRequest.id },
        imageIds: prepared.imageIds,
      })

      await tx.request_activities.create({
        data: {
          requestId: newRequest.id,
          action: 'created',
          toStatus: 'ImprovementRequest',
          comments: `Request created: ${validatedFields.data.title}`,
          userId: user.id,
        },
      })

      const attempt = await createRequestApprovalAttempt(
        createCleanStartPhaseAttemptTx(tx as unknown as CleanStartAttemptStore),
        { requestId: newRequest.id, phase: 'REQUEST', originUserId: user.id },
      )
      if (attempt.statusChange) {
        newRequest = await tx.requests.update({
          where: { id: newRequest.id },
          data: { status: attempt.statusChange.to },
        })
        await tx.request_activities.create({
          data: {
            requestId: newRequest.id,
            userId: user.id,
            action: 'status_changed',
            fromStatus: attempt.statusChange.from,
            toStatus: attempt.statusChange.to,
            comments: attempt.completedWithoutSteps
              ? 'Auto-completed: NO_ELIGIBLE_APPROVAL_STEPS (no eligible approval steps)'
              : 'Auto-approved by position ceiling',
          },
        })
      }

      return {
        request: newRequest,
        pendingCandidateUserIds: attempt.instance.state === 'PENDING'
          ? (attempt.instance.steps[0]?.candidateUserIds ?? [])
          : [],
      }
        },
        { isolationLevel: APPROVAL_ENGINE_TRANSACTION_ISOLATION },
      )
      .catch((error: unknown) => {
        if (error instanceof ApprovalEngineConflictError) throw error
        const code = (error as { code?: unknown })?.code
        if (code === 'P2034' || code === '40001') {
          throw new ApprovalEngineConflictError()
        }
        throw error
      })

    request = txResult.request
    pendingCandidateUserIds = txResult.pendingCandidateUserIds
  } catch (error) {
    console.error('Failed to create request atomically:', error)
    if (error instanceof Error && error.message === ATTACHMENT_ADOPTION_ERROR) {
      return { success: false, error: ATTACHMENT_ADOPTION_ERROR }
    }
    if (
      error instanceof SubmissionDeniedError
      || error instanceof ApprovalRouteConfigurationError
      || error instanceof ApprovalEnginePlanError
      || error instanceof ApprovalEngineConflictError
    ) {
      return { success: false, error: error.message }
    }
    return { success: false, error: 'Failed to create request — please try again' }
  }

  if (pendingCandidateUserIds.length > 0) {
    const { createNotification } = await import('./notifications')
    for (const userId of pendingCandidateUserIds) {
      await createNotification({
        userId,
        type: 'approval_needed',
        title: 'New Approval Request',
        message: `📋 New Approval Request: "${request.title}" requires your approval.`,
        requestId: request.id,
      })
    }
  }

  revalidateRequestViews()

  return { success: true, requestId: request.id }
}

export interface GetRequestsFilters {
  status?: string
  statuses?: string[]
  unitId?: string
  requesterId?: string
  dateFrom?: string
  dateTo?: string
  search?: string
  wrStatus?: 'all' | 'not-received' | 'received'
  includeArchived?: boolean
}

function buildRequestFilters(
  filters?: GetRequestsFilters,
  unitSubtreeIds?: readonly string[],
): Prisma.requestsWhereInput {
  if (!filters && (!unitSubtreeIds || unitSubtreeIds.length === 0)) return {}
  const clauses: Prisma.requestsWhereInput[] = []
  if (filters?.statuses && filters.statuses.length > 0) {
    clauses.push({ status: { in: filters.statuses as never } })
  } else if (filters?.status) {
    clauses.push({ status: filters.status as never })
  }
  if (filters?.wrStatus === 'received') {
    clauses.push({ workRequisitionReceived: true })
  } else if (filters?.wrStatus === 'not-received') {
    clauses.push({ workRequisitionReceived: false })
  }
  if (unitSubtreeIds && unitSubtreeIds.length > 0) {
    clauses.push({ organizationUnitId: { in: [...unitSubtreeIds] } })
  }
  if (filters?.requesterId) {
    clauses.push({ requesterId: filters.requesterId })
  }
  if (filters?.dateFrom || filters?.dateTo) {
    const createdAt: Prisma.DateTimeFilter = {}
    if (filters.dateFrom) {
      createdAt.gte = new Date(filters.dateFrom)
    }
    if (filters.dateTo) {
      const endDate = new Date(filters.dateTo)
      endDate.setHours(23, 59, 59, 999)
      createdAt.lte = endDate
    }
    clauses.push({ createdAt })
  }
  if (filters?.search) {
    clauses.push({
      OR: [
        { title: { contains: filters.search, mode: 'insensitive' } },
        { description: { contains: filters.search, mode: 'insensitive' } },
        { id: { contains: filters.search, mode: 'insensitive' } },
        { requester: { name: { contains: filters.search, mode: 'insensitive' } } },
      ],
    })
  }
  return clauses.length > 0 ? { AND: clauses } : {}
}

/**
 * Get requests visible to the current user through the shared visibility predicate.
 * Status, archive, search, and other filters are ANDed and never overwrite visibility OR.
 */
export async function getMyRequests(filters?: GetRequestsFilters) {
  const currentUser = await getCurrentUser()

  if (!currentUser) {
    throw new Error('User not found')
  }

  const visibilityWhere = await buildRequestVisibilityWhere(createRequestVisibilityDb(prisma), {
    userId: currentUser.id,
    includeArchived: filters?.includeArchived === true,
  })
  let unitSubtreeIds: readonly string[] | undefined
  if (filters?.unitId) {
    const units = await loadOrganizationUnitNodes()
    unitSubtreeIds = descendantUnitIds(units, filters.unitId)
  }
  const requestWhere: Prisma.requestsWhereInput = {
    AND: [visibilityWhere, buildRequestFilters(filters, unitSubtreeIds)],
  }

  const requests = await prisma.requests.findMany({
    where: requestWhere,
    select: {
      id: true,
      title: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      workRequisitionReceived: true,
      workRequisitionReceivedAt: true,
      workRequisitionReceivedBy: {
        select: {
          id: true,
          name: true,
        },
      },
      requesterId: true,
      organizationUnit: {
        select: {
          id: true,
          name: true,
        },
      },
      requester: {
        select: {
          id: true,
          name: true,
        },
      },
      _count: {
        select: {
          fileAttachments: true,
        },
      },
      solutions: {
        select: {
          id: true,
          approvals: {
            select: {
              id: true,
              status: true,
              approver: {
                select: { name: true },
              },
              requiredApprover: {
                select: { name: true },
              },
                            order: true,
              approvedAt: true,
              candidateGroup: {
                select: {
                  members: {
                    select: { capturedDisplayName: true },
                    take: 10,
                  },
                },
              },
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: 1,
      },
      activities: {
        where: { action: 'solution_rejected' },
        take: 1,
      },
      engineerAssignments: {
        select: {
          engineer: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
      approvals: {
        orderBy: {
          order: 'asc',
        },
        select: {
          id: true,
          status: true,
                    order: true,
          approvedAt: true,
          isFinalApproval: true,
          approver: {
            select: {
              name: true,
            },
          },
          requiredApprover: {
            select: {
              name: true,
            },
          },
          candidateGroup: {
            select: {
              members: {
                select: { capturedDisplayName: true },
                take: 10,
              },
            },
          },
        },
      },
    },
    orderBy: {
      createdAt: 'desc',
    },
  })

  const withCandidateNames = <T extends {
    status: string
    requiredApprover?: { name: string } | null
    candidateGroup?: { members: Array<{ capturedDisplayName: string }> } | null
  }>(approval: T) => {
    const { candidateGroup, ...rest } = approval
    if (approval.status !== 'pending' || approval.requiredApprover) {
      return rest
    }
    return {
      ...rest,
      potentialApprovers: (candidateGroup?.members ?? []).map((member) => ({ name: member.capturedDisplayName })),
    }
  }

  // Map requests to include proper approvals based on status
  // DesignCostEstimationApproval shows solution approvals, otherwise show request approvals
  const requestsWithApprovals = await Promise.all(requests.map(async (req) => {
    const useSolutionApprovals = req.status === 'DesignCostEstimationApproval' && req.solutions.length > 0

    // Map solution approvals to request approval format
    const solutionApprovals = useSolutionApprovals && req.solutions[0]?.approvals
      ? req.solutions[0].approvals.map(sa => ({
          id: sa.id,
          status: sa.status,
          approver: sa.approver ? { name: sa.approver.name } : null,
          requiredApprover: sa.requiredApprover ? { name: sa.requiredApprover.name } : null,
          requiredLevel: sa.order,
          order: sa.order,
          approvedAt: sa.approvedAt,
          isFinalApproval: false, // Solution approvals are not final approvals
          candidateGroup: sa.candidateGroup,
        }))
      : []

    const rawApprovals = useSolutionApprovals ? solutionApprovals : req.approvals
    const approvals = rawApprovals.map((approval) => ({
      ...withCandidateNames(approval),
      requiredLevel: approval.order,
    }))

    return {
      id: req.id,
      title: req.title,
      status: req.status,
      createdAt: req.createdAt,
      updatedAt: req.updatedAt,
      workRequisitionReceived: req.workRequisitionReceived,
      workRequisitionReceivedAt: req.workRequisitionReceivedAt,
      workRequisitionReceivedBy: req.workRequisitionReceivedBy,
      requesterId: req.requesterId,
      department: req.organizationUnit,
      requester: req.requester,
      _count: req._count,
      hasRejection: req.solutions.some(s =>
        s.approvals && Array.isArray(s.approvals) && s.approvals.some((a: any) => a.status === 'rejected')
      ) || req.approvals.some((a: any) => a.status === 'rejected') || req.activities.length > 0,
      engineerAssignments: req.engineerAssignments,
      approvals,
    }
  }))

  return requestsWithApprovals
}

/**
 * Get a single request by ID with all details
 */
export async function getRequest(id: string) {
  const { user: _authUser } = (await auth()) ?? {}; const userId = _authUser?.id

  if (!userId) {
    throw new Error('Unauthorized')
  }

  if (!(await canUserViewRequest(userId, id))) {
    return null
  }

  const request = await prisma.requests.findUnique({
    where: { id },
    include: {
      requester: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
      organizationUnit: {
        select: {
          name: true,
        },
      },
      workRequisitionReceivedBy: {
        select: {
          id: true,
          name: true,
        },
      },
      subTasks: {
        select: {
          id: true,
          description: true,
          customStageText: true,
          isCompleted: true,
          completedAt: true,
          createdAt: true,
          updatedAt: true,
          stage: {
            select: {
              id: true,
              name: true,
              isOthers: true,
              isActive: true,
            },
          },
          subContractor: {
            select: {
              id: true,
              name: true,
              isActive: true,
            },
          },
          createdBy: {
            select: { id: true, name: true },
          },
          updatedBy: {
            select: { id: true, name: true },
          },
          completedBy: {
            select: { id: true, name: true },
          },
        },
        orderBy: [
          { isCompleted: 'asc' },
          { updatedAt: 'desc' },
        ],
      },
      fileAttachments: {
        select: {
          id: true,
          fileName: true,
          fileType: true,
          fileSize: true,
          filePath: true,
          description: true,
          createdAt: true,
          uploadedBy: {
            select: {
              name: true,
            },
          },
        },
        orderBy: {
          createdAt: 'asc',
        },
      },
      activities: {
        select: {
          id: true,
          action: true,
          fromStatus: true,
          toStatus: true,
          comments: true,
          createdAt: true,
          user: {
            select: {
              name: true,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      },
      approvals: {
        select: {
          id: true,
          status: true,
          comments: true,
          isFinalApproval: true,
          ...APPROVAL_DISPLAY_SELECT,
          instanceId: true,
          instance: { select: { supersededAt: true } },
                    order: true,
          createdAt: true,
          approvedAt: true,
          approver: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          requiredApprover: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
        orderBy: {
          createdAt: 'asc',
        },
      },
      solutions: {
        select: {
          id: true,
          title: true,
          description: true,
          costEstimate: true,
          currency: true,
          timeline: true,
          submittedAt: true,
          createdAt: true,
          updatedAt: true,
          submittedBy: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          approvals: {
            select: {
              id: true,
              status: true,
              comments: true,
              ...APPROVAL_DISPLAY_SELECT,
              instanceId: true,
              instance: { select: { supersededAt: true } },
                            order: true,
              createdAt: true,
              approvedAt: true,
              approver: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                },
              },
              requiredApprover: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                },
              },
            },
            orderBy: {
              createdAt: 'asc',
            },
          },
          fileAttachments: {
            select: {
              id: true,
              fileName: true,
              fileType: true,
              fileSize: true,
              filePath: true,
              description: true,
              createdAt: true,
              uploadedBy: {
                select: {
                  name: true,
                },
              },
            },
            orderBy: {
              createdAt: 'asc',
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: 1,
      },
    },
  })

  // Lightweight all-solutions pending-solution-approval aggregate for
  // requester cancellation eligibility. getRequest only loads the newest
  // solution's payload (take: 1 above), but the authoritative cancelRequest
  // action counts pending solution approvals across ALL solutions of the
  // request, so the UI needs this same aggregate to avoid offering an
  // action the server would reject. One count query; no historical
  // solution payloads are loaded.
  if (request) {
    const pendingSolutionApprovals = await prisma.solution_approvals.count({
      where: { solution: { requestId: id }, status: 'pending', OR: [...CURRENT_INSTANCE_ROW_FILTER] },
    })
    ;(request as any).hasPendingSolutionApprovals = pendingSolutionApprovals > 0
  }

  // Convert Decimal to number for client components
  if (request?.projectEstimateCost !== null && request?.projectEstimateCost !== undefined) {
    request.projectEstimateCost = Number(request.projectEstimateCost) as any
  }

  if (request?.solutions?.[0]) {
    request.solutions[0].costEstimate = Number(request.solutions[0].costEstimate) as any
  }

  if (request) {
    // Candidate display comes only from the stored snapshot selected above.
    request.approvals = request.approvals.map(withApprovalDisplay)
    if (request.solutions?.[0]) {
      request.solutions[0].approvals = request.solutions[0].approvals.map(withApprovalDisplay)
    }
  }

  if (!request) return null

  return {
    ...request,
    department: request.organizationUnit ?? null,
  }
}

/**
 * Get filter options (organization units and requesters).
 * unitId values are organization_units.id so descendantUnitIds can consume them.
 */
export async function getRequestFilterOptions() {
  const currentUser = await getCurrentUser()

  if (!currentUser) {
    throw new Error('User not found')
  }

  const visibilityWhere = await buildRequestVisibilityWhere(createRequestVisibilityDb(prisma), {
    userId: currentUser.id,
    includeArchived: false,
  })

  const [departments, requesters] = await Promise.all([
    prisma.organization_units.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
      },
      orderBy: {
        name: 'asc',
      },
    }),
    prisma.user.findMany({
      where: { createdRequests: { some: visibilityWhere } },
      select: {
        id: true,
        name: true,
      },
      orderBy: {
        name: 'asc',
      },
    }),
  ])

  return { departments, requesters }
}

/**
 * Get requests that need the current user's action (pending approvals)
 */
export async function getMyActionItems() {
  const user = await getCurrentUser()

  if (!user) {
    return []
  }

  // Action eligibility stays on Task 9 discriminator predicates. Visibility is
  // not approval permission; returned rows are the actionable requests only.

  // Build OR conditions for request_approvals (discriminator-aware)
  const requestOrConditions: any[] = [
    // Custom chain / CUSTOM_PERSON approvals (always include)
    { requiredApproverId: user.id },
    snapshotGroupActionWhere(user.id),
  ]

  // Build OR conditions for solution_approvals (discriminator-aware)
  const solutionOrConditions: any[] = [
    { requiredApproverId: user.id },
    snapshotGroupActionWhere(user.id),
  ]

  // Find all pending approvals for user's level OR custom approver ID
  const pendingApprovals = await prisma.request_approvals.findMany({
    where: {
      OR: requestOrConditions,
      status: 'pending',
      // Superseded resubmission history is never actionable.
      AND: [{ OR: [...CURRENT_INSTANCE_ROW_FILTER] }],
      request: {
        isDeleted: false, // Exclude soft-deleted requests
        isArchived: false, // Archived requests are not actionable
      },
    },
    include: {
      request: {
        include: {
          organizationUnit: {
            select: {
              name: true,
            },
          },
          requester: {
            select: {
              id: true,
              name: true,
            },
          },
          _count: {
            select: {
              fileAttachments: true,
            },
          },
        },
      },
    },
    orderBy: {
      request: {
        createdAt: 'desc',
      },
    },
  })

  // Check if each approval is actually actionable (no pending approvals before it)
  const actionableRequests = []
  const seenRequestIds = new Set<string>()

  for (const approval of pendingApprovals) {
    // Check if there are any pending approvals with lower order
    const blockingApprovals = await prisma.request_approvals.count({
      where: {
        requestId: approval.requestId,
        order: { lt: approval.order },
        status: 'pending',
        OR: [...CURRENT_INSTANCE_ROW_FILTER],
      },
    })

    // Only include if no blocking approvals
    if (blockingApprovals === 0) {
      if (!seenRequestIds.has(approval.request.id)) {
        seenRequestIds.add(approval.request.id)
        actionableRequests.push({
          id: approval.request.id,
          title: approval.request.title,
          status: approval.request.status,
          createdAt: approval.request.createdAt,
          updatedAt: approval.request.updatedAt,
          requesterId: approval.request.requesterId,
          department: approval.request.organizationUnit,
          requester: approval.request.requester,
          _count: approval.request._count,
        })
      }
    }
  }

  // Query solution approvals
  const pendingSolutionApprovals = await prisma.solution_approvals.findMany({
    where: {
      OR: solutionOrConditions,
      status: 'pending',
      // Superseded resubmission history is never actionable.
      AND: [{ OR: [...CURRENT_INSTANCE_ROW_FILTER] }],
      solution: {
        request: {
          isDeleted: false,
          isArchived: false,
        },
      },
    },
    include: {
      solution: {
        include: {
          request: {
            include: {
              organizationUnit: {
                select: {
                  name: true,
                },
              },
              requester: {
                select: {
                  id: true,
                  name: true,
                },
              },
              _count: {
                select: {
                  fileAttachments: true,
                },
              },
            },
          },
        },
      },
    },
    orderBy: {
      solution: {
        request: {
          createdAt: 'desc',
        },
      },
    },
  })

  // Check actionability for solution approvals
  for (const approval of pendingSolutionApprovals) {
    // Check if there are any pending approvals with lower order
    const blockingSolutionApprovals = await prisma.solution_approvals.count({
      where: {
        solutionId: approval.solutionId,
        order: { lt: approval.order },
        status: 'pending',
        OR: [...CURRENT_INSTANCE_ROW_FILTER],
      },
    })

    // Only include if no blocking approvals
    if (blockingSolutionApprovals === 0) {
      const request = approval.solution.request

      // Deduplicate by request ID
      if (!seenRequestIds.has(request.id)) {
        seenRequestIds.add(request.id)
        actionableRequests.push({
          id: request.id,
          title: request.title,
          status: request.status,
          createdAt: request.createdAt,
          updatedAt: request.updatedAt,
          requesterId: request.requesterId,
          department: request.organizationUnit,
          requester: request.requester,
          _count: request._count,
        })
      }
    }
  }

  // Sort by createdAt desc
  actionableRequests.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())

  return actionableRequests
}

const cancelRequestSchema = z.object({
  requestId: z.string().min(1),
  reason: cancellationReasonSchema,
})

/**
 * Cancel a request.
 *
 * Policy (see `src/lib/cancellation-policy.ts`):
 * - Only the original requester can cancel.
 * - Allowed in SentToEngineer, SendBackToRequester, or a rejected
 *   ImprovementRequest awaiting requester resubmission.
 * - Blocked while any request approval (including final approval) or any
 *   solution approval is still pending.
 * - Approvals, solutions, files, engineer assignments, and subtasks are
 *   preserved for audit; only the request status changes to Cancelled.
 */
export async function cancelRequest(input: { requestId: string; reason: string }) {
  const { user: _authUser } = (await auth()) ?? {}; const userId = _authUser?.id
  if (!userId) {
    throw new Error('Unauthorized')
  }

  // Validate input
  const validatedFields = cancelRequestSchema.safeParse(input)
  if (!validatedFields.success) {
    return {
      success: false,
      errors: validatedFields.error.flatten().fieldErrors,
    }
  }

  const { requestId, reason } = validatedFields.data

  // Re-check ownership, status, and approval state inside one transaction.
  // The conditional update below re-verifies the status and, for a rejected
  // ImprovementRequest, its version/rejected state at write time (TOCTOU guard
  // under READ COMMITTED), so a concurrent transition or resubmission cannot
  // race past cancellation.
  await prisma.$transaction(async (tx) => {
    // Serialize cancel against concurrent approval advancement on the same
    // request. Prisma has no first-class FOR UPDATE on findUnique; the tagged
    // $queryRaw lock matches createPrismaApprovalTransactionDb.
    if (typeof tx.$queryRaw === 'function') {
      await tx.$queryRaw`SELECT id FROM requests WHERE id = ${requestId} FOR UPDATE`
    }
    const request = await tx.requests.findUnique({
      where: { id: requestId },
      select: { id: true, requesterId: true, status: true, updatedAt: true },
    })

    if (!request) {
      throw new Error('Request not found')
    }

    // Pending request approvals (any kind, including final approval rows)
    // and pending solution approvals of the request's solutions both block.
    const [
      pendingRequestApprovals,
      pendingSolutionApprovals,
      rejectedRequestApprovals,
    ] = await Promise.all([
      tx.request_approvals.count({
        where: { requestId, status: 'pending', OR: [...CURRENT_INSTANCE_ROW_FILTER] },
      }),
      tx.solution_approvals.count({
        where: { solution: { requestId }, status: 'pending', OR: [...CURRENT_INSTANCE_ROW_FILTER] },
      }),
      tx.request_approvals.count({
        // Rejection history authorizes cancellation only while it belongs to
        // the current attempt; superseded NEW rows are display history.
        where: { requestId, status: 'rejected', isFinalApproval: false, OR: [...CURRENT_INSTANCE_ROW_FILTER] },
      }),
    ])

    const decision = evaluateRequesterCancellation({
      userId,
      requesterId: request.requesterId,
      status: request.status,
      hasRejectedRequestApproval: rejectedRequestApprovals > 0,
      hasPendingRequestApprovals: pendingRequestApprovals > 0,
      hasPendingSolutionApprovals: pendingSolutionApprovals > 0,
    })
    const cancelAction = evaluateRequestAction('CANCEL_REQUEST', {
      actor: { id: userId, role: '', isActive: true, assignmentUnitId: null },
      request: { requesterId: request.requesterId, organizationUnitId: null, status: request.status },
      canView: true,
      approval: null,
      assignedEngineer: false,
      existingActionDecisions: {
        CANCEL_REQUEST: existingCancelRequestDecision({
          userId,
          requesterId: request.requesterId,
          status: request.status,
          hasRejectedRequestApproval: rejectedRequestApprovals > 0,
          hasPendingRequestApprovals: pendingRequestApprovals > 0,
          hasPendingSolutionApprovals: pendingSolutionApprovals > 0,
        }),
      },
    })

    if (!decision.canCancel) {
      throw new Error(getCancellationBlockedMessage(decision.reason, request.status))
    }
    if (!cancelAction.allowed) {
      throw new Error(getCancellationBlockedMessage('not-requester', request.status))
    }

    // Only flip the status while the expected state still matches. The
    // rejected-request path also compares updatedAt and the approval state,
    // coordinating its same-status resubmission with cancellation. A
    // concurrent workflow makes this match zero rows and throws, so this
    // transaction rolls back and cannot overwrite it.
    const rejectedImprovementRequestGuard =
      request.status === 'ImprovementRequest'
        ? buildRejectedRequestCancellationWhere(request.updatedAt)
        : undefined

    await updateRequestStatusExpecting(tx, {
      requestId,
      expectedStatuses: [request.status],
      additionalWhere: rejectedImprovementRequestGuard,
      data: { status: 'Cancelled' },
      actionLabel: 'cancel',
    })

    // Record the cancellation on the current NEW instances (REQUEST, and any
    // SOLUTION/FINAL attempts of the request's documents) so no further
    // action can target them. Only PENDING instances transition — a terminal
    // outcome is preserved — and cancellation adds no notification events.
    await markCurrentInstanceOutcome(tx, { requestId, phase: 'REQUEST', outcome: 'CANCELLED' })
    await markCurrentInstanceOutcome(tx, { requestId, phase: 'SOLUTION', outcome: 'CANCELLED' })
    await markCurrentInstanceOutcome(tx, { requestId, phase: 'FINAL', outcome: 'CANCELLED' })

    // Audit trail with the actual previous status. Approvals, solutions,
    // files, engineer assignments, and subtasks are intentionally preserved.
    await tx.request_activities.create({
      data: {
        requestId,
        userId,
        action: 'cancelled',
        fromStatus: request.status,
        toStatus: 'Cancelled',
        comments: reason,
      },
    })
  })

  revalidateRequestViews()

  return { success: true }
}

const deleteRequestSchema = z.object({
  requestId: z.string().min(1, 'Request ID is required'),
  reason: z.string().min(10, 'Reason must be at least 10 characters').max(500, 'Reason too long'),
})

/**
 * Delete a request (ADMIN ONLY)
 * - Marks request as deleted (soft delete)
 * - Cleans up file attachments from disk
 * - Preserves audit trail in activities
 * - Logs deletion action
 */
export async function deleteRequest(input: { requestId: string; reason: string }) {
  // Verify user is admin
  const adminUserId = await requireAdmin()
  if (!adminUserId) {
    return {
      success: false,
      error: 'Unauthorized - Admin access required',
    }
  }

  // Validate input
  const validatedFields = deleteRequestSchema.safeParse(input)
  if (!validatedFields.success) {
    return {
      success: false,
      errors: validatedFields.error.flatten().fieldErrors,
    }
  }

  const { requestId, reason } = validatedFields.data

  try {
    // Get request with file attachments before soft delete
    const request = await prisma.requests.findUnique({
      where: { id: requestId },
      include: {
        fileAttachments: true,
      },
    })

    if (!request) {
      return {
        success: false,
        error: 'Request not found',
      }
    }

    // Check if already deleted
    if (request.isDeleted) {
      return {
        success: false,
        error: 'Request is already deleted',
      }
    }

    // Perform soft delete and log activity in transaction
    await prisma.$transaction([
      // Soft delete the request
      prisma.requests.update({
        where: { id: requestId },
        data: {
          isDeleted: true,
          deletedAt: new Date(),
          deletedBy: adminUserId,
        },
      }),
      // Log deletion in audit trail
      prisma.request_activities.create({
        data: {
          requestId,
          action: 'deleted',
          fromStatus: request.status,
          toStatus: request.status,
          comments: `Request deleted by admin. Reason: ${reason}`,
          userId: adminUserId,
        },
      }),
    ])

    // Clean up files from disk (after transaction succeeds) via the private
    // storage layer so legacy public/ path joins are not reconstructed here.
    for (const attachment of request.fileAttachments) {
      try {
        await deleteAttachmentFile(attachment.filePath)
      } catch (error) {
        // Log warning but don't fail the operation
        console.warn(`Failed to delete attachment ${attachment.filePath}:`, error)
      }
    }

    revalidateRequestViews()
    revalidatePath('/admin')

    return {
      success: true,
      message: 'Request deleted successfully',
    }
  } catch (error) {
    console.error('Error deleting request:', error)
    return {
      success: false,
      error: 'Failed to delete request',
    }
  }
}

/**
 * Get deleted requests (ADMIN ONLY)
 * For audit/restore purposes
 */
export async function getDeletedRequests() {
  const adminUserId = await requireAdmin()
  if (!adminUserId) {
    throw new Error('Unauthorized - Admin access required')
  }

  const requests = await prisma.requests.findMany({
    where: { isDeleted: true },
    select: {
      id: true,
      title: true,
      status: true,
      createdAt: true,
      deletedAt: true,
      requester: {
        select: {
          name: true,
          email: true,
        },
      },
      organizationUnit: {
        select: {
          name: true,
        },
      },
      deletedByUser: {
        select: {
          name: true,
        },
      },
      activities: {
        where: { action: 'deleted' },
        take: 1,
        orderBy: { createdAt: 'desc' },
      },
    },
    orderBy: {
      deletedAt: 'desc',
    },
  })

  return requests
}

/**
 * Permanently delete requests (ADMIN ONLY)
 * - Hard delete from database
 * - Cannot be undone
 * - Used for cleanup of old deleted requests
 */
export async function permanentlyDeleteRequests(input: {
  mode: 'single' | 'older_than_1_year' | 'all' | 'date_range'
  requestId?: string
  dateFrom?: string
  dateTo?: string
}) {
  const adminUserId = await requireAdmin()
  if (!adminUserId) {
    return {
      success: false,
      error: 'Unauthorized - Admin access required',
    }
  }

  try {
    let whereClause: any = { isDeleted: true }

    // Apply filters based on mode
    if (input.mode === 'single' && input.requestId) {
      whereClause.id = input.requestId
    } else if (input.mode === 'older_than_1_year') {
      const oneYearAgo = new Date()
      oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)
      whereClause.deletedAt = { lt: oneYearAgo }
    } else if (input.mode === 'date_range' && input.dateFrom && input.dateTo) {
      whereClause.deletedAt = {
        gte: new Date(input.dateFrom),
        lte: new Date(input.dateTo),
      }
    }
    // 'all' mode uses the base isDeleted: true filter

    // Count requests to be deleted
    const count = await prisma.requests.count({ where: whereClause })

    if (count === 0) {
      return {
        success: false,
        error: 'No requests found matching the criteria',
      }
    }

    // Permanent delete (will cascade to fileAttachments, activities, approvals, notifications)
    try {
      // First, get request info for audit logging
      const requestInfo = input.mode === 'single' && input.requestId 
        ? await prisma.requests.findUnique({
            where: { id: input.requestId },
            select: { title: true, requesterId: true }
          })
        : null

      // Use transaction to ensure bypass flag and delete happen in same session
      const result = await prisma.$transaction(async (tx) => {
        // Enable audit bypass for admin hard delete
        await tx.$executeRaw`SET LOCAL app.bypass_audit = 'true'`
        
        // Log the permanent delete action before deleting (this will be deleted too, but we try)
        if (input.mode === 'single' && input.requestId && requestInfo) {
          try {
            await tx.request_activities.create({
              data: {
                requestId: input.requestId,
                userId: adminUserId,
                action: 'permanently_deleted',
                comments: `Request permanently deleted by admin. Title: "${requestInfo.title}"`,
                createdAt: new Date(),
              },
            })
          } catch {
            // Ignore if logging fails - we're about to delete everything anyway
          }
        }
        
        const deleteResult = await tx.requests.deleteMany({
          where: whereClause,
        })
        
        return deleteResult
      })

      // Log admin action separately (outside the transaction that deletes everything)
      await prisma.request_activities.create({
        data: {
          action: 'admin_permanent_delete',
          comments: `Admin permanently deleted ${result.count} request(s). Mode: ${input.mode}${input.requestId ? `, RequestId: ${input.requestId}` : ''}`,
          userId: adminUserId,
          createdAt: new Date(),
        },
      })

      revalidateRequestViews()

      return {
        success: true,
        message: `Permanently deleted ${result.count} requests`,
        count: result.count,
      }
    } catch (deleteError: any) {
      console.error('[permanentlyDeleteRequests] Delete error:', deleteError)
      // Check if this is the audit trail protection error (should not happen with bypass)
      if (deleteError.message?.includes('Cannot modify audit trail') || 
          deleteError.message?.includes('append-only')) {
        return {
          success: false,
          error: 'Permanent delete blocked by audit trail. Migration may not be applied correctly.',
        }
      }
      throw deleteError
    }
  } catch (error) {
    console.error('Error permanently deleting requests:', error)
    return {
      success: false,
      error: 'Failed to permanently delete requests',
    }
  }
}

/**
 * Restore a deleted request (ADMIN ONLY)
 * - Removes soft delete flags
 * - Request becomes visible again
 */
export async function restoreRequest(input: { requestId: string }) {
  const adminUserId = await requireAdmin()
  if (!adminUserId) {
    return {
      success: false,
      error: 'Unauthorized - Admin access required',
    }
  }

  try {
    // Check if request exists and is deleted
    const request = await prisma.requests.findUnique({
      where: { id: input.requestId },
    })

    if (!request) {
      return {
        success: false,
        error: 'Request not found',
      }
    }

    if (!request.isDeleted) {
      return {
        success: false,
        error: 'Request is not deleted',
      }
    }

    // Restore the request
    await prisma.requests.update({
      where: { id: input.requestId },
      data: {
        isDeleted: false,
        deletedAt: null,
        deletedBy: null,
      },
    })

    // Log restoration
    await prisma.request_activities.create({
      data: {
        requestId: input.requestId,
        action: 'restored',
        comments: `Request restored by admin`,
        userId: adminUserId,
      },
    })

    revalidateRequestViews()

    return {
      success: true,
      message: 'Request restored successfully',
    }
  } catch (error) {
    console.error('Error restoring request:', error)
    return {
      success: false,
      error: 'Failed to restore request',
    }
  }
}

/**
 * Preview count of requests that would be deleted by date range
 * For admin confirmation before bulk delete
 */
export async function previewDeleteByDateRange(input: {
  dateFrom: string
  dateTo: string
}) {
  const adminUserId = await requireAdmin()
  if (!adminUserId) {
    return {
      success: false,
      error: 'Unauthorized - Admin access required',
    }
  }

  try {
    const fromDate = new Date(input.dateFrom)
    const toDate = new Date(input.dateTo)
    // Include entire end date by setting to end of day
    toDate.setHours(23, 59, 59, 999)

    const requests = await prisma.requests.findMany({
      where: {
        isDeleted: true,
        deletedAt: {
          gte: fromDate,
          lte: toDate,
        },
      },
      select: {
        id: true,
        title: true,
        deletedAt: true,
        requester: {
          select: {
            name: true,
            email: true,
          },
        },
      },
      orderBy: {
        deletedAt: 'desc',
      },
    })

    return {
      success: true,
      count: requests.length,
      requests,
    }
  } catch (error) {
    console.error('Error previewing delete:', error)
    return {
      success: false,
      error: 'Failed to preview requests',
    }
  }
}

/**
 * Bulk archive requests by creation date range (ADMIN ONLY)
 * - Preview mode: shows count and list of requests that would be archived
 * - Delete mode: archives all matching requests (reversible on /admin/retention)
 */
export async function bulkDeleteRequestsByDateRange(input: {
  mode: 'preview' | 'delete'
  dateFrom: string
  dateTo: string
}) {
  const adminUserId = await requireAdmin()
  if (!adminUserId) {
    return {
      success: false,
      error: 'Unauthorized - Admin access required',
    }
  }

  try {
    const fromDate = new Date(input.dateFrom)
    const toDate = new Date(input.dateTo)
    // Include entire end date by setting to end of day
    toDate.setHours(23, 59, 59, 999)

    // Find requests created within date range (excluding already deleted/archived ones)
    const requests = await prisma.requests.findMany({
      where: {
        isDeleted: false,
        isArchived: false,
        createdAt: {
          gte: fromDate,
          lte: toDate,
        },
      },
      select: {
        id: true,
        title: true,
        status: true,
        createdAt: true,
        requester: {
          select: {
            name: true,
            email: true,
          },
        },
        organizationUnit: {
          select: {
            name: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    })

    if (input.mode === 'preview') {
      return {
        success: true,
        count: requests.length,
        requests,
      }
    }

    // Archive mode - per-row guarded updates inside one transaction. Each
    // updateMany re-checks isArchived under READ COMMITTED, so rows archived by
    // a concurrent worker between our read and write are skipped here AND
    // excluded from the audit log (no false attribution).
    const result = await prisma.$transaction(async (tx) => {
      const updatedIds: string[] = []
      for (const r of requests) {
        const updated = await tx.requests.updateMany({
          where: {
            id: r.id,
            isDeleted: false,
            isArchived: false,
          },
          data: {
            isArchived: true,
          },
        })
        if (updated.count === 1) {
          updatedIds.push(r.id)
        }
      }

      if (updatedIds.length > 0) {
        const candidates = new Map(requests.map(r => [r.id, r]))
        await tx.request_activities.createMany({
          data: updatedIds.map(id => {
            const r = candidates.get(id)!
            return {
              requestId: id,
              action: 'archived',
              fromStatus: r.status,
              toStatus: r.status,
              comments: `Bulk archived by admin. Created: ${new Date(r.createdAt).toLocaleString()}`,
              userId: adminUserId,
            }
          }),
        })
      }

      return { count: updatedIds.length }
    })

    revalidateRequestViews()

    return {
      success: true,
      count: result.count,
      message: `Archived ${result.count} requests`,
    }
  } catch (error) {
    console.error('Error bulk archiving requests:', error)
    return {
      success: false,
      error: 'Failed to bulk archive requests',
    }
  }
}

// ============================================================================
// PHASE 4: Engineering Dashboard Functions
// ============================================================================

export interface NeedsActionResult {
  needsSolution: Array<{
    request: any
    assignedEngineers: any[]
  }>
  needsApproval: Array<{
    request: any
    solution: any
    approval: any
  }>
}

/**
 * Get requests that need the current engineering user's action
 * Returns two categories:
 * 1. Requests needing solution submission (SentToEngineer status)
 * 2. Solutions needing user's approval (DesignCostEstimationApproval status)
 */
export async function getRequestsNeedingEngineeringAction(userId: string): Promise<NeedsActionResult> {
  const user = await getUserById(userId)

  if (!user || user.role !== 'engineering') {
    return { needsSolution: [], needsApproval: [] }
  }

  const visibilityWhere = await buildRequestVisibilityWhere(createRequestVisibilityDb(prisma), {
    userId,
    includeArchived: false,
  })

  // Category 1: Requests needing solution submission
  // Status = SentToEngineer, no solution submitted yet
  const needsSolution = await prisma.requests.findMany({
    where: {
      AND: [visibilityWhere, { status: 'SentToEngineer' }],
    },
    include: {
      organizationUnit: {
        select: {
          id: true,
          name: true,
        },
      },
      requester: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
      engineerAssignments: {
        include: {
          engineer: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      },
    },
    orderBy: {
      createdAt: 'asc',
    },
  })

  // Check which requests have solutions (for rejection detection)
  // A request in SentToEngineer with a solution means the solution was rejected
  const requestIdsWithSolution = (
    await prisma.solutions.findMany({
      where: {
        requestId: { in: needsSolution.map(r => r.id) },
      },
      select: { requestId: true },
    })
  ).map(s => s.requestId)

  // Include ALL SentToEngineer requests (both fresh and rejected)
  // Requests with solutions are the rejected ones needing resubmission
  const needsSolutionFiltered = needsSolution
    .map(request => ({
      request: {
        id: request.id,
        title: request.title,
        status: request.status,
        createdAt: request.createdAt,
        department: request.organizationUnit,
        requester: request.requester,
        hasRejection: requestIdsWithSolution.includes(request.id),
      },
      assignedEngineers: request.engineerAssignments.map(ea => ea.engineer),
    }))

  // Category 2: Solutions needing user's approval
  // For custom chains: requiredApproverId === userId AND status === pending AND all previous orders approved
  // For snapshot groups: current-instance candidate membership AND status === pending AND all previous orders approved
  const needsApproval = await prisma.solutions.findMany({
    where: {
      request: {
        AND: [visibilityWhere, { status: 'DesignCostEstimationApproval' }],
      },
    },
    include: {
      request: {
        select: {
          id: true,
          title: true,
          status: true,
          createdAt: true,
        },
      },
      submittedBy: {
        select: {
          name: true,
        },
      },
    },
  })

  // Filter approvals that need this user's action
  const needsApprovalFiltered = []

  for (const solution of needsApproval) {
    // Get pending approvals for this solution
    const pendingApprovals = await prisma.solution_approvals.findMany({
      where: {
        solutionId: solution.id,
        status: 'pending',
        OR: [...CURRENT_INSTANCE_ROW_FILTER],
      },
      orderBy: {
        order: 'asc',
      },
    })

    // Find the next actionable approval (first in sequence with no pending before it)
    for (const approval of pendingApprovals) {
      // Check if there are any pending approvals before this one
      const blockingApprovals = await prisma.solution_approvals.count({
        where: {
          solutionId: solution.id,
          order: { lt: approval.order },
          status: 'pending',
          OR: [...CURRENT_INSTANCE_ROW_FILTER],
        },
      })

      if (blockingApprovals === 0) {
        // This is the next actionable approval. SNAPSHOT_GROUP uses persisted
        // candidate membership, never a live requiredLevel match.
        const snapshotGroupId = approval.routingMode === 'SNAPSHOT_GROUP' ? approval.candidateGroupId : null
        const isSnapshotMember =
          snapshotGroupId !== null &&
          Boolean(
            await prisma.approval_candidate_group_members.findFirst({
              where: { candidateGroupId: snapshotGroupId, userId },
              select: { userId: true },
            }),
          )
        const isForUser =
          Boolean(isSnapshotMember) ||
          (approval.requiredApproverId === userId)

        if (isForUser) {
          needsApprovalFiltered.push({
            request: solution.request,
            solution: {
              id: solution.id,
              costEstimate: Number(solution.costEstimate),
              currency: solution.currency,
              submittedAt: solution.submittedAt,
              submittedBy: solution.submittedBy,
            },
            approval: {
              id: approval.id,
              status: approval.status,
              order: approval.order,
              requiredLevel: approval.order,
              requiredApproverId: approval.requiredApproverId,
              isCustomChain: approval.routingMode === 'CUSTOM_PERSON',
            },
          })
          break // Only add one approval per solution
        }
      }
    }
  }

  return {
    needsSolution: needsSolutionFiltered,
    needsApproval: needsApprovalFiltered,
  }
}

/**
 * Assign engineers to a request
 * Validates caller is engineering user and request is in SentToEngineer status
 */
export async function assignEngineers(requestId: string, engineerIds: string[]) {
  const user = await getCurrentUser()

  if (!user || user.role !== 'engineering') {
    throw new Error('Only engineering users can assign engineers')
  }

  // Validate request exists and is in correct status
  const request = await prisma.requests.findUnique({
    where: { id: requestId },
    select: { status: true, title: true, requesterId: true, organizationUnitId: true },
  })

  if (!request) {
    throw new Error('Request not found')
  }

  const assignAction = evaluateRequestAction('ASSIGN_ENGINEERS', {
    actor: {
      id: user.id,
      role: user.role,
      isActive: user.isActive !== false,
      assignmentUnitId: null,
    },
    request: {
      requesterId: request.requesterId,
      organizationUnitId: request.organizationUnitId,
      status: request.status,
    },
    canView: true,
    approval: null,
    assignedEngineer: false,
    existingActionDecisions: {
      ASSIGN_ENGINEERS: existingAssignEngineersDecision({
        userRole: user.role,
        status: request.status,
      }),
    },
  })
  if (!assignAction.allowed) {
    if (assignAction.reason === 'WRONG_ROLE') {
      throw new Error('Only engineering users can assign engineers')
    }
    throw new Error('Can only assign engineers to requests in SentToEngineer status')
  }

  if (request.status !== 'SentToEngineer') {
    throw new Error('Can only assign engineers to requests in SentToEngineer status')
  }

  const engineers = await prisma.user.findMany({
    where: {
      id: { in: engineerIds },
      role: 'engineering',
      isActive: true,
    },
    select: { id: true },
  })

  if (engineers.length !== engineerIds.length) {
    throw new Error('One or more engineers not found or not in the engineering role')
  }

  // Delete existing assignments
  await prisma.request_engineer_assignments.deleteMany({
    where: { requestId },
  })

  // Create new assignments
  if (engineerIds.length > 0) {
    await prisma.request_engineer_assignments.createMany({
      data: engineerIds.map(engineerId => ({
        requestId,
        engineerId,
        assignedById: user.id,
      })),
    })
  }

  // Log activity
  await prisma.request_activities.create({
    data: {
      requestId,
      userId: user.id,
      action: 'engineers_assigned',
      comments: `${engineerIds.length} engineer(s) assigned to request`,
    },
  })

  if (engineerIds.length > 0 && request) {
    const { createNotification } = await import('./notifications')
    const recipients = mapEventRecipients({
      type: 'request_assigned',
      requesterId: request.requesterId,
      assignedEngineerIds: engineerIds,
    })
    await Promise.all(
      recipients.map((userId) =>
        createNotification({
          userId,
          type: 'request_assigned',
          title: 'PIC Assignment',
          message: `👤 PIC Assignment: You have been assigned to "${request.title}". Please review and submit your solution.`,
          requestId,
        }),
      ),
    )
  }

  revalidateRequestViews()

  return { success: true }
}

/**
 * Get all engineering users
 * Used for Person in Charge selector
 */
export async function getEngineeringUsers() {
  const currentUser = await getCurrentUser()
  if (!currentUser) {
    throw new Error('Unauthorized')
  }

  const users = await prisma.user.findMany({
    where: {
      role: 'engineering',
      isActive: true,
    },
    select: {
      id: true,
      name: true,
      email: true,
    },
    orderBy: [
      { name: 'asc' },
    ],
  })

  return users
}

export interface GetRequestsForEngineeringFilters {
  unitId?: string
  assignedEngineerId?: string
  status?: string
  dateFrom?: string
  dateTo?: string
  search?: string
}

/**
 * Get requests for engineering view
 * Base query: status IN (SentToEngineer, DesignCostEstimationApproval)
 */
export async function getRequestsForEngineering(filters?: GetRequestsForEngineeringFilters) {
  const user = await getCurrentUser()

  if (!user || user.role !== 'engineering') {
    throw new Error('Only engineering users can access engineering requests')
  }

  const visibilityWhere = await buildRequestVisibilityWhere(createRequestVisibilityDb(prisma), {
    userId: user.id,
    includeArchived: false,
  })
  const engineeringFilters: Prisma.requestsWhereInput = {
    status: {
      in: ['SentToEngineer', 'DesignCostEstimationApproval'],
    },
  }

  if (filters) {
    if (filters.unitId) {
      const units = await loadOrganizationUnitNodes()
      engineeringFilters.organizationUnitId = {
        in: descendantUnitIds(units, filters.unitId),
      }
    }
    if (filters.assignedEngineerId) {
      engineeringFilters.engineerAssignments = {
        some: {
          engineerId: filters.assignedEngineerId,
        },
      }
    }
    if (filters.status) {
      engineeringFilters.status = filters.status as never
    }
    if (filters.dateFrom || filters.dateTo) {
      const createdAt: Prisma.DateTimeFilter = {}
      if (filters.dateFrom) {
        createdAt.gte = new Date(filters.dateFrom)
      }
      if (filters.dateTo) {
        const endDate = new Date(filters.dateTo)
        endDate.setHours(23, 59, 59, 999)
        createdAt.lte = endDate
      }
      engineeringFilters.createdAt = createdAt
    }
    if (filters.search) {
      engineeringFilters.OR = [
        { title: { contains: filters.search, mode: 'insensitive' } },
        { description: { contains: filters.search, mode: 'insensitive' } },
        { id: { contains: filters.search, mode: 'insensitive' } },
        { requester: { name: { contains: filters.search, mode: 'insensitive' } } },
      ]
    }
  }

  const requests = await prisma.requests.findMany({
    where: { AND: [visibilityWhere, engineeringFilters] },
    include: {
      organizationUnit: {
        select: {
          name: true,
        },
      },
      requester: {
        select: {
          id: true,
          name: true,
        },
      },
      engineerAssignments: {
        include: {
          engineer: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
      solutions: {
        take: 1,
        orderBy: {
          createdAt: 'desc',
        },
        select: {
          id: true,
          title: true,
          costEstimate: true,
          currency: true,
          submittedAt: true,
        },
      },
    },
    orderBy: {
      createdAt: 'desc',
    },
  })

  return requests
}

/**
 * Resubmit a rejected request
 * - Validates that request has rejections and requester owns it
 * - Optionally updates title and description
 * - Deletes all existing approvals (rejected and approved)
 * - Creates fresh approval chain
 * - Resets status to ImprovementRequest
 * - Logs activity
 */
export async function resubmitRequest(input: {
  requestId: string
  title?: string
  description?: string
  inlineImageSessionId?: string
}) {
  const { user: _authUser } = (await auth()) ?? {}; const userId = _authUser?.id

  if (!userId) {
    throw new Error('Unauthorized')
  }

  // Get request with approvals. Rejection history counts only while it
  // belongs to the current attempt: superseded NEW rows are display history,
  // never resubmission authorization (I3).
  const request = await prisma.requests.findUnique({
    where: { id: input.requestId },
    include: {
      approvals: {
        where: { OR: [...CURRENT_INSTANCE_ROW_FILTER] },
      },
      requester: true,
    },
  })

  if (!request) {
    throw new Error('Request not found')
  }

  // Verify requester ownership
  if (request.requesterId !== userId) {
    throw new Error('Only the requester can resubmit this request')
  }

  // Verify request has rejections
  const hasRejection = request.approvals.some(
    (approval) => approval.status === 'rejected' && !approval.isFinalApproval,
  )
  if (!hasRejection) {
    throw new Error('Request does not have any rejections')
  }

  // Verify status allows resubmit (ImprovementRequest means department approval phase)
  if (request.status !== 'ImprovementRequest') {
    throw new Error(
      'Request can only be resubmitted during department approval phase'
    )
  }

  const resubmitAction = evaluateRequestAction('RESUBMIT_REQUEST', {
    actor: { id: userId, role: '', isActive: true, assignmentUnitId: null },
    request: {
      requesterId: request.requesterId,
      organizationUnitId: request.organizationUnitId,
      status: request.status,
    },
    canView: true,
    approval: null,
    assignedEngineer: false,
    existingActionDecisions: {
      RESUBMIT_REQUEST: existingResubmitRequestDecision({
        actorId: userId,
        requesterId: request.requesterId,
        status: request.status,
        hasRejection,
      }),
    },
  })
  if (!resubmitAction.allowed) {
    if (resubmitAction.reason === 'NOT_OWNER') {
      throw new Error('Only the requester can resubmit this request')
    }
    throw new Error('Request can only be resubmitted during department approval phase')
  }

  // Validate optional updates
  if (input.title !== undefined) {
    const titleValidation = z
      .string()
      .min(1, 'Title is required')
      .max(200, 'Title too long')
      .safeParse(input.title)
    if (!titleValidation.success) {
      throw new Error(titleValidation.error.issues[0].message)
    }
  }

  let prepared: { html: string; imageIds: string[] } | undefined
  if (input.description !== undefined) {
    const descValidation = descriptionSchema.safeParse(input.description)
    if (!descValidation.success) {
      throw new Error(descValidation.error.issues[0].message)
    }

    const sessionValidation = z.string().uuid().safeParse(input.inlineImageSessionId)
    if (!sessionValidation.success) {
      throw new Error('A valid inline image session id is required when updating the description')
    }

    prepared = await prepareInlineDescription({
      description: input.description,
      userId,
      uploadSessionId: sessionValidation.data,
    })
  } else if (input.inlineImageSessionId !== undefined) {
    throw new Error('An inline image session id is only allowed when updating the description')
  }

  // Perform resubmit in transaction. NEW resubmission transactions run under
  // the engine's SERIALIZABLE isolation; serialization failures (including
  // commit-time ones) translate to ApprovalEngineConflictError at this
  // boundary. Legacy/shadow keep default isolation and error behavior.
  const result = await prisma.$transaction(
    async (tx) => {
    // The same-status guarded update locks the request row and requires the
    // rejected approval to still exist. If cancellation committed first, the
    // status no longer matches; if resubmission removed the rejection first,
    // a racing cancellation's rejected-state predicate no longer matches.
    const updateData: Prisma.requestsUpdateManyMutationInput = {
      // Always advance the compare-and-set token, even in the unlikely case
      // the prior write and this resubmission occur in the same millisecond.
      updatedAt: new Date(Math.max(Date.now(), request.updatedAt.getTime() + 1)),
    }
    if (input.title !== undefined) updateData.title = input.title
    if (prepared) updateData.description = prepared.html

    await updateRequestStatusExpecting(tx, {
      requestId: input.requestId,
      expectedStatuses: ['ImprovementRequest'],
      additionalWhere: buildRejectedRequestResubmissionWhere(request.updatedAt),
      data: updateData,
      actionLabel: 'resubmit request',
    })

    if (prepared) {
      await reconcileInlineDescriptionImages(tx, {
        owner: { kind: 'request', id: input.requestId },
        imageIds: prepared.imageIds,
      })
    }

    const attempt = await createRequestApprovalAttempt(
      createCleanStartPhaseAttemptTx(tx as unknown as CleanStartAttemptStore),
      { requestId: input.requestId, phase: 'REQUEST', originUserId: userId },
    )
    if (attempt.statusChange) {
      await updateRequestStatusExpecting(tx, {
        requestId: input.requestId,
        expectedStatuses: ['ImprovementRequest'],
        data: { status: attempt.statusChange.to },
        actionLabel: 'resubmit request',
      })
      await tx.request_activities.create({
        data: {
          requestId: input.requestId,
          userId,
          action: 'status_changed',
          fromStatus: attempt.statusChange.from,
          toStatus: attempt.statusChange.to,
          comments: attempt.completedWithoutSteps
            ? 'Auto-completed: NO_ELIGIBLE_APPROVAL_STEPS (no eligible approval steps)'
            : 'Auto-approved by position ceiling',
        },
      })
    }

    // Log resubmit activity
    await tx.request_activities.create({
      data: {
        requestId: input.requestId,
        action: 'resubmitted',
        toStatus: 'ImprovementRequest',
        comments: 'Request resubmitted after rejection',
        userId,
      },
    })

    return tx.requests.findUniqueOrThrow({
      where: { id: input.requestId },
    })
    },
    { isolationLevel: APPROVAL_ENGINE_TRANSACTION_ISOLATION },
  )
  .catch((error: unknown) => {
    if (error instanceof ApprovalEngineConflictError) throw error
    const code = (error as { code?: unknown })?.code
    if (code === 'P2034' || code === '40001') {
      throw new ApprovalEngineConflictError()
    }
    throw error
  })

  revalidateRequestViews()

  return { success: true, request: result }
}

// ---------------------------------------------------------------------------
// Retention management (ADMIN ONLY)
// ---------------------------------------------------------------------------

/**
 * Archive a single request (ADMIN ONLY)
 * Marks request as archived so it is hidden from default listings.
 */
export async function archiveRequest(requestId: string) {
  const adminUserId = await requireAdmin()
  if (!adminUserId) {
    return {
      success: false,
      error: 'Unauthorized - Admin access required',
    }
  }

  try {
    const request = await prisma.requests.findUnique({
      where: { id: requestId },
      select: { id: true, isArchived: true, isDeleted: true },
    })

    if (!request) {
      return { success: false, error: 'Request not found' }
    }

    if (request.isDeleted) {
      return { success: false, error: 'Cannot archive a deleted request' }
    }

    if (request.isArchived) {
      return { success: false, error: 'Request is already archived' }
    }

    await prisma.$transaction([
      prisma.requests.update({
        where: { id: requestId },
        data: { isArchived: true },
      }),
      prisma.request_activities.create({
        data: {
          requestId,
          action: 'archived',
          comments: 'Request archived by admin',
          userId: adminUserId,
        },
      }),
    ])

    revalidateRequestViews()

    return { success: true }
  } catch (error) {
    console.error('Error archiving request:', error)
    return { success: false, error: 'Failed to archive request' }
  }
}

export async function unarchiveRequest(requestId: string) {
  const adminUserId = await requireAdmin()
  if (!adminUserId) {
    return {
      success: false,
      error: 'Unauthorized - Admin access required',
    }
  }

  try {
    const request = await prisma.requests.findUnique({
      where: { id: requestId },
      select: { id: true, isArchived: true, isDeleted: true },
    })

    if (!request) {
      return { success: false, error: 'Request not found' }
    }

    if (request.isDeleted) {
      return { success: false, error: 'Cannot unarchive a deleted request' }
    }

    if (!request.isArchived) {
      return { success: false, error: 'Request is not archived' }
    }

    await prisma.$transaction([
      prisma.requests.update({
        where: { id: requestId },
        data: { isArchived: false },
      }),
      prisma.request_activities.create({
        data: {
          requestId,
          action: 'unarchived',
          comments: 'Request unarchived by admin',
          userId: adminUserId,
        },
      }),
    ])

    revalidateRequestViews()

    return { success: true }
  } catch (error) {
    console.error('Error unarchiving request:', error)
    return { success: false, error: 'Failed to unarchive request' }
  }
}

/**
 * Permanently hard-delete a single request (ADMIN ONLY)
 * Cannot be undone. Removes all associated data.
 */
export async function permanentDeleteRequest(requestId: string) {
  const adminUserId = await requireAdmin()
  if (!adminUserId) {
    return {
      success: false,
      error: 'Unauthorized - Admin access required',
    }
  }

  try {
    const request = await prisma.requests.findUnique({
      where: { id: requestId },
      select: { id: true },
    })

    if (!request) {
      return { success: false, error: 'Request not found' }
    }

    // Soft delete — hard delete is blocked by the append-only audit trail trigger on request_activities
    await prisma.requests.update({
      where: { id: requestId },
      data: {
        isDeleted: true,
        deletedAt: new Date(),
        deletedBy: adminUserId,
      },
    })

    revalidateRequestViews()

    return { success: true }
  } catch (error) {
    console.error('Error permanently deleting request:', error)
    return { success: false, error: 'Failed to delete request' }
  }
}

/**
 * Get all requests for the retention management page (ADMIN ONLY)
 * Includes archived requests. Can be filtered.
 */
export async function getAllRequestsForRetention(includeArchived: boolean = true) {
  const adminUserId = await requireAdmin()
  if (!adminUserId) {
    throw new Error('Unauthorized - Admin access required')
  }

  const whereClause: any = { isDeleted: false }
  if (!includeArchived) {
    whereClause.isArchived = false
  }

  const requests = await prisma.requests.findMany({
    where: whereClause,
    select: {
      id: true,
      title: true,
      status: true,
      isArchived: true,
      createdAt: true,
      updatedAt: true,
      requester: {
        select: { name: true, email: true },
      },
      organizationUnit: {
        select: { name: true },
      },
    },
    orderBy: { updatedAt: 'desc' },
  })

  return requests
}

/**
 * Export the visible requests worklist to an XLSX workbook.
 * Uses getMyRequests so visibility rules (admin / engineering / department
 * + approval-chain membership) match what the user sees on /requests.
 */
export async function exportRequestsXlsx(filters?: GetRequestsFilters) {
  const requests = await getMyRequests(filters)
  const rows = buildRequestExportRows(requests)

  const worksheet = XLSX.utils.json_to_sheet(rows)
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Requests')
  const buffer = XLSX.write(workbook, {
    type: 'buffer',
    bookType: 'xlsx',
  }) as Buffer

  return {
    fileName: `requests-${new Date().toISOString().slice(0, 10)}.xlsx`,
    base64: buffer.toString('base64'),
  }
}
