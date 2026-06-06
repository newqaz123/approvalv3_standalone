'use server'

import prisma from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { getCurrentUser } from '@/lib/cache/user-cache'
import { revalidateRequestViews } from './request-view-invalidation'
import {
  canManageEngineeringSubTasks,
  isSubTaskVisibleForRequestStatus,
  validateSubTaskInput,
} from '@/lib/engineering-sub-tasks'

type ActionResult<T = undefined> = T extends undefined
  ? { success: true } | { success: false; error: string }
  : { success: true; data: T } | { success: false; error: string }

async function requireSubTaskManager() {
  const user = await getCurrentUser()
  if (!user || !canManageEngineeringSubTasks(user)) {
    throw new Error('Only engineering and admin users can manage sub-tasks')
  }

  return user
}

async function requireVisibleStageRequest(requestId: string) {
  const request = await prisma.requests.findUnique({
    where: { id: requestId },
    select: { id: true, status: true },
  })

  if (!request) throw new Error('Request not found')
  if (!isSubTaskVisibleForRequestStatus(request.status)) {
    throw new Error('Sub-tasks are not available for this request stage')
  }

  return request
}

async function getStage(stageId: string) {
  const stage = await prisma.sub_task_stages.findUnique({
    where: { id: stageId },
    select: { id: true, isOthers: true, isActive: true },
  })

  if (!stage || !stage.isActive) throw new Error('Selected stage is not available')
  return stage
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
      select: { id: true, name: true },
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
    await requireVisibleStageRequest(input.requestId)
    const stage = await getStage(input.stageId)
    const validation = validateSubTaskInput({
      description: input.description,
      stageIsOthers: stage.isOthers,
      customStageText: input.customStageText,
    })
    if (!validation.success) return validation

    const subTask = await prisma.request_sub_tasks.create({
      data: {
        requestId: input.requestId,
        description: input.description.trim(),
        stageId: input.stageId,
        customStageText: validation.customStageText,
        subContractorId: input.subContractorId || null,
        createdById: user.id,
        updatedById: user.id,
      },
      select: { id: true },
    })

    revalidateRequestViews(input.requestId)
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
    await requireVisibleStageRequest(existing.requestId)
    const stage = await getStage(input.stageId)
    const validation = validateSubTaskInput({
      description: input.description,
      stageIsOthers: stage.isOthers,
      customStageText: input.customStageText,
    })
    if (!validation.success) return validation

    await prisma.request_sub_tasks.update({
      where: { id: input.id },
      data: {
        description: input.description.trim(),
        stageId: input.stageId,
        customStageText: validation.customStageText,
        subContractorId: input.subContractorId || null,
        updatedById: user.id,
      },
    })

    revalidateRequestViews(existing.requestId)
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
    await requireVisibleStageRequest(existing.requestId)

    await prisma.request_sub_tasks.update({
      where: { id },
      data: {
        isCompleted: completed,
        completedAt: completed ? new Date() : null,
        completedById: completed ? user.id : null,
        updatedById: user.id,
      },
    })

    revalidateRequestViews(existing.requestId)
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to update completion' }
  }
}

export async function deleteSubTask(id: string): Promise<ActionResult> {
  try {
    await requireSubTaskManager()
    const existing = await prisma.request_sub_tasks.findUnique({
      where: { id },
      select: { requestId: true },
    })
    if (!existing) throw new Error('Sub-task not found')
    await requireVisibleStageRequest(existing.requestId)

    await prisma.request_sub_tasks.delete({ where: { id } })

    revalidateRequestViews(existing.requestId)
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to delete sub-task' }
  }
}

export async function toggleWorkRequisitionReceived(requestId: string, received: boolean): Promise<ActionResult> {
  try {
    const user = await requireSubTaskManager()
    await requireVisibleStageRequest(requestId)

    await prisma.requests.update({
      where: { id: requestId },
      data: {
        workRequisitionReceived: received,
        workRequisitionReceivedAt: received ? new Date() : null,
        workRequisitionReceivedById: received ? user.id : null,
      },
    })

    revalidateRequestViews(requestId)
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

export async function deactivateSubContractor(id: string): Promise<ActionResult> {
  try {
    const user = await requireSubTaskManager()
    await prisma.sub_contractors.update({
      where: { id },
      data: { isActive: false, updatedById: user.id },
    })

    revalidatePath('/engineering')
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to deactivate subcontractor' }
  }
}

export async function getStaleSubTaskRequests(input: { olderThanDays?: number; stageId?: string }) {
  const user = await getCurrentUser()
  if (!user || !canManageEngineeringSubTasks(user)) return []
  if (!input.olderThanDays || input.olderThanDays <= 0) return []

  const threshold = new Date()
  threshold.setDate(threshold.getDate() - input.olderThanDays)

  return prisma.requests.findMany({
    where: {
      isDeleted: false,
      status: { in: ['SentToEngineer', 'SendBackToRequester', 'FinalApproval', 'Completed'] as any },
      subTasks: {
        some: {
          isCompleted: false,
          updatedAt: { lte: threshold },
          ...(input.stageId ? { stageId: input.stageId } : {}),
        },
      },
    },
    select: {
      id: true,
      title: true,
      status: true,
      department: { select: { name: true } },
      requester: { select: { name: true } },
      subTasks: {
        where: {
          isCompleted: false,
          updatedAt: { lte: threshold },
          ...(input.stageId ? { stageId: input.stageId } : {}),
        },
        select: {
          id: true,
          description: true,
          updatedAt: true,
          stage: { select: { id: true, name: true } },
          subContractor: { select: { name: true } },
        },
        orderBy: { updatedAt: 'asc' },
      },
    },
    orderBy: { updatedAt: 'desc' },
  })
}
