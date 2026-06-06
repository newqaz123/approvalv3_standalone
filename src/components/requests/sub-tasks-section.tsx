'use client'

import { useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import {
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  ListChecks,
  Trash2,
} from 'lucide-react'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Separator } from '@/components/ui/separator'
import {
  deleteSubTask,
  setSubTaskCompleted,
  toggleWorkRequisitionReceived,
} from '@/server-actions/engineering-sub-tasks'
import {
  getSubTaskSummary,
  getWorkRequisitionLabel,
} from '@/lib/engineering-sub-tasks'
import { toast } from 'sonner'
import {
  SubContractorOption,
  SubTaskFormDialog,
  SubTaskStageOption,
} from './sub-task-form-dialog'
import { cn } from '@/lib/utils'

interface RequestSubTask {
  id: string
  description: string
  customStageText?: string | null
  isCompleted: boolean
  updatedAt: Date | string
  stage: SubTaskStageOption
  subContractor?: SubContractorOption | null
}

interface SubTasksSectionProps {
  requestId: string
  subTasks: RequestSubTask[]
  workRequisitionReceived?: boolean
  stages: SubTaskStageOption[]
  subcontractors: SubContractorOption[]
  canManage: boolean
  onChanged: () => void
}

export function SubTasksSection({
  requestId,
  subTasks,
  workRequisitionReceived,
  stages,
  subcontractors,
  canManage,
  onChanged,
}: SubTasksSectionProps) {
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [pendingWr, setPendingWr] = useState(false)
  const summary = getSubTaskSummary(subTasks)
  const wrLabel = getWorkRequisitionLabel(workRequisitionReceived)

  const runTaskAction = async (id: string, action: () => Promise<{ success: boolean; error?: string }>) => {
    setPendingId(id)
    const result = await action()
    setPendingId(null)
    if (result.success) {
      onChanged()
      return
    }
    toast.error(result.error || 'Failed to update sub-task')
  }

  const handleToggleWorkRequisition = async (received: boolean) => {
    setPendingWr(true)
    const result = await toggleWorkRequisitionReceived(requestId, received)
    setPendingWr(false)
    if (result.success) {
      onChanged()
      return
    }
    toast.error(result.error || 'Failed to update WR status')
  }

  return (
    <Collapsible defaultOpen={false} className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
      <CollapsibleTrigger className="group flex w-full items-center justify-between gap-3 bg-slate-50 px-4 py-3 text-left transition-colors hover:bg-slate-100 dark:bg-slate-800/50 dark:hover:bg-slate-800">
        <div className="flex min-w-0 items-center gap-3">
          <ListChecks className="h-4 w-4 shrink-0 text-slate-500" />
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <p className="text-sm font-bold text-slate-800 dark:text-slate-200">Sub-tasks</p>
              <Badge variant="secondary" className="h-6 rounded-md text-xs">
                {summary.label}
              </Badge>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge variant="outline" className={cn(
            'h-6 rounded-md text-xs',
            workRequisitionReceived
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
              : 'border-slate-200 bg-white text-slate-500 dark:bg-slate-900'
          )}>
            {wrLabel}
          </Badge>
          <ChevronDown className="h-4 w-4 text-slate-400 transition-transform group-data-[state=open]:rotate-180" />
        </div>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="space-y-4 bg-white p-4 dark:bg-slate-950">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <label className={cn(
              'flex items-center gap-2 text-sm font-medium',
              canManage ? 'text-slate-700 dark:text-slate-300' : 'text-slate-500'
            )}>
              <Checkbox
                checked={!!workRequisitionReceived}
                disabled={!canManage || pendingWr}
                onCheckedChange={(checked) => handleToggleWorkRequisition(checked === true)}
              />
              <span>Work requisition received</span>
            </label>
            {canManage && (
              <SubTaskFormDialog
                requestId={requestId}
                stages={stages}
                subcontractors={subcontractors}
                onChanged={onChanged}
              />
            )}
          </div>

          <Separator />

          {subTasks.length === 0 ? (
            <div className="flex items-center gap-2 rounded-lg border border-dashed border-slate-200 p-4 text-sm text-slate-500 dark:border-slate-800">
              <ClipboardCheck className="h-4 w-4" />
              <span>No sub-tasks yet</span>
            </div>
          ) : (
            <div className="space-y-3">
              {subTasks.map((task) => {
                const stageText = task.stage.isOthers && task.customStageText
                  ? task.customStageText
                  : task.stage.name
                const isPending = pendingId === task.id

                return (
                  <div
                    key={task.id}
                    data-testid="sub-task-card"
                    className="rounded-lg border border-slate-200 p-3 dark:border-slate-800"
                  >
                    <div className="flex items-start gap-3">
                      <Checkbox
                        checked={task.isCompleted}
                        disabled={!canManage || isPending}
                        className="mt-0.5"
                        onCheckedChange={(checked) => {
                          if (!canManage) return
                          runTaskAction(task.id, () => setSubTaskCompleted(task.id, checked === true))
                        }}
                      />
                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                          <p className={cn(
                            'text-sm font-medium leading-6 text-slate-900 dark:text-slate-100',
                            task.isCompleted && 'text-slate-500 line-through'
                          )}>
                            {task.description}
                          </p>
                          {canManage && (
                            <div className="flex shrink-0 items-center gap-1">
                              <SubTaskFormDialog
                                requestId={requestId}
                                stages={stages}
                                subcontractors={subcontractors}
                                task={task}
                                onChanged={onChanged}
                              />
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="h-8 px-2 text-red-600 hover:text-red-700"
                                disabled={isPending}
                                onClick={() => runTaskAction(task.id, () => deleteSubTask(task.id))}
                              >
                                <Trash2 className="h-4 w-4" />
                                <span>Delete</span>
                              </Button>
                            </div>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                          <Badge variant="secondary" className="rounded-md">
                            {stageText}
                          </Badge>
                          <span>{task.subContractor?.name ?? 'No subcontractor'}</span>
                          {task.isCompleted && (
                            <span className="inline-flex items-center gap-1 text-emerald-600">
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              Completed
                            </span>
                          )}
                        </div>

                        <p className="text-xs text-slate-400">
                          Last edited {formatDistanceToNow(new Date(task.updatedAt), { addSuffix: true })}
                        </p>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
