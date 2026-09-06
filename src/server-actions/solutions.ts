'use server'

import { auth } from '@/lib/auth-config'
import {
  getApprovalLevelsAboveSubmitter,
  MAX_APPROVAL_LEVEL,
  MIN_APPROVAL_LEVEL,
  normalizePersistedApprovalLevel,
  validateApprovalLevel,
} from '@/lib/approval-levels'
import prisma from '@/lib/prisma'
import { RequestStatus, UserRole, type Prisma } from '@prisma/client'
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
} from '@/lib/approval-engine/transactions'
import {
  runTransactionWithPostCommitNotifications,
  type PostCommitNotificationCollector,
} from '@/lib/post-commit-notifications'
import { getApprovalRolloutMode } from '@/lib/approval-rollout'
import { createApprovalEngineDb } from '@/lib/approval-engine/instances'
import {
  CURRENT_INSTANCE_ROW_FILTER,
  assertNewCreationEnabled,
  compareNewResolutionWithoutWrites,
  createCustomPersonAttempt,
  createFinalApprovalAttempt,
  createPrismaPhaseAdapterDb,
  createSolutionApprovalAttempt,
  markCurrentInstanceOutcome,
} from '@/lib/approval-engine/phase-adapters'

type SubmitSolutionActionInput = Omit<SubmitSolutionInput, 'inlineImageSessionId'> & {
  inlineImageSessionId?: string
}

type ResubmitSolutionActionInput = Omit<ResubmitSolutionInput, 'inlineImageSessionId'> & {
  inlineImageSessionId?: string
}

async function getMaxValidLevelInDepartment(
  tx: { user: { findFirst: Function } },
  departmentId: string,
): Promise<number> {
  const maxUser = await tx.user.findFirst({
    where: {
      departmentId,
      isActive: true,
      level: { gte: MIN_APPROVAL_LEVEL, lte: MAX_APPROVAL_LEVEL },
    },
    orderBy: { level: 'desc' },
    select: { level: true },
  })

  return normalizePersistedApprovalLevel(maxUser?.level) ?? MIN_APPROVAL_LEVEL
}

function normalizeSubmitterLevel(level: number | null | undefined): number {
  return normalizePersistedApprovalLevel(level) ?? MIN_APPROVAL_LEVEL
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
 */
async function runSolutionTransactionWithNotifications<T>(
  work: (
    tx: Prisma.TransactionClient,
    notifications: PostCommitNotificationCollector,
  ) => Promise<T>,
): Promise<T> {
  return runTransactionWithPostCommitNotifications({
    runTransaction: (transactionWork) =>
      prisma.$transaction((tx) => transactionWork(tx)),
    work,
    dispatchers: {
      notifyUser: async (notification) => {
        const { createNotification } = await import('./notifications')
        return createNotification(notification)
      },
      notifyDepartment: async (
        departmentId,
        notification,
        excludeUserIds,
      ) => {
        const { notifyUsersInDepartment } = await import('./notifications')
        return notifyUsersInDepartment(
          departmentId,
          notification,
          excludeUserIds,
        )
      },
    },
    onDispatchError: (plan, error) => {
      const target =
        plan.target === 'user'
          ? `user ${plan.notification.userId}`
          : `department ${plan.departmentId}`
      console.error(
        `[solutions] Failed to dispatch post-commit notification to ${target}`,
        error,
      )
    },
  })
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
    select: { id: true, role: true, departmentId: true, level: true },
  })

  if (!user) {
    throw new Error('User not found')
  }

  if (!user.departmentId) {
    throw new Error('User must be assigned to a department to submit solutions. Please contact an administrator.')
  }

  if (user.role !== UserRole.engineering) {
    throw new Error('Only engineering users can submit solutions')
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
      departmentId: true,
      requesterId: true,
    },
  })

  if (!request) {
    throw new Error('Request not found')
  }

  if (request.status !== RequestStatus.SentToEngineer) {
    throw new Error(`Request must be in SentToEngineer status to submit solution. Current status: ${request.status}`)
  }

  // Get engineering department ID for hierarchy-based approvals
  const engineeringDept = await prisma.departments.findFirst({
    where: { type: 'ENGINEERING' },
    select: { id: true },
  })

  if (!engineeringDept) {
    throw new Error('Engineering department not found')
  }

  const prepared = await prepareInlineDescription({
    description: validated.description,
    userId: user.id,
    uploadSessionId: validated.inlineImageSessionId,
  })

  const pendingNotifications: Array<{
    userId: string
    type: 'approval_needed' | 'solution_ready'
    title: string
    message: string
    requestId: string
  }> = []

  // Transaction: Create solution, approval chain, and update request status
  const result = await prisma.$transaction(async (tx) => {
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

    // Check if submitter is top-level in engineering (for auto-approval)
    const maxLevel = validateApprovalLevel(
      await getMaxValidLevelInDepartment(tx, engineeringDept.id),
    )
    const submitterLevel = normalizeSubmitterLevel(user.level)
    const isTopLevelSubmitter = submitterLevel >= maxLevel

    // Rollout gate: creation only. Legacy (the default) and shadow keep the
    // existing builders exactly; new mode is denied until Task 15 activation.
    const rolloutMode = getApprovalRolloutMode(process.env)

    // Create approval chain based on selection
    if (rolloutMode === 'new') {
      // Denied until Task 15 activation support exists; throws before any NEW
      // write and rolls the whole submission back.
      await assertNewCreationEnabled(tx)
      const phaseDb = createPrismaPhaseAdapterDb(tx)
      if (validated.useCustomApprovals && validated.customApproverIds && validated.customApproverIds.length > 0) {
        // Custom ordered-person chain: preserved validators, never
        // auto-approved; status SentToEngineer -> DesignCostEstimationApproval.
        const orderedApprovers = sanitizeCustomChainOrder(
          validated.customApproverIds,
          user.id,
          'Custom approval chain must have at least one approver after removing submitter',
        )
        await assertCustomApproversExist(tx, orderedApprovers)
        // Single status writer: createCustomPersonAttempt applies and guards
        // SentToEngineer -> DesignCostEstimationApproval; no action-level
        // status write here (a second CAS would match zero rows and roll the
        // submission back once `new` is enabled).
        await createCustomPersonAttempt(phaseDb, {
          requestId: validated.requestId,
          solutionId: solution.id,
          phase: 'SOLUTION',
          initiatorId: user.id,
          orderedApproverIds: orderedApprovers,
        })
        // Preserve custom solution notify-all-at-submit (raw submitted list).
        for (const approverId of validated.customApproverIds) {
          pendingNotifications.push({
            userId: approverId,
            type: 'approval_needed',
            title: 'Solution Submitted for Approval',
            message: `📤 Solution Submitted: "${request.title}" has a new solution ready for your approval.`,
            requestId: request.id,
          })
        }
      } else {
        const attempt = await createSolutionApprovalAttempt(phaseDb, {
          requestId: validated.requestId,
          solutionId: solution.id,
          submittedById: user.id,
        })
        if (attempt.statusChange?.to === RequestStatus.SendBackToRequester) {
          // The legacy auto path also records the project estimate cost.
          if (attempt.autoApproved || attempt.completedWithoutSteps) {
            await tx.requests.update({
              where: { id: validated.requestId },
              data: { projectEstimateCost: validated.costEstimate ?? 0 },
            })
          }
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
          pendingNotifications.push({
            userId: request.requesterId,
            type: 'solution_ready',
            title: 'Solution Ready for Review',
            message: `Engineering solution for "${request.title}" is ready for your review.`,
            requestId: validated.requestId,
          })
        }
        // Pending NEW attempts: approver notifications resolve from candidate
        // groups in Tasks 9/10 and are intentionally not invented here.
      }
    } else if (validated.useCustomApprovals && validated.customApproverIds && validated.customApproverIds.length > 0) {
      // Custom approval chain (never auto-approved)
      await createCustomApprovalChain(tx, solution.id, validated.customApproverIds, user.id)
      // Update request status to DesignCostEstimationApproval via the shared
      // expected-status guard: if a requester cancellation committed after the
      // pre-transaction read, this matches zero rows and throws, rolling back
      // the solution and its approval chain instead of overwriting Cancelled.
      await updateRequestStatusExpecting(tx, {
        requestId: validated.requestId,
        expectedStatuses: [RequestStatus.SentToEngineer],
        data: { status: RequestStatus.DesignCostEstimationApproval },
        actionLabel: 'submit solution',
      })

      // Notify custom approvers about the solution submission
      for (const approverId of validated.customApproverIds) {
        pendingNotifications.push({
          userId: approverId,
          type: 'approval_needed',
          title: 'Solution Submitted for Approval',
          message: `📤 Solution Submitted: "${request.title}" has a new solution ready for your approval.`,
          requestId: request.id,
        })
      }
    } else if (isTopLevelSubmitter) {
      // Top-level submitter with hierarchy - auto-approve and go directly to SendBackToRequester
      await tx.solution_approvals.create({
        data: {
          solutionId: solution.id,
          requiredLevel: maxLevel,
          order: 1,
          status: 'approved',
          approverId: user.id,
          approvedAt: new Date(),
          comments: 'Auto-approved (top-level submitter)',
          isCustomChain: false,
        },
      })
      // Skip approval phase, go directly to SendBackToRequester. Guarded so a
      // concurrent requester cancellation aborts this transaction instead of
      // being overwritten (see updateRequestStatusExpecting).
      await updateRequestStatusExpecting(tx, {
        requestId: validated.requestId,
        expectedStatuses: [RequestStatus.SentToEngineer],
        data: {
          status: RequestStatus.SendBackToRequester,
          projectEstimateCost: validated.costEstimate ?? 0,
        },
        actionLabel: 'submit solution',
      })
      // Log status change
      await tx.request_activities.create({
        data: {
          requestId: validated.requestId,
          userId: request.requesterId,
          action: 'status_changed',
          fromStatus: RequestStatus.SentToEngineer,
          toStatus: RequestStatus.SendBackToRequester,
          comments: `Solution "${validated.title}" auto-approved (top-level submitter). Request sent back to requester for final review.`,
        },
      })
      // Create notification for requester
      pendingNotifications.push({
        userId: request.requesterId,
        type: 'solution_ready',
        title: 'Solution Ready for Review',
        message: `Engineering solution for "${request.title}" is ready for your review.`,
        requestId: validated.requestId,
      })
    } else {
      // Default hierarchy-based approval chain
      const hierarchyApprovals = await createHierarchyApprovalChain(
        tx,
        solution.id,
        engineeringDept.id,
        submitterLevel,
        user.id,
      )
      // Update request status to DesignCostEstimationApproval via the shared
      // expected-status guard (see updateRequestStatusExpecting).
      await updateRequestStatusExpecting(tx, {
        requestId: validated.requestId,
        expectedStatuses: [RequestStatus.SentToEngineer],
        data: { status: RequestStatus.DesignCostEstimationApproval },
        actionLabel: 'submit solution',
      })

      // Notify engineering department approvers at the first *actual* pending level.
      // Chain creation skips empty levels, so this must not use arithmetic submitter+1.
      const { getApproversAtLevel } = await import('./approvals')
      const firstPendingApproval = hierarchyApprovals.find((a) => a.status === 'pending')
      const firstPendingLevel = firstPendingApproval?.requiredLevel
      if (firstPendingLevel !== undefined && firstPendingLevel !== null) {
        const firstLevelApprovers = await getApproversAtLevel(engineeringDept.id, firstPendingLevel)

        // Notify each approver
        for (const approver of firstLevelApprovers) {
          pendingNotifications.push({
            userId: approver.id,
            type: 'approval_needed',
            title: 'Solution Submitted for Approval',
            message: `📤 Solution Submitted: "${request.title}" has a new solution ready for your approval.`,
            requestId: request.id,
          })
        }
      }
    }

    // Shadow mode: read-only NEW resolution alongside the legacy result;
    // reports a missing/unmapped route without ever failing the submission.
    if (rolloutMode === 'shadow') {
      await compareNewResolutionWithoutWrites(createApprovalEngineDb(tx), {
        phase: 'SOLUTION',
        requestId: validated.requestId,
        solutionId: solution.id,
        originUserId: user.id,
      })
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
  })

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
 * Create a custom approval chain for a solution
 * Filters out submitter and validates uniqueness
 */
async function createCustomApprovalChain(
  tx: any,
  solutionId: string,
  approverIds: string[],
  submitterId: string
) {
  // Filter out submitter from approver list (auto-skip if included)
  const filteredApprovers = approverIds.filter(id => id !== submitterId)

  // Validate uniqueness
  const uniqueApprovers = [...new Set(filteredApprovers)]

  if (uniqueApprovers.length === 0) {
    throw new Error('Custom approval chain must have at least one approver after removing submitter')
  }

  // Verify all approvers exist
  const approvers = await tx.user.findMany({
    where: { id: { in: uniqueApprovers } },
    select: { id: true, name: true },
  })

  if (approvers.length !== uniqueApprovers.length) {
    throw new Error('One or more approvers not found')
  }

  // Create approval records with sequential order
  const approvals = uniqueApprovers.map((approverId, index) => ({
    solutionId,
    requiredApproverId: approverId,
    order: index + 1,
    status: 'pending' as const,
    isCustomChain: true,
    // Explicit discriminator: without it the row would default to LEGACY_LEVEL
    // and violate the row-mode integrity check. Compatibility version 0 is
    // kept until NEW instance integration (Task 7/8).
    routingMode: 'CUSTOM_PERSON' as const,
  }))

  await tx.solution_approvals.createMany({ data: approvals })

  return approvals
}

/**
 * Create a hierarchy-based approval chain for a solution
 * Reuses the logic from approvals.ts createApprovalChain
 * All levels above submitter need to approve
 */
async function createHierarchyApprovalChain(
  tx: any,
  solutionId: string,
  departmentId: string,
  submitterLevel: number,
  submitterId: string
) {
  const maxLevel = validateApprovalLevel(await getMaxValidLevelInDepartment(tx, departmentId))
  const normalizedSubmitter = normalizeSubmitterLevel(submitterLevel)

  const approvals = []
  let order = 1

  // If submitter is top-level, create auto-approved record
  if (normalizedSubmitter >= maxLevel) {
    approvals.push({
      solutionId,
      requiredLevel: maxLevel,
      order: 1,
      status: 'approved' as const,
      approverId: submitterId,
      approvedAt: new Date(),
      comments: 'Auto-approved (top-level submitter)',
      isCustomChain: false,
    })
  } else {
    // Create approvals for all levels between submitter and max level
    for (const level of getApprovalLevelsAboveSubmitter(normalizedSubmitter, maxLevel)) {
      const requiredLevel = validateApprovalLevel(level)

      // Check if there are active users at this level
      const hasUsersAtLevel = await tx.user.findFirst({
        where: {
          departmentId,
          level: requiredLevel,
          isActive: true,
        },
        select: { id: true },
      })

      if (hasUsersAtLevel) {
        approvals.push({
          solutionId,
          requiredLevel,
          order: order++,
          status: 'pending' as const,
          isCustomChain: false,
        })
      }
    }
  }

  if (approvals.length > 0) {
    await tx.solution_approvals.createMany({ data: approvals })
  }

  return approvals
}

/**
 * Get solution by ID with related data
 */
export async function getSolutionBySolutionId(solutionId: string) {
  const { user: _authUser } = (await auth()) ?? {}; const userId = _authUser?.id
  if (!userId) {
    throw new Error('Unauthorized')
  }

  const solution = await prisma.solutions.findUnique({
    where: { id: solutionId },
    include: {
      submittedBy: {
        select: { id: true, name: true, email: true },
      },
      request: {
        select: {
          id: true,
          title: true,
          status: true,
          requesterId: true,
        },
      },
      fileAttachments: {
        select: {
          id: true,
          fileName: true,
          fileType: true,
          fileSize: true,
          filePath: true,
          createdAt: true,
        },
      },
    },
  })

  // Convert Decimal to number for client component serialization
  if (solution) {
    return {
      ...solution,
      costEstimate: Number(solution.costEstimate),
    }
  }

  return solution
}

/**
 * Get solution by request ID
 * Returns the solution if one exists for the request
 */
export async function getSolutionByRequestId(requestId: string) {
  const { user: _authUser } = (await auth()) ?? {}; const userId = _authUser?.id
  if (!userId) {
    throw new Error('Unauthorized')
  }

  const solution = await prisma.solutions.findFirst({
    where: { requestId },
    include: {
      submittedBy: {
        select: { id: true, name: true, email: true },
      },
      fileAttachments: {
        select: {
          id: true,
          fileName: true,
          fileType: true,
          fileSize: true,
          filePath: true,
          createdAt: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  // Convert Decimal to number for client component serialization
  if (solution) {
    return {
      ...solution,
      costEstimate: Number(solution.costEstimate),
    }
  }

  return solution
}

/**
 * Get solution approvals with eligible approvers
 * For custom chains, returns the specific required approver
 * For hierarchy chains, returns all eligible users at each level
 */
export async function getSolutionApprovals(solutionId: string) {
  const solution = await prisma.solutions.findUnique({
    where: { id: solutionId },
    include: {
      request: {
        select: { departmentId: true },
      },
    },
  })

  if (!solution) {
    return []
  }

  // Get engineering department ID
  const engineeringDept = await prisma.departments.findFirst({
    where: { type: 'ENGINEERING' },
    select: { id: true },
  })

  if (!engineeringDept) {
    return []
  }

  const approvals = await prisma.solution_approvals.findMany({
    where: { solutionId },
    include: {
      approver: {
        select: {
          id: true,
          name: true,
          email: true,
          level: true,
        },
      },
      requiredApprover: {
        select: {
          id: true,
          name: true,
          email: true,
          level: true,
        },
      },
    },
    orderBy: { order: 'asc' },
  })

  // For hierarchy-based approvals, add eligible approvers at each level
  const approvalsWithEligible = await Promise.all(
    approvals.map(async (approval) => {
      let eligibleApprovers: Array<{ id: string; name: string; level: number | null }> = []

      // For hierarchy-based pending approvals, get eligible users at this level
      if (approval.status === 'pending' && !approval.isCustomChain && approval.requiredLevel) {
        const users = await prisma.user.findMany({
          where: {
            departmentId: engineeringDept.id,
            level: approval.requiredLevel,
            isActive: true,
          },
          select: {
            id: true,
            name: true,
            level: true,
          },
          take: 10,
        })
        eligibleApprovers = users.filter(u => u.level !== null)
      }

      return {
        ...approval,
        eligibleApprovers,
      }
    })
  )

  return approvalsWithEligible
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
    select: { id: true, level: true, departmentId: true, role: true },
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
          departmentId: true,
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
    return { canApprove: false, solution: serializedSolution }
  }

  const eligibility = await engineCanUserApproveSolution(
    createPrismaApprovalTransactionDb(prisma as Prisma.TransactionClient),
    { approvalId: approval.id, actorId: userId },
  )

  return {
    canApprove: eligibility.canApprove,
    approval: eligibility.canApprove ? approval : undefined,
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
  if (!canApprove || !approval) {
    throw new Error('You cannot approve this solution at this time')
  }

  // Check for stale data if expectedUpdatedAt is provided (check request's updatedAt)
  if (expectedUpdatedAt && solution) {
    const request = await prisma.requests.findUnique({
      where: { id: solution.requestId },
      select: { updatedAt: true },
    })

    if (request && isStaleData(request.updatedAt, expectedUpdatedAt)) {
      return { success: false, stale: true, message: 'This request was updated by another user.' }
    }
  }

  // Keep workflow writes atomic; notification plans are dispatched only
  // after this transaction commits.
  await runSolutionTransactionWithNotifications(async (tx, notifications) => {
    const solutionData = await tx.solutions.findUnique({
      where: { id: solutionId },
      select: { requestId: true, title: true, costEstimate: true },
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
        select: { title: true, departmentId: true },
      })
      if (request?.departmentId) {
        notifications.department(request.departmentId, {
          type: 'solution_ready',
          title: 'Solution Ready for Review',
          message: `📤 Ready for Review: "${request.title}" has been completed and awaits your department's final review.`,
          requestId: solution.requestId,
        })
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
  if (!canApprove || !approval || !solution) {
    throw new Error('You cannot reject this solution at this time')
  }

  // Check for stale data if expectedUpdatedAt is provided (check request's updatedAt)
  if (expectedUpdatedAt) {
    const request = await prisma.requests.findUnique({
      where: { id: solution.requestId },
      select: { updatedAt: true },
    })

    if (request && isStaleData(request.updatedAt, expectedUpdatedAt)) {
      return { success: false, stale: true, message: 'This request was updated by another user.' }
    }
  }

  // Keep workflow writes atomic; notification plans are dispatched only
  // after this transaction commits.
  await runSolutionTransactionWithNotifications(async (tx, notifications) => {
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

    // Return request to SentToEngineer status for resubmission
    await tx.requests.update({
      where: { id: solution.requestId },
      data: { status: RequestStatus.SentToEngineer },
    })

    // Get solution details for notification
    const solutionData = await tx.solutions.findUnique({
      where: { id: solutionId },
      select: { submittedById: true, title: true },
    })

    if (solutionData) {
      // Queue the submitter notification for post-commit dispatch.
      notifications.user({
        userId: solutionData.submittedById,
        type: 'approval_rejected',
        title: 'Solution Rejected',
        message: `Your solution "${solutionData.title}" was rejected and returned for resubmission.`,
        requestId: solution.requestId,
      })
    }
  })

  revalidateRequestViews()

  return { success: true }
}

/**
 * Mark a request as completed (manual completion by engineering)
 * Allows engineering to track completion without formal final approval
 */
export async function markRequestComplete(requestId: string, completionNote?: string) {
  const { user: _authUser } = (await auth()) ?? {}; const userId = _authUser?.id
  if (!userId) {
    throw new Error('Unauthorized')
  }

  // Get current user with role
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, name: true },
  })

  if (!user) {
    throw new Error('User not found')
  }

  if (user.role !== UserRole.engineering) {
    throw new Error('Only engineering users can mark requests complete')
  }

  // Validate request exists and is in correct status
  const request = await prisma.requests.findUnique({
    where: { id: requestId },
    select: {
      id: true,
      title: true,
      status: true,
      requesterId: true,
    },
  })

  if (!request) {
    throw new Error('Request not found')
  }

  if (request.status !== RequestStatus.SendBackToRequester) {
    throw new Error(`Request can only be marked complete when in SendBackToRequester status. Current status: ${request.status}`)
  }

  // Use transaction for atomicity
  await prisma.$transaction(async (tx) => {
    // Update request status to Completed via the shared expected-status guard:
    // a requester cancellation that committed first makes this match zero
    // rows and throw, so the completion is not written over the cancellation.
    await updateRequestStatusExpecting(tx, {
      requestId,
      expectedStatuses: [RequestStatus.SendBackToRequester],
      data: { status: RequestStatus.Completed },
      actionLabel: 'mark the request complete',
    })

    // Log activity
    await tx.request_activities.create({
      data: {
        requestId,
        userId: user.id,
        action: 'manually_completed',
        fromStatus: RequestStatus.SendBackToRequester,
        toStatus: RequestStatus.Completed,
        comments: completionNote || 'Manually marked as completed by engineering',
      },
    })

    // Create notification for requester
    await tx.notifications.create({
      data: {
        userId: request.requesterId,
        type: 'status_changed',
        title: 'Request Completed',
        message: `Your request "${request.title}" has been marked as completed`,
        requestId,
      },
    })
  })

  revalidateRequestViews()

  return { success: true }
}

/**
 * Check if current user can mark a request as complete
 */
export async function canMarkComplete(requestId: string): Promise<{
  canMark: boolean
  reason?: string
}> {
  const { user: _authUser } = (await auth()) ?? {}; const userId = _authUser?.id
  if (!userId) {
    return { canMark: false, reason: 'Not authenticated' }
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true },
  })

  if (!user) {
    return { canMark: false, reason: 'User not found' }
  }

  if (user.role !== UserRole.engineering) {
    return { canMark: false, reason: 'Only engineering users can mark requests complete' }
  }

  const request = await prisma.requests.findUnique({
    where: { id: requestId },
    select: { status: true },
  })

  if (!request) {
    return { canMark: false, reason: 'Request not found' }
  }

  if (request.status !== RequestStatus.SendBackToRequester) {
    return { canMark: false, reason: `Request must be in SendBackToRequester status. Current: ${request.status}` }
  }

  return { canMark: true }
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

  // For custom chain: notify specific requiredApproverId
  if (nextApproval.isCustomChain && nextApproval.requiredApproverId) {
    notifications.user({
      userId: nextApproval.requiredApproverId,
      type: 'approval_needed',
      title: 'Solution Approval Needed',
      message: `Solution "${nextApproval.solution.title}" needs your approval.`,
      requestId: nextApproval.solution.requestId,
    })
    return
  }

  // For hierarchy chain: notify all users at requiredLevel in engineering dept
  if (nextApproval.requiredLevel) {
    const engineeringDept = await tx.departments.findFirst({
      where: { type: 'ENGINEERING' },
      select: { id: true },
    })

    if (engineeringDept) {
      const approvers = await tx.user.findMany({
        where: {
          departmentId: engineeringDept.id,
          level: nextApproval.requiredLevel,
          isActive: true,
        },
        select: { id: true },
      })

      for (const approver of approvers) {
        notifications.user({
          userId: approver.id,
          type: 'approval_needed',
          title: 'Solution Approval Needed',
          message: `Solution "${nextApproval.solution.title}" needs your approval.`,
          requestId: nextApproval.solution.requestId,
        })
      }
    }
  }
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
    select: { id: true, role: true, departmentId: true, level: true },
  })

  if (!user) {
    throw new Error('User not found')
  }

  // Validate request exists and is in correct status
  const request = await prisma.requests.findUnique({
    where: { id: requestId },
    select: {
      id: true,
      title: true,
      status: true,
      departmentId: true,
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

  // Final initiation permission. NEW requests (typed originating unit)
  // require DIRECT membership of the originating unit: ancestor visibility
  // alone is insufficient, and a manager's own parent-unit request uses that
  // unit directly, not its descendant sections. Legacy rows keep the existing
  // same-department rule.
  const requestDepartmentId = request.departmentId
  const requestOrganizationUnitId = request.organizationUnitId
  const isTypedUnitRequest = requestOrganizationUnitId !== null
  if (isTypedUnitRequest) {
    const directMembership = await prisma.organization_position_assignments.findFirst({
      where: { userId, unitId: requestOrganizationUnitId, isActive: true },
      select: { id: true },
    })
    if (!directMembership) {
      throw new Error('Only members of the request\'s originating unit can initiate final approval')
    }
  }
  if (requestDepartmentId === null) {
    // Legacy fail-closed boundary: legacy final approval still requires the
    // request's department; typed-unit requests route through NEW creation.
    throw new Error('Organization-owned requests are not supported by legacy final approval yet')
  }
  if (!isTypedUnitRequest && user.departmentId !== requestDepartmentId) {
    throw new Error('Only department members can initiate final approval')
  }

  // Get max level in department for top-level check
  const maxLevel = validateApprovalLevel(
    await getMaxValidLevelInDepartment(prisma, requestDepartmentId),
  )
  const initiatorLevel = normalizeSubmitterLevel(user.level)
  const isTopLevelInitiator = initiatorLevel >= maxLevel

  // Keep workflow writes atomic; approver notification plans are dispatched
  // only after this transaction commits.
  await runSolutionTransactionWithNotifications(async (tx, notifications) => {
    // Rollout gate: creation only. Legacy (the default) and shadow keep the
    // existing delete-and-rebuild behavior exactly; new mode is denied until
    // Task 15 activation.
    const rolloutMode = getApprovalRolloutMode(process.env)

    // Delete old final approval records — legacy/shadow only; NEW mode keeps
    // prior attempts as superseded history instead of deleting their rows.
    if (rolloutMode !== 'new') {
      await tx.request_approvals.deleteMany({
        where: {
          requestId,
          isFinalApproval: true,
        },
      })
    }

    // Create final approval chain
    if (rolloutMode === 'new') {
      // Denied until Task 15 activation support exists; throws before any NEW
      // write and rolls the initiation back.
      await assertNewCreationEnabled(tx)
      const phaseDb = createPrismaPhaseAdapterDb(tx)
      if (useCustomChain && customApproverIds && customApproverIds.length > 0) {
        // Custom ordered-person chain: preserved validators, never
        // auto-approved; first-step-only notification (custom final rule).
        const orderedApprovers = sanitizeCustomChainOrder(
          customApproverIds,
          userId,
          'Custom approval chain must have at least one approver after removing initiator',
        )
        await assertCustomApproversExist(tx, orderedApprovers)
        // Single status writer: the adapter applies and guards
        // SendBackToRequester -> FinalApproval; no action-level CAS here.
        await createCustomPersonAttempt(phaseDb, {
          requestId,
          phase: 'FINAL',
          initiatorId: userId,
          orderedApproverIds: orderedApprovers,
        })
        notifications.user({
          userId: orderedApprovers[0],
          type: 'final_approval_needed',
          title: 'Final Approval Needed',
          message: `Request "${request.title}" needs your final approval.`,
          requestId,
        })
      } else {
        const attempt = await createFinalApprovalAttempt(phaseDb, {
          requestId,
          initiatorId: userId,
        })
        if (attempt.statusChange?.to === RequestStatus.Completed) {
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
          // In-app requester notice (written inside the transaction, matching
          // the legacy auto path).
          await tx.notifications.create({
            data: {
              userId: request.requesterId,
              type: 'status_changed',
              title: 'Request Completed',
              message: `Your request "${request.title}" has been completed.`,
              requestId,
            },
          })
        }
        // Pending NEW attempts: first-approver notifications resolve from
        // candidate groups in Tasks 9/10 and are intentionally not invented.
      }
    } else if (useCustomChain && customApproverIds && customApproverIds.length > 0) {
      // Custom approval chain (never auto-approved)
      await createCustomFinalApprovalChain(tx, requestId, customApproverIds, userId)
      // Update request status to FinalApproval via the shared expected-status
      // guard: a requester cancellation that committed first aborts this
      // transaction (and rolls back the approval chain) instead of being
      // overwritten.
      await updateRequestStatusExpecting(tx, {
        requestId,
        expectedStatuses: [RequestStatus.SendBackToRequester],
        data: { status: RequestStatus.FinalApproval },
        actionLabel: 'initiate final approval',
      })
    } else if (isTopLevelInitiator) {
      // Top-level initiator with hierarchy - auto-approve and go directly to Completed
      await tx.request_approvals.create({
        data: {
          requestId,
          requiredLevel: maxLevel,
          order: 1,
          status: 'approved',
          approverId: user.id,
          approvedAt: new Date(),
          comments: 'Auto-approved (top-level initiator)',
          isCustomChain: false,
          isFinalApproval: true,
        },
      })
      // Skip approval phase, go directly to Completed. Guarded so a
      // concurrent requester cancellation aborts this transaction instead
      // of being overwritten (see updateRequestStatusExpecting).
      await updateRequestStatusExpecting(tx, {
        requestId,
        expectedStatuses: [RequestStatus.SendBackToRequester],
        data: { status: RequestStatus.Completed },
        actionLabel: 'initiate final approval',
      })
      // Log status change
      await tx.request_activities.create({
        data: {
          requestId,
          userId: request.requesterId,
          action: 'status_changed',
          fromStatus: RequestStatus.SendBackToRequester,
          toStatus: RequestStatus.Completed,
          comments: `Final approval auto-approved (top-level initiator). Request marked as completed.`,
        },
      })
      // Create notification for requester
      await tx.notifications.create({
        data: {
          userId: request.requesterId,
          type: 'status_changed',
          title: 'Request Completed',
          message: `Your request "${request.title}" has been completed.`,
          requestId,
        },
      })
    } else {
      // Use department hierarchy
      await createHierarchyFinalApprovalChain(tx, requestId, requestDepartmentId, userId)
      // Update request status to FinalApproval via the shared expected-status
      // guard (see updateRequestStatusExpecting).
      await updateRequestStatusExpecting(tx, {
        requestId,
        expectedStatuses: [RequestStatus.SendBackToRequester],
        data: { status: RequestStatus.FinalApproval },
        actionLabel: 'initiate final approval',
      })
    }

    // Shadow mode: read-only NEW resolution alongside the legacy result;
    // reports a missing/unmapped route without ever failing the initiation.
    if (rolloutMode === 'shadow') {
      await compareNewResolutionWithoutWrites(createApprovalEngineDb(tx), {
        phase: 'FINAL',
        requestId,
        originUserId: userId,
      })
    }

    // Log activity
    await tx.request_activities.create({
      data: {
        requestId,
        userId,
        action: 'final_approval_initiated',
        comments: rolloutMode === 'new'
          ? useCustomChain
            ? `Final approval initiated with custom approval chain`
            : `Final approval attempt created from the published route`
          : useCustomChain
          ? `Final approval initiated with custom approval chain`
          : isTopLevelInitiator
          ? `Final approval auto-approved (top-level initiator)`
          : `Final approval initiated with department hierarchy`,
      },
    })

    // Resolve and queue first approver notification(s) only if not top-level.
    // NEW custom attempts notify their first step inline; NEW normal pending
    // notifications resolve from candidate groups in Tasks 9/10.
    if (rolloutMode !== 'new' && (useCustomChain || !isTopLevelInitiator)) {
      await queueNextFinalApproverNotifications(
        tx,
        requestId,
        notifications,
      )
    }
  })

  revalidateRequestViews()

  return { success: true }
}

/**
 * Create custom final approval chain
 * Filters out initiator and validates uniqueness
 */
async function createCustomFinalApprovalChain(
  tx: any,
  requestId: string,
  approverIds: string[],
  initiatorId: string
) {
  // Filter out initiator from approver list
  const filteredApprovers = approverIds.filter(id => id !== initiatorId)

  // Validate uniqueness
  const uniqueApprovers = [...new Set(filteredApprovers)]

  if (uniqueApprovers.length === 0) {
    throw new Error('Custom approval chain must have at least one approver after removing initiator')
  }

  // Verify all approvers exist
  const approvers = await tx.user.findMany({
    where: { id: { in: uniqueApprovers } },
    select: { id: true, name: true },
  })

  if (approvers.length !== uniqueApprovers.length) {
    throw new Error('One or more approvers not found')
  }

  // Create approval records with sequential order
  const approvals = uniqueApprovers.map((approverId, index) => ({
    requestId,
    requiredApproverId: approverId,
    requiredLevel: 0, // Not used for custom chains
    order: index + 1,
    status: 'pending' as const,
    isCustomChain: true,
    isFinalApproval: true,
    // Explicit discriminator (compatibility version 0 until NEW integration).
    routingMode: 'CUSTOM_PERSON' as const,
  }))

  await tx.request_approvals.createMany({ data: approvals })

  return approvals
}

/**
 * Create hierarchy-based final approval chain
 * Uses department's approval hierarchy (like Phase 3)
 */
async function createHierarchyFinalApprovalChain(
  tx: any,
  requestId: string,
  departmentId: string,
  initiatorId: string
) {
  // Get initiator's level
  const initiator = await tx.user.findUnique({
    where: { id: initiatorId },
    select: { level: true },
  })

  const initiatorLevel = normalizeSubmitterLevel(initiator?.level)
  const maxLevel = validateApprovalLevel(await getMaxValidLevelInDepartment(tx, departmentId))

  const approvals = []
  let order = 1

  // If initiator is top-level, auto-approve
  if (initiatorLevel >= maxLevel) {
    approvals.push({
      requestId,
      requiredLevel: maxLevel,
      order: 1,
      status: 'approved' as const,
      approverId: initiatorId,
      approvedAt: new Date(),
      comments: 'Auto-approved (top-level initiator)',
      isCustomChain: false,
      isFinalApproval: true,
    })
  } else {
    // Create approvals for all levels between initiator and max level
    for (const level of getApprovalLevelsAboveSubmitter(initiatorLevel, maxLevel)) {
      const requiredLevel = validateApprovalLevel(level)

      const hasUsersAtLevel = await tx.user.findFirst({
        where: {
          departmentId,
          level: requiredLevel,
          isActive: true,
        },
        select: { id: true },
      })

      if (hasUsersAtLevel) {
        approvals.push({
          requestId,
          requiredLevel,
          order: order++,
          status: 'pending' as const,
          isCustomChain: false,
          isFinalApproval: true,
        })
      }
    }
  }

  if (approvals.length > 0) {
    await tx.request_approvals.createMany({ data: approvals })
  }

  return approvals
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
          departmentId: true,
        },
      },
    },
  })

  if (!nextApproval) return

  // For custom chain: notify specific requiredApproverId
  if (nextApproval.isCustomChain && nextApproval.requiredApproverId) {
    notifications.user({
      userId: nextApproval.requiredApproverId,
      type: 'final_approval_needed',
      title: 'Final Approval Needed',
      message: `Request "${nextApproval.request.title}" needs your final approval.`,
      requestId,
    })
    return
  }

  // For hierarchy chain: notify all users at requiredLevel in request's department
  if (nextApproval.requiredLevel && nextApproval.request.departmentId) {
    // The departmentId truthiness guard keeps a missing legacy department from
    // being queried as an audience (never notify departmentless users).
    const approvers = await tx.user.findMany({
      where: {
        departmentId: nextApproval.request.departmentId,
        level: nextApproval.requiredLevel,
        isActive: true,
      },
      select: { id: true },
    })

    for (const approver of approvers) {
      notifications.user({
        userId: approver.id,
        type: 'final_approval_needed',
        title: 'Final Approval Needed',
        message: `Request "${nextApproval.request.title}" needs your final approval.`,
        requestId,
      })
    }
  }
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
    select: { id: true, level: true, departmentId: true },
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
  if (!canApprove || !approval) {
    throw new Error('You cannot approve this request at this time')
  }

  // Check for stale data if expectedUpdatedAt is provided
  if (expectedUpdatedAt) {
    const request = await prisma.requests.findUnique({
      where: { id: requestId },
      select: { updatedAt: true },
    })

    if (request && isStaleData(request.updatedAt, expectedUpdatedAt)) {
      return { success: false, stale: true, message: 'This request was updated by another user.' }
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
        select: { title: true, departmentId: true },
      })
      if (!request) {
        throw new Error('Request not found')
      }
      if (request.departmentId) {
        const engineeringDept = await tx.departments.findFirst({
          where: { type: 'ENGINEERING' },
          select: { id: true },
        })
        const engineeringUsers = engineeringDept
          ? await tx.user.findMany({
              where: { departmentId: engineeringDept.id },
              select: { id: true },
            })
          : []
        const engineeringUserIds = engineeringUsers.map((u) => u.id)
        notifications.department(
          request.departmentId,
          {
            type: 'approval_granted',
            title: 'Request Completed',
            message: `✅ Request Completed: "${request.title}" has been fully approved and completed.`,
            requestId,
          },
          engineeringUserIds,
        )
      }
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
  if (!canApprove || !approval) {
    throw new Error('You cannot reject this request at this time')
  }

  // Check for stale data if expectedUpdatedAt is provided
  if (expectedUpdatedAt) {
    const request = await prisma.requests.findUnique({
      where: { id: requestId },
      select: { updatedAt: true },
    })

    if (request && isStaleData(request.updatedAt, expectedUpdatedAt)) {
      return { success: false, stale: true, message: 'This request was updated by another user.' }
    }
  }

  // Keep workflow writes atomic; both department notification plans are
  // dispatched concurrently only after this transaction commits.
  await runSolutionTransactionWithNotifications(async (tx, notifications) => {
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
      select: { title: true, departmentId: true },
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

    // Return request to SentToEngineer status for engineering revision
    await tx.requests.update({
      where: { id: requestId },
      data: { status: RequestStatus.SentToEngineer },
    })

    // Atomic status-change audit for the reopened engineering cycle. The
    // engineering resolution trend aggregates status_changed activities, so
    // this row (written in the same transaction as the status update) makes
    // the rejection visible as a new rework cycle for that request.
    // canUserApproveFinalApproval guarantees the request is in FinalApproval,
    // recorded here as the authoritative fromStatus.
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

    // Get engineering department to notify all engineers
    const engineeringDept = await tx.departments.findFirst({
      where: { type: 'ENGINEERING' },
      select: { id: true },
    })

    if (engineeringDept && request) {
      notifications.department(
        engineeringDept.id,
        {
          type: 'approval_rejected',
          title: 'Final Approval Rejected',
          message: `❌ Final Rejection: "${request.title}" was rejected during final approval. Reason: "${comments}". Please revise the solution.`,
          requestId,
        },
        [userId],
      )

      // Also notify requester's department about the rejection (excluding
      // the rejector if they're in that department).
      if (request.departmentId) {
        notifications.department(
          request.departmentId,
          {
            type: 'status_changed',
            title: 'Final Approval Rejected',
            message: `❌ Final Approval Rejected: "${request.title}" was rejected during final approval. The request has been returned to engineering for revision.`,
            requestId,
          },
          [userId],
        )
      }
    }
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
    select: { id: true, role: true, departmentId: true, level: true },
  })

  if (!user) {
    throw new Error('User not found')
  }

  if (!user.departmentId) {
    throw new Error('User must be assigned to a department to submit solutions')
  }

  if (user.role !== UserRole.engineering) {
    throw new Error('Only engineering users can resubmit solutions')
  }

  // Validate input. newFileIds / deletedFileIds / customApprovers are <= 10
  // unique UUID arrays with [] defaults; cost is positive; currency is the
  // scoped enum.
  const validated = resubmitSolutionSchema.parse(input)

  // Validate request exists and has a rejected solution
  const request = await prisma.requests.findUnique({
    where: { id: validated.requestId },
    include: {
      solutions: {
        include: {
          approvals: true,
          fileAttachments: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
      approvals: {
        where: { 
          status: 'rejected',
          isFinalApproval: true 
        },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
      department: true,
    },
  })

  if (!request) {
    throw new Error('Request not found')
  }

  // Organization-owned requests have no legacy department; legacy solution
  // resubmission is an unsupported boundary until NEW adapters are integrated.
  if (request.departmentId === null) {
    throw new Error('Organization-owned requests are not supported by legacy solution resubmission yet')
  }
  const requestDepartmentId: string = request.departmentId

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

  const prepared = await prepareInlineDescription({
    description: validated.description,
    userId: user.id,
    uploadSessionId: validated.inlineImageSessionId,
  })

  // Single transaction: update solution, validate + link staged attachments,
  // delete selected attachments, reset the approval chain, and transition
  // status. Physical file cleanup and queued notification delivery run only
  // AFTER this commits, so slow/failing I/O cannot expire or roll back it.
  // Rollout gate: creation only. Legacy (the default) and shadow keep the
  // existing delete-and-rebuild behavior exactly; new mode is denied until
  // Task 15 activation.
  const rolloutMode = getApprovalRolloutMode(process.env)
  const result = await runSolutionTransactionWithNotifications(async (tx, notifications) => {
    // Update solution details
    const updatedSolution = await tx.solutions.update({
      where: { id: solution.id },
      data: {
        title: validated.title,
        description: prepared.html,
        costEstimate: validated.cost,
        currency: validated.currency,
        timeline: validated.timeline,
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

    // Rollout gate resolved above; new mode is denied until Task 15 activation.
    let isAutoApproved: boolean
    let submittedCustomApprovers: string[] | null = null
    let firstPendingLevel: number | null = null

    if (rolloutMode === 'new') {
      // Denied until Task 15 activation support exists; throws before any NEW
      // write and rolls the resubmission back (no rows deleted).
      await assertNewCreationEnabled(tx)
      const phaseDb = createPrismaPhaseAdapterDb(tx)
      if (validated.useCustomHierarchy && validated.customApprovers.length > 0) {
        // Custom ordered-person chain: preserved validators, never
        // auto-approved.
        const orderedApprovers = sanitizeCustomChainOrder(
          validated.customApprovers,
          userId,
          'Custom approval chain must have at least one approver after removing submitter',
        )
        await assertCustomApproversExist(tx, orderedApprovers)
        await createCustomPersonAttempt(phaseDb, {
          requestId: validated.requestId,
          solutionId: solution.id,
          phase: 'SOLUTION',
          initiatorId: userId,
          orderedApproverIds: orderedApprovers,
        })
        isAutoApproved = false
        submittedCustomApprovers = validated.customApprovers
        // Single status writer: the adapter applies and guards
        // DesignCostEstimationApproval from the document's actual status
        // (SentToEngineer, or DesignCostEstimationApproval on the
        // rejected-solution route, where it correctly no-ops); no
        // action-level CAS here.
      } else {
        const attempt = await createSolutionApprovalAttempt(phaseDb, {
          requestId: validated.requestId,
          solutionId: solution.id,
          submittedById: userId,
        })
        isAutoApproved = attempt.autoApproved || attempt.completedWithoutSteps
        if (isAutoApproved && attempt.statusChange) {
          await tx.requests.update({
            where: { id: validated.requestId },
            data: { projectEstimateCost: validated.cost },
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
          // Queue requester-department notification for post-commit dispatch.
          notifications.department(requestDepartmentId, {
            type: 'solution_ready',
            title: 'Solution Ready for Review',
            message: `📤 Ready for Review: "${request.title}" solution has been updated and is ready for your department's final review.`,
            requestId: validated.requestId,
          })
        }
        // Pending NEW attempts: approver notifications resolve from candidate
        // groups in Tasks 9/10 and are intentionally not invented here.
      }
    } else {
    if (rolloutMode === 'shadow') {
      await compareNewResolutionWithoutWrites(createApprovalEngineDb(tx), {
        phase: 'SOLUTION',
        requestId: validated.requestId,
        solutionId: solution.id,
        originUserId: userId,
      })
    }

    // Delete old rejected approvals
    await tx.solution_approvals.deleteMany({
      where: {
        solutionId: solution.id,
      },
    })

    // Create new approval chain
    const approvalData = []
    
    if (validated.useCustomHierarchy && validated.customApprovers.length > 0) {
      // Custom approval chain
      validated.customApprovers.forEach((approverId, index) => {
        approvalData.push({
          solutionId: solution.id,
          requiredApproverId: approverId,
          order: index + 1,
          status: 'pending',
          isCustomChain: true,
          // Explicit discriminator (compatibility version 0 until NEW
          // integration); the default would misclassify the row and violate
          // the row-mode integrity check.
          routingMode: 'CUSTOM_PERSON' as const,
        })
      })
    } else {
      // Get engineering department ID for hierarchy-based approvals
      const engineeringDept = await tx.departments.findFirst({
        where: { type: 'ENGINEERING' },
        select: { id: true },
      })

      if (!engineeringDept) {
        throw new Error('Engineering department not found')
      }

      // Create hierarchy-based approval chain directly (not using createHierarchyApprovalChain to avoid double creation)
      const maxLevel = validateApprovalLevel(
        await getMaxValidLevelInDepartment(tx, engineeringDept.id),
      )
      const submitterLevel = normalizeSubmitterLevel(user.level)

      // If submitter is top-level, create auto-approved record
      if (submitterLevel >= maxLevel) {
        approvalData.push({
          solutionId: solution.id,
          requiredLevel: maxLevel,
          order: 1,
          status: 'approved' as const,
          approverId: userId,
          approvedAt: new Date(),
          comments: 'Auto-approved (top-level submitter)',
          isCustomChain: false,
        })
      } else {
        // Create approvals for all levels between submitter and max level
        let order = 1
        for (const level of getApprovalLevelsAboveSubmitter(submitterLevel, maxLevel)) {
          const requiredLevel = validateApprovalLevel(level)

          // Check if there are active users at this level
          const hasUsersAtLevel = await tx.user.findFirst({
            where: {
              departmentId: engineeringDept.id,
              level: requiredLevel,
              isActive: true,
            },
            select: { id: true },
          })

          if (hasUsersAtLevel) {
            approvalData.push({
              solutionId: solution.id,
              requiredLevel,
              order: order++,
              status: 'pending' as const,
              isCustomChain: false,
            })
          }
        }
      }
    }

    await tx.solution_approvals.createMany({
      data: approvalData,
    })

    // Check if solution was auto-approved (top-level submitter with hierarchy)
    isAutoApproved = approvalData.some(a => a.status === 'approved')

    // Update request status
    const newStatus = isAutoApproved 
      ? RequestStatus.SendBackToRequester 
      : RequestStatus.DesignCostEstimationApproval

    // Update request status via the shared expected-status guard. Solution
    // resubmission legitimately starts from SentToEngineer (rejected
    // solution or rejected final approval) and from the legacy
    // DesignCostEstimationApproval-with-rejection route; `Cancelled` (and
    // every other status) is never accepted, so a requester cancellation
    // that committed first makes this match zero rows and throw, rolling
    // back the solution update and the new approval chain.
    await updateRequestStatusExpecting(tx, {
      requestId: validated.requestId,
      expectedStatuses: [
        RequestStatus.SentToEngineer,
        RequestStatus.DesignCostEstimationApproval,
      ],
      data: {
        status: newStatus,
        ...(isAutoApproved ? { projectEstimateCost: validated.cost } : {}),
        updatedAt: new Date(),
      },
      actionLabel: 'resubmit solution',
    })

    // Add activity log
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

    // If auto-approved, notify requester's department
    if (isAutoApproved) {
      await tx.request_activities.create({
        data: {
          requestId: validated.requestId,
          userId: request.requesterId,
          action: 'status_changed',
          fromStatus: RequestStatus.SentToEngineer,
          toStatus: RequestStatus.SendBackToRequester,
          comments: `Solution "${validated.title}" resubmitted and auto-approved (top-level submitter). Request sent back to requester for final review.`,
        },
      })

      // Queue requester-department notification for post-commit dispatch.
      notifications.department(requestDepartmentId, {
        type: 'solution_ready',
        title: 'Solution Ready for Review',
        message: `📤 Ready for Review: "${request.title}" solution has been updated and is ready for your department's final review.`,
        requestId: validated.requestId,
      })
    }

    const firstPendingApproval = approvalData.find((a) => a.status === 'pending')
    firstPendingLevel =
      firstPendingApproval && 'requiredLevel' in firstPendingApproval
        ? firstPendingApproval.requiredLevel ?? null
        : null
    }

    return {
      updatedSolution,
      deletedAttachments: deletableAttachments,
      firstPendingLevel,
      isAutoApproved,
      submittedCustomApprovers,
    }
  })

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
    
    if (validated.useCustomHierarchy && validated.customApprovers.length > 0) {
      // Notify custom approvers
      for (const approverId of validated.customApprovers) {
        await createNotification({
          userId: approverId,
          type: 'approval_needed',
          title: 'Solution Resubmitted',
          message: `📤 Solution resubmitted for "${request.title}". Please review the updated solution.`,
          requestId: validated.requestId,
        })
      }
    } else if (rolloutMode !== 'new') {
      // Notify engineering department approvers at the first *actual* pending level
      // from the chain just created (empty levels are skipped during creation).
      const engineeringDept = await prisma.departments.findFirst({
        where: { type: 'ENGINEERING' },
        select: { id: true },
      })

      if (engineeringDept && result.firstPendingLevel != null) {
        const { getApproversAtLevel } = await import('./approvals')
        const firstLevelApprovers = await getApproversAtLevel(
          engineeringDept.id,
          result.firstPendingLevel,
        )

        // Notify each approver
        for (const approver of firstLevelApprovers) {
          await createNotification({
            userId: approver.id,
            type: 'approval_needed',
            title: 'Solution Resubmitted',
            message: `📤 Solution resubmitted for "${request.title}". Please review the updated solution.`,
            requestId: request.id,
          })
        }
      }
    }
    // NEW normal pending: approver notifications resolve from candidate
    // groups in Tasks 9/10 and are intentionally not invented here.
  }

  revalidateRequestViews()

  return {
    success: true,
    solutionId: result.updatedSolution.id,
    deletedAttachmentIds: deletedAttachments.map(a => a.id),
    cleanupWarnings,
  }
}
