'use server'

import prisma from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { getCurrentUser } from '@/lib/cache/user-cache'
import { createSolutionWorkActorDb, isActorSolutionWorker } from '@/lib/solution-work-actor'
import { revalidateRequestViews } from './request-view-invalidation'
import {
  canManageEngineeringSubTasks,
  isSubTaskVisibleForRequestStatus,
  validateSubTaskInput,
} from '@/lib/engineering-sub-tasks'
import { canUserViewRequest } from '@/lib/request-visibility/scope'
import {
  evaluateRequestAction,
  existingManageSubTasksDecision,
} from '@/lib/action-permissions'

type ActionResult<T = undefined> = T extends undefined
  ? { success: true } | { success: false; error: string }
  : { success: true; data: T } | { success: false; error: string }

async function requireSubTaskManager() {
  const user = await getCurrentUser()
  if (!user) throw new Error('Only engineering and admin users can manage sub-tasks')
  const isSolutionWorker = await isActorSolutionWorker(createSolutionWorkActorDb(prisma), user.id)
  if (!canManageEngineeringSubTasks({ ...user, isSolutionWorker })) {
    throw new Error('Only engineering and admin users can manage sub-tasks')
  }

  return { ...user, isSolutionWorker }
}

async function requireVisibleStageRequest(requestId: string) {
  const user = await getCurrentUser()
  // The all-request tracking option is read-only, not sub-task/WR access.
  // Solution workers keep sub-task/WR access through every sub-task stage.
  if (!user || !(await canUserViewRequest(user.id, requestId, { includeEngineeringViewAll: false, includeSubTaskWork: true }))) {
    throw new Error('Request not found')
  }

  const request = await prisma.requests.findUnique({
    where: { id: requestId },
    select: { id: true, status: true, isDeleted: true },
  })

  if (!request || request.isDeleted) throw new Error('Request not found')
  if (!isSubTaskVisibleForRequestStatus(request.status)) {
    throw new Error('Sub-tasks are not available for this request stage')
  }

  return request
}

function assertCanManageSubTasks(
  user: { id: string; role: string; isActive?: boolean | null; isSolutionWorker: boolean },
  request: { requesterId?: string | null; organizationUnitId?: string | null; status: string },
) {
  const manageAction = evaluateRequestAction('MANAGE_SUB_TASKS', {
    actor: {
      id: user.id,
      isActive: user.isActive !== false,
      assignmentUnitId: null,
    },
    request: {
      requesterId: request.requesterId ?? '',
      organizationUnitId: request.organizationUnitId ?? null,
      status: request.status,
    },
    canView: true,
    approval: null,
    assignedEngineer: false,
    existingActionDecisions: {
      MANAGE_SUB_TASKS: existingManageSubTasksDecision({
        userRole: user.role,
        isActive: user.isActive,
        isSolutionWorker: user.isSolutionWorker,
        status: request.status,
      }),
    },
  })
  if (!manageAction.allowed) {
    throw new Error('Only engineering and admin users can manage sub-tasks')
  }
}

async function getStage(stageId: string) {
  const stage = await prisma.sub_task_stages.findUnique({
    where: { id: stageId },
    select: { id: true, isOthers: true, isActive: true },
  })

  if (!stage || !stage.isActive) throw new Error('Selected stage is not available')
  return stage
}

async function getActiveSubContractor(subContractorId?: string | null) {
  if (!subContractorId) return null

  const contractor = await prisma.sub_contractors.findUnique({
    where: { id: subContractorId },
    select: { id: true, isActive: true },
  })

  if (!contractor || !contractor.isActive) throw new Error('Selected subcontractor is not available')
  return contractor.id
}

export async function getEngineeringSubTaskOptions() {
  const [stages, subcontractors] = await Promise.all([
    prisma.sub_task_stages.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, isOthers: true },
    }),
    prisma.sub_contractors.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, isActive: true },
    }),
  ])

  return { stages, subcontractors }
}

export async function createSubTask(input: {
  requestId: string
  description: string
  stageId: string
  customStageText?: string | null
  subContractorId?: string | null
}): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireSubTaskManager()
    const request = await requireVisibleStageRequest(input.requestId)
    assertCanManageSubTasks(user, request)
    const stage = await getStage(input.stageId)
    const validation = validateSubTaskInput({
      description: input.description,
      stageIsOthers: stage.isOthers,
      customStageText: input.customStageText,
    })
    if (!validation.success) return validation
    const subContractorId = await getActiveSubContractor(input.subContractorId)

    const subTask = await prisma.request_sub_tasks.create({
      data: {
        requestId: input.requestId,
        description: input.description.trim(),
        stageId: input.stageId,
        customStageText: validation.customStageText,
        subContractorId,
        createdById: user.id,
        updatedById: user.id,
      },
      select: { id: true },
    })

    revalidateRequestViews()
    return { success: true, data: subTask }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to create sub-task' }
  }
}

export async function updateSubTask(input: {
  id: string
  description: string
  stageId: string
  customStageText?: string | null
  subContractorId?: string | null
}): Promise<ActionResult> {
  try {
    const user = await requireSubTaskManager()
    const existing = await prisma.request_sub_tasks.findUnique({
      where: { id: input.id },
      select: { requestId: true },
    })
    if (!existing) throw new Error('Sub-task not found')
    const request = await requireVisibleStageRequest(existing.requestId)
    assertCanManageSubTasks(user, request)
    const stage = await getStage(input.stageId)
    const validation = validateSubTaskInput({
      description: input.description,
      stageIsOthers: stage.isOthers,
      customStageText: input.customStageText,
    })
    if (!validation.success) return validation
    const subContractorId = await getActiveSubContractor(input.subContractorId)

    await prisma.request_sub_tasks.update({
      where: { id: input.id },
      data: {
        description: input.description.trim(),
        stageId: input.stageId,
        customStageText: validation.customStageText,
        subContractorId,
        updatedById: user.id,
      },
    })

    revalidateRequestViews()
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to update sub-task' }
  }
}

export async function setSubTaskCompleted(id: string, completed: boolean): Promise<ActionResult> {
  try {
    const user = await requireSubTaskManager()
    const existing = await prisma.request_sub_tasks.findUnique({
      where: { id },
      select: { requestId: true },
    })
    if (!existing) throw new Error('Sub-task not found')
    const request = await requireVisibleStageRequest(existing.requestId)
    assertCanManageSubTasks(user, request)
    const completedStage = completed
      ? await prisma.sub_task_stages.findFirst({
          where: { name: 'Completed', isActive: true },
          select: { id: true },
        })
      : null

    if (completed && !completedStage) {
      throw new Error('Completed stage is not available')
    }

    await prisma.request_sub_tasks.update({
      where: { id },
      data: {
        isCompleted: completed,
        completedAt: completed ? new Date() : null,
        completedById: completed ? user.id : null,
        ...(completedStage ? { stageId: completedStage.id } : {}),
        updatedById: user.id,
      },
    })

    revalidateRequestViews()
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to update completion' }
  }
}

export async function deleteSubTask(id: string): Promise<ActionResult> {
  try {
    const user = await requireSubTaskManager()
    const existing = await prisma.request_sub_tasks.findUnique({
      where: { id },
      select: { requestId: true },
    })
    if (!existing) throw new Error('Sub-task not found')
    const request = await requireVisibleStageRequest(existing.requestId)
    assertCanManageSubTasks(user, request)

    await prisma.request_sub_tasks.delete({ where: { id } })

    revalidateRequestViews()
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to delete sub-task' }
  }
}

export async function toggleWorkRequisitionReceived(requestId: string, received: boolean): Promise<ActionResult> {
  try {
    const user = await requireSubTaskManager()
    const request = await requireVisibleStageRequest(requestId)
    assertCanManageSubTasks(user, request)

    await prisma.requests.update({
      where: { id: requestId },
      data: {
        workRequisitionReceived: received,
        workRequisitionReceivedAt: received ? new Date() : null,
        workRequisitionReceivedById: received ? user.id : null,
      },
    })

    revalidateRequestViews()
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to update WR status' }
  }
}

export async function createSubContractor(name: string): Promise<ActionResult<{ id: string; name: string }>> {
  try {
    const user = await requireSubTaskManager()
    const trimmed = name.trim()
    if (!trimmed) return { success: false, error: 'Subcontractor name is required' }

    const contractor = await prisma.sub_contractors.upsert({
      where: { name: trimmed },
      update: { isActive: true, updatedById: user.id },
      create: { name: trimmed, createdById: user.id, updatedById: user.id },
      select: { id: true, name: true },
    })

    revalidatePath('/engineering')
    return { success: true, data: contractor }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to create subcontractor' }
  }
}
