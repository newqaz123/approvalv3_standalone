'use client'

import { useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import {
  ChevronDown,
  ClipboardCheck,
  FileText,
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
import { Progress } from '@/components/ui/progress'
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
  createdBy?: { id: string; name: string } | null
  updatedBy?: { id: string; name: string } | null
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
  onChanged: () => void | Promise<void>
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
  const [isOpen, setIsOpen] = useState(false)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [pendingWr, setPendingWr] = useState(false)
  const summary = getSubTaskSummary(subTasks)
  const wrLabel = getWorkRequisitionLabel(workRequisitionReceived)
  const wrTooltip = workRequisitionReceived
    ? 'Work requisition received'
    : 'Work requisition not received'
  const progressValue = summary.total === 0
    ? 0
    : Math.round((summary.completed / summary.total) * 100)

  const runTaskAction = async (id: string, action: () => Promise<{ success: boolean; error?: string }>) => {
    setPendingId(id)
    const result = await action()
    if (result.success) {
      await onChanged()
      setPendingId(null)
      return
    }
    setPendingId(null)
    toast.error(result.error || 'Failed to update sub-task')
  }

  const handleToggleWorkRequisition = async (received: boolean) => {
    setPendingWr(true)
    const result = await toggleWorkRequisitionReceived(requestId, received)
    if (result.success) {
      await onChanged()
      setPendingWr(false)
      return
    }
    setPendingWr(false)
    toast.error(result.error || 'Failed to update WR status')
  }

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
      <CollapsibleTrigger className="group flex w-full items-center justify-between gap-3 bg-slate-50 px-4 py-3 text-left transition-colors hover:bg-slate-100 dark:bg-slate-800/50 dark:hover:bg-slate-800">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <ListChecks className="h-4 w-4 shrink-0 text-slate-500" />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <p className="text-sm font-bold text-slate-800 dark:text-slate-200">Sub-tasks</p>
              <Badge variant="secondary" className="h-6 rounded-md text-xs">
                {summary.label}
              </Badge>
            </div>
            <Progress
              value={progressValue}
              className="mt-2 h-1.5 max-w-xs bg-slate-200 [&>div]:bg-emerald-500"
              aria-label={`Sub-task progress ${summary.completed} of ${summary.total} completed`}
            />
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge variant="outline" className={cn(
            'h-6 rounded-md text-xs gap-1',
            workRequisitionReceived
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
              : 'border-slate-200 bg-white text-slate-500 dark:bg-slate-900'
          )} title={wrTooltip}>
            <FileText className="h-3.5 w-3.5" />
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
                                className="text-slate-400 hover:text-blue-600"
                              />
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                aria-label="Delete sub-task"
                                title="Delete sub-task"
                                className="h-8 w-8 text-slate-400 hover:text-red-600"
                                disabled={isPending}
                                onClick={() => runTaskAction(task.id, () => deleteSubTask(task.id))}
                              >
                                <Trash2 className="h-4 w-4" />
                                <span className="sr-only">Delete</span>
                              </Button>
                            </div>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                          <span>{task.subContractor?.name ?? 'No subcontractor'}</span>
                          <Badge variant="secondary" className="rounded-md">
                            {stageText}
                          </Badge>
                          <span>
                            Last edited by {task.updatedBy?.name ?? task.createdBy?.name ?? 'Unknown'}{' '}
                            {formatDistanceToNow(new Date(task.updatedAt), { addSuffix: true })}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          {canManage && (
            <div className="flex justify-start pt-1">
              <SubTaskFormDialog
                requestId={requestId}
                stages={stages}
                subcontractors={subcontractors}
                onChanged={onChanged}
              />
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
