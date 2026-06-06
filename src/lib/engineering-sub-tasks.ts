export const ENGINEERING_SUB_TASK_VISIBLE_STATUSES = [
  'SentToEngineer',
  'SendBackToRequester',
  'FinalApproval',
  'Completed',
] as const

export type WorkRequisitionFilter = 'all' | 'not-received' | 'received'

export function isSubTaskVisibleForRequestStatus(status: string): boolean {
  return ENGINEERING_SUB_TASK_VISIBLE_STATUSES.includes(status as (typeof ENGINEERING_SUB_TASK_VISIBLE_STATUSES)[number])
}

export function canManageEngineeringSubTasks(user?: { role?: string | null; isActive?: boolean | null } | null): boolean {
  if (user?.isActive === false) return false
  return user?.role === 'engineering' || user?.role === 'admin'
}

export function filterRowsByWorkRequisition<T extends { workRequisitionReceived?: boolean }>(
  rows: T[],
  filter: WorkRequisitionFilter | undefined
): T[] {
  if (!filter || filter === 'all') return rows
  if (filter === 'received') return rows.filter((row) => row.workRequisitionReceived === true)
  return rows.filter((row) => row.workRequisitionReceived !== true)
}

export function getWorkRequisitionLabel(received?: boolean): 'WR received' | 'No WR' {
  return received ? 'WR received' : 'No WR'
}

export function getSubTaskSummary(subTasks: Array<{ isCompleted: boolean }>) {
  const total = subTasks.length
  const completed = subTasks.filter((task) => task.isCompleted).length

  return {
    total,
    completed,
    label: `${completed}/${total} complete`,
  }
}

export function isSubTaskStale(
  subTask: {
    isCompleted: boolean
    updatedAt: Date | string
    stage?: { id: string; name: string } | null
  },
  options: {
    olderThanDays?: number
    stageId?: string
    now?: Date
  }
): boolean {
  if (subTask.isCompleted) return false
  if (!options.olderThanDays || options.olderThanDays <= 0) return false
  if (options.stageId && subTask.stage?.id !== options.stageId) return false

  const now = options.now ?? new Date()
  const updatedAt = typeof subTask.updatedAt === 'string' ? new Date(subTask.updatedAt) : subTask.updatedAt
  const threshold = new Date(now)
  threshold.setDate(threshold.getDate() - options.olderThanDays)

  return updatedAt <= threshold
}

export function validateSubTaskInput(input: {
  description?: string
  stageIsOthers: boolean
  customStageText?: string | null
}): { success: true; customStageText: string | null } | { success: false; error: string } {
  if (!input.description?.trim()) {
    return { success: false, error: 'Description is required' }
  }

  if (input.stageIsOthers) {
    const customStageText = input.customStageText?.trim()
    if (!customStageText) {
      return { success: false, error: 'Custom stage text is required when stage is Others' }
    }
    return { success: true, customStageText }
  }

  return { success: true, customStageText: null }
}
