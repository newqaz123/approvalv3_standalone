'use server'

import type { MessageKey } from '@/lib/i18n/messages'
import { notificationDisplayFields } from '@/lib/notification-display'
import { auth } from '@/lib/auth-config'
import prisma from '@/lib/prisma'
import { RequestStatus, type Prisma } from '@prisma/client'
import { submitSolutionSchema, SubmitSolutionInput, resubmitSolutionSchema, ResubmitSolutionInput } from '@/lib/schemas/solution-schemas'
import {
  attachmentFileExists,
  deleteAttachmentFile,
  isSolutionDraftReadyPath,
} from '@/lib/attachments/storage'
import {
  prepareInlineDescription,
  reconcileInlineDescriptionImages,
} from '@/lib/inline-images/references'
import { revalidateRequestViews } from './request-view-invalidation'
import { RequestStatusConflictError, updateRequestStatusExpecting } from '@/lib/request-status-transition'
import {
  advanceApprovalAtomically,
  canUserApproveFinal as engineCanUserApproveFinal,
  canUserApproveSolution as engineCanUserApproveSolution,
  createPrismaApprovalTransactionDb,
} from '@/lib/approval-engine/transaction-adapter'
import {
  runTransactionWithPostCommitNotifications,
  type PostCommitNotificationCollector,
  type NotificationPayload,
  type UserNotification,
} from '@/lib/post-commit-notifications'
import {
  createPrismaNotificationRecipientDb,
  mapEngineeringRejectionRecipients,
  mapEventRecipients,
  resolveApprovalNeededRecipients,
} from '@/lib/notification-recipients'
import {
  APPROVAL_ENGINE_TRANSACTION_ISOLATION,
  ApprovalEngineConflictError,
} from '@/lib/approval-engine/plan'
import {
  createCleanStartPhaseAttemptTx,
  createCustomPersonAttempt,
  createFinalApprovalAttempt,
  createSolutionApprovalAttempt,
  markCurrentInstanceOutcome,
  type CleanStartAttemptStore,
} from '@/lib/approval-engine/attempts'
import { canWorkOnSolutions } from '@/lib/solution-eligibility'
import type { OrganizationUnitNode } from '@/lib/organization/model'
import { CURRENT_INSTANCE_ROW_FILTER } from '@/lib/approval-engine/current-instance'
import {
  evaluateRequestAction,
  existingApprovalDecision,
  existingInitiateFinalApprovalDecision,
  existingResubmitSolutionDecision,
  existingSubmitSolutionDecision,
} from '@/lib/action-permissions'

type SubmitSolutionActionInput = Omit<SubmitSolutionInput, 'inlineImageSessionId'> & {
  inlineImageSessionId?: string
}

type ResubmitSolutionActionInput = Omit<ResubmitSolutionInput, 'inlineImageSessionId'> & {
  inlineImageSessionId?: string
}

async function loadActiveAssignment(userId: string, unitId?: string) {
  return prisma.organization_assignments.findFirst({
    where: unitId
      ? { userId, unitId, isActive: true }
      : { userId, isActive: true },
    select: { id: true, unitId: true },
  })
}

async function loadOrganizationUnitNodes(): Promise<OrganizationUnitNode[]> {
  const rows = await prisma.organization_units.findMany({
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
  return rows
}

function translateAttemptConflict(error: unknown): never {
  if (error instanceof ApprovalEngineConflictError) throw error
  const code = (error as { code?: unknown })?.code
  if (code === 'P2034' || code === '40001') throw new ApprovalEngineConflictError()
  throw error
}

/**
 * Check if data is stale based on updatedAt timestamp
 * Uses 1-second tolerance to account for database precision
 */
function isStaleData(currentUpdatedAt: Date, expectedUpdatedAt?: string | Date): boolean {
  if (!expectedUpdatedAt) return false
  const diff = Math.abs(currentUpdatedAt.getTime() - new Date(expectedUpdatedAt).getTime())
  return diff > 1000 // 1-second tolerance for database precision
}

/**
 * Run workflow database work atomically, then dispatch its queued in-app and
 * email notifications only after Prisma confirms the commit. Notification
 * delivery is best effort: failures are logged by the shared orchestration
 * primitive and never make an already-committed workflow look rolled back.
 *
 * NEW-mode creation callers pass the engine transaction isolation
 * (APPROVAL_ENGINE_TRANSACTION_ISOLATION / Serializable). The enclosing
 * boundary also translates serialization failures — including commit-time
 * failures outside persistApprovalInstance — into ApprovalEngineConflictError
 * without any retry loop; legacy/shadow transactions keep the default
 * isolation and error behavior unchanged.
 */
async function runSolutionTransactionWithNotifications<T>(
  work: (
    tx: Prisma.TransactionClient,
    notifications: PostCommitNotificationCollector,
  ) => Promise<T>,
  options?: { isolationLevel?: typeof APPROVAL_ENGINE_TRANSACTION_ISOLATION },
): Promise<T> {
  const runTransaction = async <R>(transactionWork: (tx: Prisma.TransactionClient) => Promise<R>): Promise<R> => {
    if (!options?.isolationLevel) {
      return prisma.$transaction((tx) => transactionWork(tx))
    }
    try {
      return await prisma.$transaction((tx) => transactionWork(tx), {
        isolationLevel: options.isolationLevel,
      })
    } catch (error) {
      // Enclosing-boundary translation: commit-time serialization failures
      // surface here, outside persistApprovalInstance. No retry loop.
      translateAttemptConflict(error)
    }
  }
  return runTransactionWithPostCommitNotifications({
    runTransaction,
    work,
    dispatchers: {
      notifyUser: async (notification) => {
        const { createNotification } = await import('./notifications')
        return createNotification(notification)
      },
    },
    onDispatchError: (plan, error) => {
      console.error(
        `[solutions] Failed to dispatch post-commit notification to user ${plan.notification.userId}`,
        error,
      )
    },
  })
}

function queueMappedUsers(
  notifications: PostCommitNotificationCollector,
  userIds: readonly string[],
  notification: NotificationPayload,
) {
  for (const userId of userIds) {
    notifications.user({
      userId,
      ...notification,
    })
  }
}

const SOLUTION_DRAFT_READY_PREFIX = 'solution-drafts/ready/'
const SUBMIT_ATTACHMENT_ADOPTION_ERROR = 'One or more attachments are invalid or no longer available'
const RESUBMIT_ATTACHMENT_ADOPTION_ERROR = 'One or more new attachments are invalid or no longer available'

/**
 * Owner-scoped, ready-only adoption predicate shared by submitSolution and
 * resubmitSolution. Every candidate id must resolve to a row on the target
 * request, still unlinked (solutionId null), uploaded by the current user, and
 * stored under the server-controlled `solution-drafts/ready/` prefix. Rows from
 * any other scope — request drafts (`request-drafts/...`), legacy uploads
 * (`<requestId>/...`), and mid-flight reserved/uploading solution drafts — can
 * never match the prefix, so they fail closed.
 */
function readySolutionDraftWhere(ids: string[], requestId: string, uploadedById: string) {
  return {
    id: { in: ids },
    requestId,
    solutionId: null,
    uploadedById,
    filePath: { startsWith: SOLUTION_DRAFT_READY_PREFIX },
  }
}

/**
 * Fail-closed verification that every candidate id is an adoptable solution
 * draft: the owner/request/unlinked/ready-prefix row exists (exact count), the
 * stored path is an exact five-segment `solution-drafts/ready/` path, and the
 * physical file is present. Throws `attachmentError` inside the caller's
 * transaction when any id fails, rolling the workflow back; a missing file
 * reports the draft's file name so the submitter knows which upload to retry.
 */
async function assertAdoptableSolutionDrafts(
  tx: Prisma.TransactionClient,
  ids: string[],
  requestId: string,
  uploadedById: string,
  attachmentError: string,
): Promise<void> {
  const drafts = await tx.file_attachments.findMany({
    where: readySolutionDraftWhere(ids, requestId, uploadedById),
    select: { id: true, filePath: true, fileName: true },
  })

  if (drafts.length !== ids.length) {
    throw new Error(attachmentError)
  }

  for (const draft of drafts) {
    if (!isSolutionDraftReadyPath(draft.filePath)) {
      throw new Error(attachmentError)
    }
    if (!(await attachmentFileExists(draft.filePath))) {
      throw new Error(`${draft.fileName}: Staged file is missing — please retry the upload`)
    }
  }
}

/**
 * Preserved custom-chain ordering validators for NEW custom attempts: exact
 * ordered IDs with the initiator excluded and uniqueness enforced — identical
 * semantics to the legacy chain builders (which keep their own copies).
 */
function sanitizeCustomChainOrder(approverIds: string[], initiatorId: string, emptyMessage: string): string[] {
  const filteredApprovers = approverIds.filter((id) => id !== initiatorId)
  const uniqueApprovers = [...new Set(filteredApprovers)]
  if (uniqueApprovers.length === 0) {
    throw new Error(emptyMessage)
  }
  return uniqueApprovers
}

async function assertCustomApproversExist(
  tx: Prisma.TransactionClient,
  approverIds: string[],
): Promise<void> {
  const approvers = await tx.user.findMany({
    where: { id: { in: approverIds } },
    select: { id: true },
  })
  if (approvers.length !== approverIds.length) {
    throw new Error('One or more approvers not found')
  }
}

/**
 * Submit an engineering solution for a request
 * Creates the solution record and approval chain in a transaction
 */
export async function submitSolution(input: SubmitSolutionActionInput) {
  const { user: _authUser } = (await auth()) ?? {}; const userId = _authUser?.id
  if (!userId) {
    throw new Error('Unauthorized')
  }

  // Get current user with role and level
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true,  isActive: true },
  })

  if (!user) {
    throw new Error('User not found')
  }

  const actorAssignment = await loadActiveAssignment(user.id)
  const units = await loadOrganizationUnitNodes()
  if (!canWorkOnSolutions(units, actorAssignment?.unitId ?? null)) {
    throw new Error('Your organization assignment is not eligible to submit solutions')
  }

  // Validate input
  const validated = submitSolutionSchema.parse(input)

  // Validate request exists and is in correct status
  const request = await prisma.requests.findUnique({
    where: { id: validated.requestId },
    select: {
      id: true,
      title: true,
      status: true,
      requesterId: true,
      organizationUnitId: true,
    },
  })

  if (!request) {
    throw new Error('Request not found')
  }

  const submitAction = evaluateRequestAction('SUBMIT_SOLUTION', {
    actor: {
      id: user.id,
      isActive: user.isActive !== false,
      assignmentUnitId: actorAssignment?.unitId ?? null,
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
      SUBMIT_SOLUTION: existingSubmitSolutionDecision({
        isActive: user.isActive !== false,
        assignmentUnitId: actorAssignment?.unitId ?? null,
        units,
        status: request.status,
      }),
    },
  })
  if (!submitAction.allowed) {
    if (submitAction.reason === 'WRONG_STATUS') {
      throw new Error(`Request must be in SentToEngineer status to submit solution. Current status: ${request.status}`)
    }
    throw new Error('Your organization assignment is not eligible to submit solutions')
  }

  if (request.status !== RequestStatus.SentToEngineer) {
    throw new Error(`Request must be in SentToEngineer status to submit solution. Current status: ${request.status}`)
  }

  const prepared = await prepareInlineDescription({
    description: validated.description,
    userId: user.id,
    uploadSessionId: validated.inlineImageSessionId,
  })

  const pendingNotifications: UserNotification[] = []

  // Transaction: Create solution, approval attempt, and update request status.
  // Attempt creation runs SERIALIZABLE; serialization failures translate
  // to ApprovalEngineConflictError — no retry loop.
  const result = await prisma.$transaction(
    async (tx) => {
    // Find when status first changed to SentToEngineer (from activity log)
    const statusChangeActivity = await tx.request_activities.findFirst({
      where: {
        requestId: validated.requestId,
        action: 'status_changed',
        toStatus: 'SentToEngineer',
      },
      select: {
        createdAt: true,
      },
      orderBy: {
        createdAt: 'asc', // Get the FIRST status change to SentToEngineer
      },
    })

    const sentToEngineerAt = statusChangeActivity?.createdAt

    // Create solution record
    const solution = await tx.solutions.create({
      data: {
        requestId: validated.requestId,
        title: validated.title,
        description: prepared.html,
        costEstimate: validated.costEstimate ?? 0,
        currency: validated.currency,
        timeline: validated.timeline,
        conceptDesign: validated.conceptDesign,
        submittedById: user.id,
      },
    })

    await reconcileInlineDescriptionImages(tx, {
      owner: { kind: 'solution', id: solution.id },
      imageIds: prepared.imageIds,
    })

    // Link only attachments the current user owns, staged on this request, and
    // finalized as solution drafts: `solutionId` still null, uploaded by the
    // submitting user, exact `solution-drafts/ready/` five-segment path, and a
    // physically present file. The candidate IDs were already validated as
    // <= MAX_ATTACHMENTS_PER_FORM unique UUIDs by submitSolutionSchema. The
    // ready-path prefix keeps request-scope rows and mid-flight (reserved/
    // uploading) solution drafts out of the candidate set, and verification
    // throws inside this transaction so nothing is linked unless every ID
    // resolves. The transfer stays all-or-nothing: the same tightened predicate
    // is repeated on the updateMany and its count re-checked, so a concurrent
    // cancel/delete between verify and adopt rolls back the whole submission
    // instead of linking a partial set.
    if (validated.fileIds.length > 0) {
      await assertAdoptableSolutionDrafts(
        tx,
        validated.fileIds,
        validated.requestId,
        user.id,
        SUBMIT_ATTACHMENT_ADOPTION_ERROR,
      )

      const linked = await tx.file_attachments.updateMany({
        where: readySolutionDraftWhere(validated.fileIds, validated.requestId, user.id),
        data: {
          solutionId: solution.id,
          requestId: null,
        },
      })

      if (linked.count !== validated.fileIds.length) {
        throw new Error(SUBMIT_ATTACHMENT_ADOPTION_ERROR)
      }
    }

    const attemptTx = createCleanStartPhaseAttemptTx(tx as unknown as CleanStartAttemptStore)
    if (validated.useCustomApprovals && validated.customApproverIds && validated.customApproverIds.length > 0) {
      const orderedApprovers = sanitizeCustomChainOrder(
        validated.customApproverIds,
        user.id,
        'Custom approval chain must have at least one approver after removing submitter',
      )
      await assertCustomApproversExist(tx, orderedApprovers)
      const attempt = await createCustomPersonAttempt(attemptTx, {
        requestId: validated.requestId,
        solutionId: solution.id,
        phase: 'SOLUTION',
        actorId: user.id,
        orderedApproverIds: orderedApprovers,
      })
      if (attempt.statusChange) {
        await updateRequestStatusExpecting(tx, {
          requestId: validated.requestId,
          expectedStatuses: [RequestStatus.SentToEngineer],
          data: { status: attempt.statusChange.to },
          actionLabel: 'submit solution',
        })
      }
      const currentStepId = orderedApprovers[0]
      if (currentStepId) {
        pendingNotifications.push({
          userId: currentStepId,
          type: 'approval_needed',
          title: 'Solution Submitted for Approval',
          message: `📤 Solution Submitted: "${request.title}" has a new solution ready for your approval.`,
          display: { key: 'solutionSubmitted', values: { requestTitle: request.title } },
          requestId: request.id,
        })
      }
    } else {
      const attempt = await createSolutionApprovalAttempt(attemptTx, {
        requestId: validated.requestId,
        solutionId: solution.id,
        phase: 'SOLUTION',
        originUserId: user.id,
      })
      if (attempt.statusChange) {
        await updateRequestStatusExpecting(tx, {
          requestId: validated.requestId,
          expectedStatuses: [RequestStatus.SentToEngineer],
          data: {
            status: attempt.statusChange.to,
            ...(attempt.statusChange.to === RequestStatus.SendBackToRequester
              ? { projectEstimateCost: validated.costEstimate ?? 0 }
              : {}),
          },
          actionLabel: 'submit solution',
        })
        if (attempt.statusChange.to === RequestStatus.SendBackToRequester) {
          await tx.request_activities.create({
            data: {
              requestId: validated.requestId,
              userId: request.requesterId,
              action: 'status_changed',
              fromStatus: attempt.statusChange.from,
              toStatus: attempt.statusChange.to,
              comments: attempt.completedWithoutSteps
                ? `Solution "${validated.title}" auto-completed: NO_ELIGIBLE_APPROVAL_STEPS. Request sent back to requester for final review.`
                : `Solution "${validated.title}" auto-approved (top-level submitter). Request sent back to requester for final review.`,
            },
          })
          for (const userId of mapEventRecipients({
            type: 'solution_ready',
            requesterId: request.requesterId,
            solutionSubmitterIds: [user.id],
          })) {
            pendingNotifications.push({
              userId,
              type: 'solution_ready',
              title: 'Solution Ready for Review',
              message: `Engineering solution for "${request.title}" is ready for your review.`,
              display: { key: 'solutionAutoReady', values: { requestTitle: request.title } },
              requestId: validated.requestId,
            })
          }
        }
      }
      if (attempt.instance.state === 'PENDING') {
        for (const userId of attempt.instance.steps[0]?.candidateUserIds ?? []) {
          pendingNotifications.push({
            userId,
            type: 'approval_needed',
            title: 'Solution Submitted for Approval',
            message: `📤 Solution Submitted: "${request.title}" has a new solution ready for your approval.`,
            display: { key: 'solutionSubmitted', values: { requestTitle: request.title } },
            requestId: request.id,
          })
        }
      }
    }

    // Log activity
    await tx.request_activities.create({
      data: {
        requestId: validated.requestId,
        userId: user.id,
        action: 'solution_submitted',
        comments: `Solution submitted: "${validated.title}" with cost estimate ${validated.costEstimate} ${validated.currency}`,
      },
    })

      return solution
    },
    { isolationLevel: APPROVAL_ENGINE_TRANSACTION_ISOLATION },
  )
  .catch((error: unknown) => translateAttemptConflict(error))

  if (pendingNotifications.length > 0) {
    const { createNotification } = await import('./notifications')
    await Promise.all(
      pendingNotifications.map((notification) =>
        createNotification(notification)
      )
    )
  }

  revalidateRequestViews()

  return { success: true, solutionId: result.id }
}

/**
 * Check if current user can approve a specific solution
 * Returns the approval record if user can approve
 */
export async function canUserApproveSolution(solutionId: string): Promise<{
  canApprove: boolean
  approval?: any
  solution?: any
}> {
  const { user: _authUser } = (await auth()) ?? {}; const userId = _authUser?.id
  if (!userId) {
    return { canApprove: false }
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  })

  if (!user) {
    return { canApprove: false }
  }

  // Get solution with request status
  const solution = await prisma.solutions.findUnique({
    where: { id: solutionId },
    include: {
      request: {
        select: {
          status: true,
        },
      },
    },
  })

  if (!solution) {
    return { canApprove: false }
  }

  const serializedSolution = {
    ...solution,
    costEstimate: Number(solution.costEstimate),
  }

  const approval = await prisma.solution_approvals.findFirst({
    where: {
      solutionId,
      status: 'pending',
      OR: [...CURRENT_INSTANCE_ROW_FILTER],
    },
    orderBy: { order: 'asc' },
  })

  if (!approval) {
    return { canApprove: false }
  }

  const eligibility = await engineCanUserApproveSolution(
    createPrismaApprovalTransactionDb(prisma as Prisma.TransactionClient),
    { approvalId: approval.id, actorId: userId },
  )

  if (!eligibility.canApprove) {
    // Eligibility-false responses carry no solution payload: action
    // ineligibility must not become a solution-content read.
    return { canApprove: false }
  }

  return {
    canApprove: true,
    approval,
    solution: serializedSolution,
  }
}

/**
 * Approve a solution
 */
export async function approveSolution(solutionId: string, comments?: string, expectedUpdatedAt?: string | Date) {
  const { user: _authUser } = (await auth()) ?? {}; const userId = _authUser?.id
  if (!userId) {
    throw new Error('Unauthorized')
  }

  const { canApprove, approval, solution } = await canUserApproveSolution(solutionId)
  const approveSolutionAction = evaluateRequestAction('APPROVE_SOLUTION', {
    actor: { id: userId, isActive: true, assignmentUnitId: null },
    request: {
      requesterId: '',
      organizationUnitId: null,
      status: solution?.request?.status ?? '',
    },
    canView: true,
    approval: { canApprove },
    assignedEngineer: false,
    existingActionDecisions: {
      APPROVE_SOLUTION: existingApprovalDecision(Boolean(canApprove && approval)),
    },
  })
  if (!approveSolutionAction.allowed || !canApprove || !approval) {
    throw new Error('You cannot approve this solution at this time')
  }

  // Check for stale data if expectedUpdatedAt is provided (check request's updatedAt)
  if (expectedUpdatedAt && solution) {
    const request = await prisma.requests.findUnique({
      where: { id: solution.requestId },
      select: { updatedAt: true },
    })

    if (request && isStaleData(request.updatedAt, expectedUpdatedAt)) {
      return { success: false, stale: true, message: 'This request was updated by another user.', errorKey: 'requests.error.approvalChanged' as const satisfies MessageKey }
    }
  }

  // Keep workflow writes atomic; notification plans are dispatched only
  // after this transaction commits.
  await runSolutionTransactionWithNotifications(async (tx, notifications) => {
    const solutionData = await tx.solutions.findUnique({
      where: { id: solutionId },
      select: { requestId: true, title: true, costEstimate: true, submittedById: true },
    })
    if (!solutionData) {
      throw new Error('Solution not found')
    }

    const result = await advanceApprovalAtomically(createPrismaApprovalTransactionDb(tx), {
      approvalId: approval.id,
      actorId: userId,
      phase: 'SOLUTION',
      comments,
    })

    if (result.statusChange) {
      // Last-row adapter write copies projectEstimateCost: solutionData.costEstimate
      // onto the request (locked FOR UPDATE in the same transaction).
      const request = await tx.requests.findUnique({
        where: { id: solutionData.requestId },
        select: { title: true, requesterId: true },
      })
      if (request) {
        queueMappedUsers(
          notifications,
          mapEventRecipients({
            type: 'solution_ready',
            requesterId: request.requesterId,
            solutionSubmitterIds: [solutionData.submittedById],
          }),
          {
            type: 'solution_ready',
            title: 'Solution Ready for Review',
            message: `📤 Ready for Review: "${request.title}" has been completed and awaits your department's final review.`,
            display: { key: 'solutionReady', values: { requestTitle: request.title } },
            requestId: solution.requestId,
          },
        )
      }
    } else {
      await queueNextSolutionApproverNotifications(tx, solutionId, notifications)
    }
  })

  revalidateRequestViews()

  return { success: true }
}

/**
 * Reject a solution
 */
export async function rejectSolution(solutionId: string, comments: string, expectedUpdatedAt?: string | Date) {
  const { user: _authUser } = (await auth()) ?? {}; const userId = _authUser?.id
  if (!userId) {
    throw new Error('Unauthorized')
  }

  if (!comments || comments.trim().length === 0) {
    throw new Error('Comments are required when rejecting')
  }

  const { canApprove, approval, solution } = await canUserApproveSolution(solutionId)
  const rejectSolutionAction = evaluateRequestAction('REJECT_SOLUTION', {
    actor: { id: userId, isActive: true, assignmentUnitId: null },
    request: {
      requesterId: '',
      organizationUnitId: null,
      status: solution?.request?.status ?? '',
    },
    canView: true,
    approval: { canApprove },
    assignedEngineer: false,
    existingActionDecisions: {
      REJECT_SOLUTION: existingApprovalDecision(Boolean(canApprove && approval && solution)),
    },
  })
  if (!rejectSolutionAction.allowed || !canApprove || !approval || !solution) {
    throw new Error('You cannot reject this solution at this time')
  }

  // Check for stale data if expectedUpdatedAt is provided (check request's updatedAt)
  if (expectedUpdatedAt) {
    const request = await prisma.requests.findUnique({
      where: { id: solution.requestId },
      select: { updatedAt: true },
    })

    if (request && isStaleData(request.updatedAt, expectedUpdatedAt)) {
      return { success: false, stale: true, message: 'This request was updated by another user.', errorKey: 'requests.error.approvalChanged' as const satisfies MessageKey }
    }
  }

  // Keep workflow writes atomic; notification plans are dispatched only
  // after this transaction commits.
  //
  // Not routed through the engine REJECT branch: that branch logs the
  // approve-flavoured 'solution_approved' activity and its SOLUTION status
  // write copies the cost estimate into projectEstimateCost unguarded.
  // Instead eligibility is re-evaluated with the engine inside the
  // transaction and the status change is guarded on the expected status.
  await runSolutionTransactionWithNotifications(async (tx, notifications) => {
    const txEligibility = await engineCanUserApproveSolution(
      createPrismaApprovalTransactionDb(tx),
      { approvalId: approval.id, actorId: userId },
    )
    if (!txEligibility.canApprove) {
      throw new RequestStatusConflictError(
        'Cannot reject this solution - it was changed by someone else. Please refresh and try again.',
      )
    }

    const rejected = await tx.solution_approvals.updateMany({
      where: {
        id: approval.id,
        status: 'pending',
        OR: [...CURRENT_INSTANCE_ROW_FILTER],
      },
      data: {
        approverId: userId,
        status: 'rejected',
        comments,
        approvedAt: new Date(),
      },
    })
    if (rejected.count !== 1) {
      throw new RequestStatusConflictError(
        'Cannot reject this solution - it was changed by someone else. Please refresh and try again.',
      )
    }

    // Mark all remaining pending approvals as rejected (current attempts
    // only; superseded history is never rewritten)
    await tx.solution_approvals.updateMany({
      where: {
        solutionId,
        status: 'pending',
        OR: [...CURRENT_INSTANCE_ROW_FILTER],
      },
      data: {
        status: 'rejected',
      },
    })

    // Record the outcome on the current SOLUTION instance (PENDING only) so
    // no further action can target it. No new notification events here.
    await markCurrentInstanceOutcome(tx, { solutionId, phase: 'SOLUTION', outcome: 'REJECTED' })

    // Log activity
    await tx.request_activities.create({
      data: {
        requestId: solution.requestId,
        userId,
        action: 'solution_rejected',
        comments,
      },
    })

    // Return request to SentToEngineer status for resubmission, only if it
    // is still in solution approval (0 rows -> conflict + rollback).
    await updateRequestStatusExpecting(tx, {
      requestId: solution.requestId,
      expectedStatuses: [RequestStatus.DesignCostEstimationApproval],
      data: { status: RequestStatus.SentToEngineer },
      actionLabel: 'reject the solution',
    })

    // Recipients: the engineer who submitted the solution and the approvers
    // who already approved this attempt. Not the requester, never the rejector.
    const [solutionData, priorApprovals] = await Promise.all([
      tx.solutions.findUnique({
        where: { id: solutionId },
        select: { submittedById: true, title: true },
      }),
      tx.solution_approvals.findMany({
        where: {
          solutionId,
          status: 'approved',
          OR: [...CURRENT_INSTANCE_ROW_FILTER],
        },
        orderBy: { order: 'asc' },
        select: { approverId: true },
      }),
    ])

    if (solutionData) {
      queueMappedUsers(
        notifications,
        mapEngineeringRejectionRecipients({
          solutionSubmitterId: solutionData.submittedById,
          priorApproverIds: priorApprovals.map((row) => row.approverId),
          rejectedById: userId,
        }),
        {
          type: 'approval_rejected',
          title: 'Solution Rejected',
          message: `❌ Solution Rejected: "${solutionData.title}" was rejected and returned to engineering for revision. Reason: "${comments}"`,
          display: { key: 'solutionRejected', values: { solutionTitle: solutionData.title, reason: comments } },
          requestId: solution.requestId,
        },
      )
    }
  })

  revalidateRequestViews()

  return { success: true }
}

/**
 * Resolve the next solution approver(s) using transaction reads and enqueue
 * immutable notification descriptions. Delivery is owned by the caller's
 * post-commit transaction wrapper.
 */
async function queueNextSolutionApproverNotifications(
  tx: Prisma.TransactionClient,
  solutionId: string,
  notifications: PostCommitNotificationCollector,
) {
  const nextApproval = await tx.solution_approvals.findFirst({
    where: {
      solutionId,
      status: 'pending',
      OR: [...CURRENT_INSTANCE_ROW_FILTER],
    },
    orderBy: { order: 'asc' },
    include: {
      solution: {
        select: {
          title: true,
          requestId: true,
        },
      },
    },
  })

  if (!nextApproval) return

  const recipients = await resolveApprovalNeededRecipients(
    createPrismaNotificationRecipientDb(tx),
    { approvalId: nextApproval.id, phase: 'SOLUTION' },
  )
  queueMappedUsers(notifications, recipients, {
    type: 'approval_needed',
    title: 'Solution Approval Needed',
    message: `Solution "${nextApproval.solution.title}" needs your approval.`,
    display: { key: 'solutionApprovalNeeded', values: { solutionTitle: nextApproval.solution.title } },
    requestId: nextApproval.solution.requestId,
  })
}

// ============================================================================
// FINAL APPROVAL WORKFLOW (Phase 4 Plan 5)
// ============================================================================

/**
 * Initiate final department approval for a solution
 * Creates RequestApproval records for final department sign-off
 */
export async function initiateFinalApproval(
  requestId: string,
  useCustomChain: boolean,
  customApproverIds?: string[]
) {
  const { user: _authUser } = (await auth()) ?? {}; const userId = _authUser?.id
  if (!userId) {
    throw new Error('Unauthorized')
  }

  // Get current user
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, isActive: true },
  })

  if (!user) {
    throw new Error('User not found')
  }

  if (!user.isActive) {
    throw new Error('Inactive users cannot initiate final approval')
  }

  // Validate request exists and is in correct status
  const request = await prisma.requests.findUnique({
    where: { id: requestId },
    select: {
      id: true,
      title: true,
      status: true,
      organizationUnitId: true,
      requesterId: true,
    },
  })

  if (!request) {
    throw new Error('Request not found')
  }

  if (request.status !== RequestStatus.SendBackToRequester) {
    throw new Error(`Request must be in SendBackToRequester status to initiate final approval. Current status: ${request.status}`)
  }

  // O3: initiator holds an active assignment in the request's originating unit.
  const actorAssignment = await loadActiveAssignment(user.id)
  const requestOriginUnitId = request.organizationUnitId ?? ''
  const units = await loadOrganizationUnitNodes()

  const initiateAction = evaluateRequestAction('INITIATE_FINAL_APPROVAL', {
    actor: {
      id: user.id,
      isActive: user.isActive,
      assignmentUnitId: actorAssignment?.unitId ?? null,
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
      INITIATE_FINAL_APPROVAL: existingInitiateFinalApprovalDecision({
        isActive: user.isActive,
        assignmentUnitId: actorAssignment?.unitId ?? null,
        requestOriginUnitId,
        units,
        status: request.status,
      }),
    },
  })
  if (!initiateAction.allowed) {
    if (initiateAction.reason === 'WRONG_STATUS') {
      throw new Error(`Request must be in SendBackToRequester status to initiate final approval. Current status: ${request.status}`)
    }
    throw new Error('Only members of the originating unit can initiate final approval')
  }

  await runSolutionTransactionWithNotifications(
    async (tx, notifications) => {
    const attemptTx = createCleanStartPhaseAttemptTx(tx as unknown as CleanStartAttemptStore)
    if (useCustomChain && customApproverIds && customApproverIds.length > 0) {
      const orderedApprovers = sanitizeCustomChainOrder(
        customApproverIds,
        userId,
        'Custom approval chain must have at least one approver after removing initiator',
      )
      await assertCustomApproversExist(tx, orderedApprovers)
      const attempt = await createCustomPersonAttempt(attemptTx, {
        requestId,
        phase: 'FINAL',
        actorId: userId,
        orderedApproverIds: orderedApprovers,
      })
      if (attempt.statusChange) {
        await updateRequestStatusExpecting(tx, {
          requestId,
          expectedStatuses: [RequestStatus.SendBackToRequester],
          data: { status: attempt.statusChange.to },
          actionLabel: 'initiate final approval',
        })
      }
      notifications.user({
        userId: orderedApprovers[0],
        type: 'final_approval_needed',
        title: 'Final Approval Needed',
        message: `Request "${request.title}" needs your final approval.`,
        display: { key: 'finalApprovalNeeded', values: { requestTitle: request.title } },
        requestId,
      })
    } else {
      const attempt = await createFinalApprovalAttempt(attemptTx, {
        requestId,
        phase: 'FINAL',
        originUserId: userId,
      })
      if (attempt.statusChange) {
        await updateRequestStatusExpecting(tx, {
          requestId,
          expectedStatuses: [RequestStatus.SendBackToRequester],
          data: { status: attempt.statusChange.to },
          actionLabel: 'initiate final approval',
        })
        if (attempt.statusChange.to === RequestStatus.Completed) {
          await tx.request_activities.create({
            data: {
              requestId,
              userId: request.requesterId,
              action: 'status_changed',
              fromStatus: attempt.statusChange.from,
              toStatus: attempt.statusChange.to,
              comments: attempt.completedWithoutSteps
                ? `Final approval auto-completed: NO_ELIGIBLE_APPROVAL_STEPS. Request marked as completed.`
                : `Final approval auto-approved (top-level initiator). Request marked as completed.`,
            },
          })
          await tx.notifications.create({
            data: {
              userId: request.requesterId,
              type: 'status_changed',
              title: 'Request Completed',
              message: `Your request "${request.title}" has been completed.`,
              ...notificationDisplayFields({ key: 'requestAutoCompleted', values: { requestTitle: request.title } }),
              requestId,
            },
          })
        } else {
          await queueNextFinalApproverNotifications(tx, requestId, notifications)
        }
      }
    }

    await tx.request_activities.create({
      data: {
        requestId,
        userId,
        action: 'final_approval_initiated',
        comments: useCustomChain
          ? `Final approval initiated with custom approval chain`
          : `Final approval attempt created from the published route`,
      },
    })
    },
    { isolationLevel: APPROVAL_ENGINE_TRANSACTION_ISOLATION },
  )

  revalidateRequestViews()

  return { success: true }
}

/**
 * Resolve the next final approver(s) using transaction reads and enqueue
 * immutable notification descriptions for post-commit dispatch.
 */
async function queueNextFinalApproverNotifications(
  tx: Prisma.TransactionClient,
  requestId: string,
  notifications: PostCommitNotificationCollector,
) {
  const nextApproval = await tx.request_approvals.findFirst({
    where: {
      requestId,
      status: 'pending',
      isFinalApproval: true,
      OR: [...CURRENT_INSTANCE_ROW_FILTER],
    },
    orderBy: { order: 'asc' },
    include: {
      request: {
        select: {
          title: true,
        },
      },
    },
  })

  if (!nextApproval) return

  const recipients = await resolveApprovalNeededRecipients(
    createPrismaNotificationRecipientDb(tx),
    { approvalId: nextApproval.id, phase: 'FINAL' },
  )
  queueMappedUsers(notifications, recipients, {
    type: 'final_approval_needed',
    title: 'Final Approval Needed',
    message: `Request "${nextApproval.request.title}" needs your final approval.`,
    display: { key: 'finalApprovalNeeded', values: { requestTitle: nextApproval.request.title } },
    requestId,
  })
}

/**
 * Check if current user can approve final approval
 */
export async function canUserApproveFinalApproval(requestId: string): Promise<{
  canApprove: boolean
  approval?: any
}> {
  const { user: _authUser } = (await auth()) ?? {}; const userId = _authUser?.id
  if (!userId) {
    return { canApprove: false }
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  })

  if (!user) {
    return { canApprove: false }
  }

  const approval = await prisma.request_approvals.findFirst({
    where: {
      requestId,
      status: 'pending',
      isFinalApproval: true,
      OR: [...CURRENT_INSTANCE_ROW_FILTER],
    },
    orderBy: { order: 'asc' },
  })

  if (!approval) {
    return { canApprove: false }
  }

  const eligibility = await engineCanUserApproveFinal(
    createPrismaApprovalTransactionDb(prisma as Prisma.TransactionClient),
    { approvalId: approval.id, actorId: userId },
  )

  return { canApprove: eligibility.canApprove, approval: eligibility.canApprove ? approval : undefined }
}

/**
 * Approve final approval
 */
export async function approveFinalApproval(requestId: string, comments?: string, expectedUpdatedAt?: string | Date) {
  const { user: _authUser } = (await auth()) ?? {}; const userId = _authUser?.id
  if (!userId) {
    throw new Error('Unauthorized')
  }

  const { canApprove, approval } = await canUserApproveFinalApproval(requestId)
  const approveFinalAction = evaluateRequestAction('APPROVE_FINAL', {
    actor: { id: userId, isActive: true, assignmentUnitId: null },
    request: { requesterId: '', organizationUnitId: null, status: 'FinalApproval' },
    canView: true,
    approval: { canApprove },
    assignedEngineer: false,
    existingActionDecisions: {
      APPROVE_FINAL: existingApprovalDecision(Boolean(canApprove && approval)),
    },
  })
  if (!approveFinalAction.allowed || !canApprove || !approval) {
    throw new Error('You cannot approve this request at this time')
  }

  // Check for stale data if expectedUpdatedAt is provided
  if (expectedUpdatedAt) {
    const request = await prisma.requests.findUnique({
      where: { id: requestId },
      select: { updatedAt: true },
    })

    if (request && isStaleData(request.updatedAt, expectedUpdatedAt)) {
      return { success: false, stale: true, message: 'This request was updated by another user.', errorKey: 'requests.error.approvalChanged' as const satisfies MessageKey }
    }
  }

  // Keep workflow writes atomic; notification plans are dispatched only
  // after this transaction commits.
  await runSolutionTransactionWithNotifications(async (tx, notifications) => {
    const result = await advanceApprovalAtomically(createPrismaApprovalTransactionDb(tx), {
      approvalId: approval.id,
      actorId: userId,
      phase: 'FINAL',
      comments,
    })

    if (result.statusChange) {
      const request = await tx.requests.findUnique({
        where: { id: requestId },
        select: { title: true, requesterId: true },
      })
      if (!request) {
        throw new Error('Request not found')
      }
      queueMappedUsers(
        notifications,
        mapEventRecipients({
          type: 'approval_granted',
          requesterId: request.requesterId,
        }),
        {
          type: 'approval_granted',
          title: 'Request Completed',
          message: `✅ Request Completed: "${request.title}" has been fully approved and completed.`,
          display: { key: 'requestCompleted', values: { requestTitle: request.title } },
          requestId,
        },
      )
    } else {
      await queueNextFinalApproverNotifications(tx, requestId, notifications)
    }
  })

  revalidateRequestViews()

  return { success: true }
}

/**
 * Reject final approval
 * Returns request to engineering for revision
 */
export async function rejectFinalApproval(requestId: string, comments: string, expectedUpdatedAt?: string | Date) {
  const { user: _authUser } = (await auth()) ?? {}; const userId = _authUser?.id
  if (!userId) {
    throw new Error('Unauthorized')
  }

  if (!comments || comments.trim().length === 0) {
    throw new Error('Comments are required when rejecting')
  }

  const { canApprove, approval } = await canUserApproveFinalApproval(requestId)
  const rejectFinalAction = evaluateRequestAction('REJECT_FINAL', {
    actor: { id: userId, isActive: true, assignmentUnitId: null },
    request: { requesterId: '', organizationUnitId: null, status: 'FinalApproval' },
    canView: true,
    approval: { canApprove },
    assignedEngineer: false,
    existingActionDecisions: {
      REJECT_FINAL: existingApprovalDecision(Boolean(canApprove && approval)),
    },
  })
  if (!rejectFinalAction.allowed || !canApprove || !approval) {
    throw new Error('You cannot reject this request at this time')
  }

  // Check for stale data if expectedUpdatedAt is provided
  if (expectedUpdatedAt) {
    const request = await prisma.requests.findUnique({
      where: { id: requestId },
      select: { updatedAt: true },
    })

    if (request && isStaleData(request.updatedAt, expectedUpdatedAt)) {
      return { success: false, stale: true, message: 'This request was updated by another user.', errorKey: 'requests.error.approvalChanged' as const satisfies MessageKey }
    }
  }

  // Keep workflow writes atomic; notification plans are dispatched only
  // after this transaction commits.
  //
  // Not routed through the engine REJECT branch: that branch logs the
  // approve-flavoured 'final_approval_approved' activity instead of
  // 'final_approval_rejected' with the reason. Instead eligibility is
  // re-evaluated with the engine inside the transaction and the status
  // change is guarded on the expected status.
  await runSolutionTransactionWithNotifications(async (tx, notifications) => {
    const txEligibility = await engineCanUserApproveFinal(
      createPrismaApprovalTransactionDb(tx),
      { approvalId: approval.id, actorId: userId },
    )
    if (!txEligibility.canApprove) {
      throw new RequestStatusConflictError(
        'Cannot reject this request - it was changed by someone else. Please refresh and try again.',
      )
    }

    const rejected = await tx.request_approvals.updateMany({
      where: {
        id: approval.id,
        status: 'pending',
        isFinalApproval: true,
        OR: [...CURRENT_INSTANCE_ROW_FILTER],
      },
      data: {
        approverId: userId,
        status: 'rejected',
        comments,
        approvedAt: new Date(),
      },
    })
    if (rejected.count !== 1) {
      throw new RequestStatusConflictError(
        'Cannot reject this request - it was changed by someone else. Please refresh and try again.',
      )
    }

    // Mark all remaining final approvals as rejected (current attempts only;
    // superseded history is never rewritten)
    await tx.request_approvals.updateMany({
      where: {
        requestId,
        isFinalApproval: true,
        status: 'pending',
        OR: [...CURRENT_INSTANCE_ROW_FILTER],
      },
      data: {
        status: 'rejected',
      },
    })

    // Record the outcome on the current FINAL instance (PENDING only) so no
    // further action can target it. No new notification events here.
    await markCurrentInstanceOutcome(tx, { requestId, phase: 'FINAL', outcome: 'REJECTED' })

    // Get request details
    const request = await tx.requests.findUnique({
      where: { id: requestId },
      select: { title: true, requesterId: true },
    })

    if (!request) {
      throw new Error('Request not found')
    }

    // Log activity
    await tx.request_activities.create({
      data: {
        requestId,
        userId,
        action: 'final_approval_rejected',
        comments,
      },
    })

    // Existing product path: Final reject reopens engineering revision.
    // Do not hardcode a different destination here.
    await updateRequestStatusExpecting(tx, {
      requestId,
      expectedStatuses: [RequestStatus.FinalApproval],
      data: { status: RequestStatus.SentToEngineer },
      actionLabel: 'reject the final approval',
    })

    await tx.request_activities.create({
      data: {
        requestId,
        userId,
        action: 'status_changed',
        fromStatus: RequestStatus.FinalApproval,
        toStatus: RequestStatus.SentToEngineer,
        comments: `Final approval rejected. Request returned to engineering for revision. Reason: "${comments}"`,
      },
    })

    // Final rejection reopens engineering revision, so it notifies the
    // engineering participants: the engineer who submitted the solution, the
    // solution approvers who already approved it, and the final approvers who
    // already approved this attempt. Not the requester, never the rejector.
    const latestSolution = await tx.solutions.findFirst({
      where: { requestId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, submittedById: true },
    })
    const [priorSolutionApprovals, priorFinalApprovals] = await Promise.all([
      latestSolution
        ? tx.solution_approvals.findMany({
            where: {
              solutionId: latestSolution.id,
              status: 'approved',
              OR: [...CURRENT_INSTANCE_ROW_FILTER],
            },
            orderBy: { order: 'asc' },
            select: { approverId: true },
          })
        : [],
      tx.request_approvals.findMany({
        where: {
          requestId,
          isFinalApproval: true,
          status: 'approved',
          OR: [...CURRENT_INSTANCE_ROW_FILTER],
        },
        orderBy: { order: 'asc' },
        select: { approverId: true },
      }),
    ])

    queueMappedUsers(
      notifications,
      mapEngineeringRejectionRecipients({
        solutionSubmitterId: latestSolution?.submittedById,
        priorApproverIds: [
          ...priorSolutionApprovals.map((row) => row.approverId),
          ...priorFinalApprovals.map((row) => row.approverId),
        ],
        rejectedById: userId,
      }),
      {
        type: 'approval_rejected',
        title: 'Final Approval Rejected',
        message: `❌ Final Rejection: "${request.title}" was rejected during final approval. Reason: "${comments}". Please revise the solution.`,
        display: { key: 'finalApprovalRejected', values: { requestTitle: request.title, reason: comments } },
        requestId,
      },
    )
  })

  revalidateRequestViews()

  return { success: true }
}

/**
 * Resubmit an engineering solution after rejection
 * Updates the existing solution with new details and resets the approval chain.
 *
 * Attachments are handled purely via IDs: `newFileIds` reference ready
 * solution-draft rows (staged through the XHR protocol under
 * `solution-drafts/ready/`) that get linked to the solution, and
 * `deletedFileIds` reference existing solution attachments to remove. Raw File
 * objects never cross this boundary. Physical file deletion for removed
 * attachments runs ONLY after the DB transaction commits, so a cleanup failure
 * can never roll back a successful resubmission.
 */
export async function resubmitSolution(input: ResubmitSolutionActionInput) {
  const { user: _authUser } = (await auth()) ?? {}; const userId = _authUser?.id
  if (!userId) {
    throw new Error('Unauthorized')
  }

  // Get current user with role and level
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true,  isActive: true },
  })

  if (!user) {
    throw new Error('User not found')
  }

  const actorAssignment = await loadActiveAssignment(user.id)
  const units = await loadOrganizationUnitNodes()
  if (!canWorkOnSolutions(units, actorAssignment?.unitId ?? null)) {
    throw new Error('Your organization assignment is not eligible to submit solutions')
  }

  // Validate input. newFileIds / deletedFileIds / customApprovers are <= 10
  // unique UUID arrays with [] defaults; cost is positive; currency is the
  // scoped enum.
  const validated = resubmitSolutionSchema.parse(input)

  // Validate request exists and has a rejected solution. Rejection history
  // counts only while it belongs to the current attempt: superseded NEW rows
  // are display history, never resubmission authorization (I3).
  const request = await prisma.requests.findUnique({
    where: { id: validated.requestId },
    include: {
      solutions: {
        include: {
          approvals: {
            where: { status: 'rejected', OR: [...CURRENT_INSTANCE_ROW_FILTER] },
          },
          fileAttachments: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
      approvals: {
        where: {
          status: 'rejected',
          isFinalApproval: true,
          OR: [...CURRENT_INSTANCE_ROW_FILTER],
        },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
      organizationUnit: true,
    },
  })

  if (!request) {
    throw new Error('Request not found')
  }

  const solution = request.solutions[0]
  if (!solution) {
    throw new Error('No solution found for this request')
  }

  // Check if solution has rejected approvals OR if request has rejected final approval
  const hasSolutionRejection = solution.approvals.some(a => a.status === 'rejected')
  const hasFinalApprovalRejection = request.approvals.some(a => a.status === 'rejected' && a.isFinalApproval)
  
  if (!hasSolutionRejection && !hasFinalApprovalRejection) {
    throw new Error('Can only resubmit rejected solutions')
  }

  const resubmitSolutionAction = evaluateRequestAction('RESUBMIT_SOLUTION', {
    actor: {
      id: user.id,
      isActive: user.isActive !== false,
      assignmentUnitId: actorAssignment?.unitId ?? null,
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
      RESUBMIT_SOLUTION: existingResubmitSolutionDecision({
        isActive: user.isActive !== false,
        assignmentUnitId: actorAssignment?.unitId ?? null,
        units,
        hasSolutionRejection,
        hasFinalApprovalRejection,
      }),
    },
  })
  if (!resubmitSolutionAction.allowed) {
    if (resubmitSolutionAction.reason === 'WRONG_ROLE') {
      throw new Error('Your organization assignment is not eligible to submit solutions')
    }
    throw new Error('Can only resubmit rejected solutions')
  }

  const prepared = await prepareInlineDescription({
    description: validated.description,
    userId: user.id,
    uploadSessionId: validated.inlineImageSessionId,
  })

  // Single transaction: update solution, validate + link staged attachments,
  // delete selected attachments, reset the approval chain, and transition
  // status. Physical file cleanup and queued notification delivery run only
  // AFTER this commits, so slow/failing I/O cannot expire or roll back it.
  const result = await runSolutionTransactionWithNotifications(
    async (tx, notifications) => {
    // Update solution details
    const updatedSolution = await tx.solutions.update({
      where: { id: solution.id },
      data: {
        title: validated.title,
        description: prepared.html,
        costEstimate: validated.cost,
        currency: validated.currency,
        timeline: validated.timeline,
        // Whoever resubmits becomes the submitter: the new approval attempt
        // starts from their position, so they never approve their own
        // resubmission. The original submission stays in the activity log.
        submittedById: userId,
        submittedAt: new Date(),
        updatedAt: new Date(),
      },
    })

    await reconcileInlineDescriptionImages(tx, {
      owner: { kind: 'solution', id: updatedSolution.id },
      imageIds: prepared.imageIds,
    })

    // Reject overlap between new and deleted id sets: a single id cannot be
    // both a newly staged upload and an existing attachment marked for removal.
    if (validated.newFileIds.length > 0 && validated.deletedFileIds.length > 0) {
      const deletedSet = new Set(validated.deletedFileIds)
      const hasOverlap = validated.newFileIds.some(id => deletedSet.has(id))
      if (hasOverlap) {
        throw new Error('An attachment cannot be both newly added and deleted in the same resubmission (overlap)')
      }
    }

    // Verify every new id resolves to an owner-scoped, ready-path solution
    // draft on this request with a physically present file. Request-scope rows
    // (request-drafts/...) and reserved/uploading solution drafts fail closed
    // here, and the throw rolls the whole resubmission back before any write.
    await assertAdoptableSolutionDrafts(
      tx,
      validated.newFileIds,
      validated.requestId,
      user.id,
      RESUBMIT_ATTACHMENT_ADOPTION_ERROR,
    )

    // Query deletable rows scoped to the current solution. An exact count match
    // means every deletedFileId resolved to one attachment actually owned by
    // this solution. The filePath is captured now so post-commit cleanup can
    // remove the physical file without re-reading the (soon-deleted) row.
    const deletableAttachments = await tx.file_attachments.findMany({
      where: {
        id: { in: validated.deletedFileIds },
        solutionId: solution.id,
      },
      select: { id: true, filePath: true },
    })

    if (deletableAttachments.length !== validated.deletedFileIds.length) {
      throw new Error('One or more deleted attachments are invalid or no longer available')
    }

    // Link staged rows to the solution (solutionId set, requestId cleared) by
    // re-applying the same owner-scoped ready-path predicate with an updateMany
    // count re-check that guards against concurrent mutation between the read
    // above and this write (TOCTOU under READ COMMITTED).
    if (validated.newFileIds.length > 0) {
      const linked = await tx.file_attachments.updateMany({
        where: readySolutionDraftWhere(validated.newFileIds, validated.requestId, user.id),
        data: {
          solutionId: solution.id,
          requestId: null,
        },
      })

      if (linked.count !== validated.newFileIds.length) {
        throw new Error(RESUBMIT_ATTACHMENT_ADOPTION_ERROR)
      }
    }

    // Delete the selected existing attachment rows inside the transaction.
    if (validated.deletedFileIds.length > 0) {
      await tx.file_attachments.deleteMany({
        where: {
          id: { in: validated.deletedFileIds },
          solutionId: solution.id,
        },
      })
    }

    const attemptTx = createCleanStartPhaseAttemptTx(tx as unknown as CleanStartAttemptStore)
    let isAutoApproved = false
    let submittedCustomApprovers: string[] | null = null
    const firstPendingLevel: number | null = null

    if (validated.useCustomHierarchy && validated.customApprovers.length > 0) {
      const orderedApprovers = sanitizeCustomChainOrder(
        validated.customApprovers,
        userId,
        'Custom approval chain must have at least one approver after removing submitter',
      )
      await assertCustomApproversExist(tx, orderedApprovers)
      const attempt = await createCustomPersonAttempt(attemptTx, {
        requestId: validated.requestId,
        solutionId: solution.id,
        phase: 'SOLUTION',
        actorId: userId,
        orderedApproverIds: orderedApprovers,
      })
      submittedCustomApprovers = validated.customApprovers
      if (attempt.statusChange && attempt.statusChange.to !== request.status) {
        await updateRequestStatusExpecting(tx, {
          requestId: validated.requestId,
          expectedStatuses: [request.status],
          data: { status: attempt.statusChange.to },
          actionLabel: 'resubmit solution',
        })
      }
    } else {
      const attempt = await createSolutionApprovalAttempt(attemptTx, {
        requestId: validated.requestId,
        solutionId: solution.id,
        phase: 'SOLUTION',
        originUserId: userId,
      })
      isAutoApproved = attempt.autoApproved || attempt.completedWithoutSteps
      if (isAutoApproved && attempt.statusChange) {
        await tx.requests.update({
          where: { id: validated.requestId },
          data: {
            projectEstimateCost: validated.cost,
            status: attempt.statusChange.to,
          },
        })
        await tx.request_activities.create({
          data: {
            requestId: validated.requestId,
            userId: request.requesterId,
            action: 'status_changed',
            fromStatus: attempt.statusChange.from,
            toStatus: attempt.statusChange.to,
            comments: attempt.completedWithoutSteps
              ? `Solution "${validated.title}" resubmitted and auto-completed: NO_ELIGIBLE_APPROVAL_STEPS. Request sent back to requester for final review.`
              : `Solution "${validated.title}" resubmitted and auto-approved (top-level submitter). Request sent back to requester for final review.`,
          },
        })
        queueMappedUsers(
          notifications,
          mapEventRecipients({
            type: 'solution_ready',
            requesterId: request.requesterId,
            solutionSubmitterIds: [userId],
          }),
          {
            type: 'solution_ready',
            title: 'Solution Ready for Review',
            message: `📤 Ready for Review: "${request.title}" solution has been updated and is ready for your department's final review.`,
            display: { key: 'solutionRevisionReady', values: { requestTitle: request.title } },
            requestId: validated.requestId,
          },
        )
      } else if (attempt.statusChange && attempt.statusChange.to !== request.status) {
        await updateRequestStatusExpecting(tx, {
          requestId: validated.requestId,
          expectedStatuses: [request.status],
          data: { status: attempt.statusChange.to },
          actionLabel: 'resubmit solution',
        })
      }
    }

    await tx.request_activities.create({
      data: {
        requestId: validated.requestId,
        userId,
        action: 'solution_resubmitted',
        comments: isAutoApproved
          ? `Solution resubmitted and auto-approved (top-level submitter): "${validated.title}"`
          : `Solution resubmitted: "${validated.title}"`,
      },
    })

    return {
      updatedSolution,
      deletedAttachments: deletableAttachments,
      firstPendingLevel,
      isAutoApproved,
      submittedCustomApprovers,
    }
    },
    { isolationLevel: APPROVAL_ENGINE_TRANSACTION_ISOLATION },
  )

  // AFTER the transaction commits: physically delete each removed attachment's
  // file. This runs outside the DB transaction, so a failed or slow unlink can
  // never roll back the committed resubmission. Promise.allSettled ensures one
  // rejected delete does not abort the remaining deletes; per-attachment
  // failures are surfaced individually as cleanup warnings.
  const deletedAttachments = result.deletedAttachments
  const cleanupWarnings: string[] = []
  if (deletedAttachments.length > 0) {
    const cleanupResults = await Promise.allSettled(
      deletedAttachments.map(async (attachment) => {
        await deleteAttachmentFile(attachment.filePath)
        return attachment.id
      })
    )
    cleanupResults.forEach((outcome, index) => {
      if (outcome.status === 'rejected') {
        const attachment = deletedAttachments[index]
        cleanupWarnings.push(`Attachment ${attachment.id} file could not be deleted`)
        console.warn(
          `[resubmitSolution] Failed to clean up attachment ${attachment.id} at ${attachment.filePath}`,
          outcome.reason
        )
      }
    })
  }

  // Send notifications to approvers only if NOT auto-approved. The decision
  // uses the in-transaction result: for legacy data it matches the previous
  // post-commit re-query, and for NEW attempts it cannot be fooled by wrapped
  // history rows.
  const isAutoApproved = result.isAutoApproved

  if (!isAutoApproved) {
    const { createNotification } = await import('./notifications')
    
    const nextApproval = await prisma.solution_approvals.findFirst({
      where: {
        solutionId: result.updatedSolution.id,
        status: 'pending',
        OR: [...CURRENT_INSTANCE_ROW_FILTER],
      },
      orderBy: { order: 'asc' },
      select: { id: true },
    })
    if (nextApproval) {
      const recipients = await resolveApprovalNeededRecipients(
        createPrismaNotificationRecipientDb(prisma),
        { approvalId: nextApproval.id, phase: 'SOLUTION' },
      )
      for (const userId of recipients) {
        await createNotification({
          userId,
          type: 'approval_needed',
          title: 'Solution Resubmitted',
          message: `📤 Solution resubmitted for "${request.title}". Please review the updated solution.`,
          display: { key: 'solutionResubmitted', values: { requestTitle: request.title } },
          requestId: request.id,
        })
      }
    }
  }

  revalidateRequestViews()

  return {
    success: true,
    solutionId: result.updatedSolution.id,
    deletedAttachmentIds: deletedAttachments.map(a => a.id),
    cleanupWarnings,
  }
}
