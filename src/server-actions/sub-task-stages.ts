'use server'

import { revalidatePath } from 'next/cache'
import prisma from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth'

type StageActionResult = { success: true } | { success: false; error: string }

async function requireAdminUser() {
  const adminId = await requireAdmin()
  if (!adminId) {
    throw new Error('Admin access required')
  }
  return adminId
}

async function stageNameExists(name: string, excludeId?: string) {
  const existing = await prisma.sub_task_stages.findUnique({
    where: { name },
    select: { id: true },
  })

  return !!existing && existing.id !== excludeId
}

export async function getSubTaskStagesForAdmin() {
  await requireAdminUser()

  return prisma.sub_task_stages.findMany({
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    select: {
      id: true,
      name: true,
      sortOrder: true,
      isDefault: true,
      isOthers: true,
      isActive: true,
    },
  })
}

async function getNextSortOrder() {
  const lastStage = await prisma.sub_task_stages.findFirst({
    orderBy: { sortOrder: 'desc' },
    select: { sortOrder: true },
  })

  return (lastStage?.sortOrder ?? 0) + 10
}

export async function updateSubTaskStage(input: {
  id: string
  name: string
  isActive: boolean
}): Promise<StageActionResult> {
  try {
    await requireAdminUser()
    const trimmed = input.name.trim()
    if (!trimmed) return { success: false, error: 'Stage name is required' }

    const existing = await prisma.sub_task_stages.findUnique({
      where: { id: input.id },
      select: { isOthers: true, name: true },
    })

    if (existing?.isOthers && trimmed !== existing.name) {
      return { success: false, error: 'Others stage cannot be renamed' }
    }

    if (existing?.isOthers && !input.isActive) {
      return { success: false, error: 'Others stage cannot be deactivated' }
    }

    if (await stageNameExists(trimmed, input.id)) {
      return { success: false, error: 'Stage name already exists' }
    }

    await prisma.sub_task_stages.update({
      where: { id: input.id },
      data: {
        name: trimmed,
        isActive: input.isActive,
      },
    })

    revalidatePath('/admin/sub-task-stages')
    revalidatePath('/engineering')
    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update stage',
    }
  }
}

export async function createSubTaskStage(input: {
  name: string
}): Promise<StageActionResult> {
  try {
    await requireAdminUser()
    const trimmed = input.name.trim()
    if (!trimmed) return { success: false, error: 'Stage name is required' }

    if (await stageNameExists(trimmed)) {
      return { success: false, error: 'Stage name already exists' }
    }

    await prisma.sub_task_stages.create({
      data: {
        name: trimmed,
        sortOrder: await getNextSortOrder(),
        isDefault: false,
        isOthers: false,
        isActive: true,
      },
    })

    revalidatePath('/admin/sub-task-stages')
    revalidatePath('/engineering')
    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create stage',
    }
  }
}

export async function deactivateSubTaskStage(id: string): Promise<StageActionResult> {
  try {
    await requireAdminUser()
    const stage = await prisma.sub_task_stages.findUnique({
      where: { id },
      select: { isOthers: true, name: true },
    })

    if (!stage) return { success: false, error: 'Stage not found' }
    if (stage.name === 'Completed') {
      return { success: false, error: 'Completed stage cannot be deactivated' }
    }
    if (stage?.isOthers) {
      return { success: false, error: 'Others stage cannot be deactivated' }
    }

    await prisma.sub_task_stages.update({
      where: { id },
      data: { isActive: false },
    })

    revalidatePath('/admin/sub-task-stages')
    revalidatePath('/engineering')
    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to deactivate stage',
    }
  }
}

export async function activateSubTaskStage(id: string): Promise<StageActionResult> {
  try {
    await requireAdminUser()

    await prisma.sub_task_stages.update({
      where: { id },
      data: { isActive: true },
    })

    revalidatePath('/admin/sub-task-stages')
    revalidatePath('/engineering')
    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to activate stage',
    }
  }
}

export async function deleteSubTaskStage(id: string): Promise<StageActionResult> {
  try {
    await requireAdminUser()
    const stage = await prisma.sub_task_stages.findUnique({
      where: { id },
      select: {
        isDefault: true,
        isOthers: true,
        name: true,
        _count: { select: { subTasks: true } },
      },
    })

    if (!stage) return { success: false, error: 'Stage not found' }
    if (stage.name === 'Completed') {
      return { success: false, error: 'Completed stage cannot be deleted' }
    }
    if (stage.isOthers) {
      return { success: false, error: 'Others stage cannot be deleted' }
    }
    if (stage._count.subTasks > 0) {
      return { success: false, error: 'Stage is used by sub-tasks and cannot be deleted' }
    }

    await prisma.sub_task_stages.delete({ where: { id } })

    revalidatePath('/admin/sub-task-stages')
    revalidatePath('/engineering')
    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete stage',
    }
  }
}
