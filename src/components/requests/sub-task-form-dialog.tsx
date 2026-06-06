'use client'

import { useEffect, useMemo, useState } from 'react'
import { Pencil, Plus } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { createSubTask, updateSubTask } from '@/server-actions/engineering-sub-tasks'
import { cn } from '@/lib/utils'

export interface SubTaskStageOption {
  id: string
  name: string
  isOthers: boolean
}

export interface SubContractorOption {
  id: string
  name: string
}

export interface EditableSubTask {
  id: string
  description: string
  customStageText?: string | null
  stage: SubTaskStageOption
  subContractor?: SubContractorOption | null
}

interface SubTaskFormDialogProps {
  requestId: string
  stages: SubTaskStageOption[]
  subcontractors: SubContractorOption[]
  task?: EditableSubTask
  onChanged: () => void
  className?: string
}

const NO_SUBCONTRACTOR = 'none'

export function SubTaskFormDialog({
  requestId,
  stages,
  subcontractors,
  task,
  onChanged,
  className,
}: SubTaskFormDialogProps) {
  const [open, setOpen] = useState(false)
  const [description, setDescription] = useState('')
  const [stageId, setStageId] = useState('')
  const [customStageText, setCustomStageText] = useState('')
  const [subContractorId, setSubContractorId] = useState(NO_SUBCONTRACTOR)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedStage = useMemo(
    () => stages.find((stage) => stage.id === stageId),
    [stageId, stages]
  )

  useEffect(() => {
    if (!open) return

    setDescription(task?.description ?? '')
    setStageId(task?.stage.id ?? stages[0]?.id ?? '')
    setCustomStageText(task?.customStageText ?? '')
    setSubContractorId(task?.subContractor?.id ?? NO_SUBCONTRACTOR)
    setError(null)
  }, [open, stages, task])

  const handleSubmit = async () => {
    setSubmitting(true)
    setError(null)

    const input = {
      description,
      stageId,
      customStageText: selectedStage?.isOthers ? customStageText : null,
      subContractorId: subContractorId === NO_SUBCONTRACTOR ? null : subContractorId,
    }

    const result = task
      ? await updateSubTask({ id: task.id, ...input })
      : await createSubTask({ requestId, ...input })

    setSubmitting(false)

    if (!result.success) {
      setError(result.error)
      return
    }

    setOpen(false)
    onChanged()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant={task ? 'ghost' : 'outline'}
          className={cn(task ? 'h-8 px-2' : 'gap-2', className)}
        >
          {task ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          <span>{task ? 'Edit' : 'Add sub-task'}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{task ? 'Edit sub-task' : 'Add sub-task'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
              Description
            </label>
            <Textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={3}
              placeholder="Describe the engineering follow-up work"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Stage
              </label>
              <Select value={stageId} onValueChange={setStageId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select stage" />
                </SelectTrigger>
                <SelectContent>
                  {stages.map((stage) => (
                    <SelectItem key={stage.id} value={stage.id}>
                      {stage.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Subcontractor
              </label>
              <Select value={subContractorId} onValueChange={setSubContractorId}>
                <SelectTrigger>
                  <SelectValue placeholder="No subcontractor" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_SUBCONTRACTOR}>No subcontractor</SelectItem>
                  {subcontractors.map((subcontractor) => (
                    <SelectItem key={subcontractor.id} value={subcontractor.id}>
                      {subcontractor.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {selectedStage?.isOthers && (
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Custom stage text
              </label>
              <Input
                value={customStageText}
                onChange={(event) => setCustomStageText(event.target.value)}
                placeholder="Type the custom stage"
              />
            </div>
          )}

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || !description.trim() || !stageId || (selectedStage?.isOthers && !customStageText.trim())}
          >
            {submitting ? 'Saving...' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
