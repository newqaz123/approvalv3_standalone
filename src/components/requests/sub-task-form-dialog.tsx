'use client'

import { useEffect, useMemo, useState } from 'react'
import { Check, ChevronsUpDown, Pencil, Plus } from 'lucide-react'
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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { createSubContractor, createSubTask, updateSubTask } from '@/server-actions/engineering-sub-tasks'
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
  onChanged: () => void | Promise<void>
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
  const [subContractorOpen, setSubContractorOpen] = useState(false)
  const [subContractorSearch, setSubContractorSearch] = useState('')
  const [availableSubContractors, setAvailableSubContractors] = useState(subcontractors)
  const [addingSubContractor, setAddingSubContractor] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedStage = useMemo(
    () => stages.find((stage) => stage.id === stageId),
    [stageId, stages]
  )
  const sortedSubContractors = useMemo(
    () => [...availableSubContractors].sort((left, right) => left.name.localeCompare(right.name)),
    [availableSubContractors]
  )
  const filteredSubContractors = useMemo(
    () => sortedSubContractors.filter((subContractor) => fuzzyMatch(subContractor.name, subContractorSearch)),
    [sortedSubContractors, subContractorSearch]
  )
  const selectedSubContractor = sortedSubContractors.find((subContractor) => subContractor.id === subContractorId)
  const trimmedSubContractorSearch = subContractorSearch.trim()
  const canAddSubContractor = !!trimmedSubContractorSearch && !sortedSubContractors.some(
    (subContractor) => subContractor.name.toLowerCase() === trimmedSubContractorSearch.toLowerCase()
  )

  useEffect(() => {
    setAvailableSubContractors(subcontractors)
  }, [subcontractors])

  useEffect(() => {
    if (!open) return

    setDescription(task?.description ?? '')
    setStageId(task?.stage.id ?? stages[0]?.id ?? '')
    setCustomStageText(task?.customStageText ?? '')
    setSubContractorId(task?.subContractor?.id ?? NO_SUBCONTRACTOR)
    setSubContractorSearch('')
    setError(null)
  }, [open, stages, task])

  const handleCreateSubContractor = async () => {
    if (!canAddSubContractor || addingSubContractor) return

    setAddingSubContractor(true)
    setError(null)
    const result = await createSubContractor(trimmedSubContractorSearch)
    setAddingSubContractor(false)

    if (!result.success) {
      setError(result.error)
      return
    }

    setAvailableSubContractors((current) => {
      const withoutDuplicate = current.filter((subContractor) => subContractor.id !== result.data.id)
      return [...withoutDuplicate, result.data].sort((left, right) => left.name.localeCompare(right.name))
    })
    setSubContractorId(result.data.id)
    setSubContractorSearch('')
    setSubContractorOpen(false)
  }

  const handleSubContractorKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' || !canAddSubContractor) return

    event.preventDefault()
    void handleCreateSubContractor()
  }

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
    await onChanged()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          size={task ? 'icon' : 'sm'}
          variant={task ? 'ghost' : 'outline'}
          aria-label={task ? 'Edit sub-task' : undefined}
          title={task ? 'Edit sub-task' : undefined}
          className={cn(task ? 'h-8 w-8' : 'gap-2', className)}
        >
          {task ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {task ? (
            <span className="sr-only">Edit sub-task</span>
          ) : (
            <span>Add sub-task</span>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent
        className="sm:max-w-lg"
        data-testid={task ? 'edit-sub-task-dialog' : 'add-sub-task-dialog'}
      >
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
              <Popover open={subContractorOpen} onOpenChange={setSubContractorOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    role="combobox"
                    aria-label="Subcontractor"
                    aria-expanded={subContractorOpen}
                    className="w-full justify-between font-normal"
                  >
                    <span className="truncate">
                      {selectedSubContractor?.name ?? 'No subcontractor'}
                    </span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[320px] p-0" align="start">
                  <Command shouldFilter={false}>
                    <CommandInput
                      value={subContractorSearch}
                      onValueChange={setSubContractorSearch}
                      onKeyDown={handleSubContractorKeyDown}
                      placeholder="Search or add subcontractor"
                    />
                    <CommandList>
                      <CommandGroup>
                        <CommandItem
                          value={NO_SUBCONTRACTOR}
                          onSelect={() => {
                            setSubContractorId(NO_SUBCONTRACTOR)
                            setSubContractorSearch('')
                            setSubContractorOpen(false)
                          }}
                        >
                          <Check className={cn('h-4 w-4', subContractorId === NO_SUBCONTRACTOR ? 'opacity-100' : 'opacity-0')} />
                          No subcontractor
                        </CommandItem>
                        {filteredSubContractors.map((subcontractor) => (
                          <CommandItem
                            key={subcontractor.id}
                            value={subcontractor.name}
                            onSelect={() => {
                              setSubContractorId(subcontractor.id)
                              setSubContractorSearch('')
                              setSubContractorOpen(false)
                            }}
                          >
                            <Check className={cn('h-4 w-4', subContractorId === subcontractor.id ? 'opacity-100' : 'opacity-0')} />
                            {subcontractor.name}
                          </CommandItem>
                        ))}
                        {canAddSubContractor && (
                          <CommandItem
                            value={`add-${trimmedSubContractorSearch}`}
                            onSelect={() => void handleCreateSubContractor()}
                            disabled={addingSubContractor}
                          >
                            <Plus className="h-4 w-4" />
                            Add &quot;{subContractorSearch.trim()}&quot;
                          </CommandItem>
                        )}
                      </CommandGroup>
                      {filteredSubContractors.length === 0 && !canAddSubContractor && (
                        <CommandEmpty>No subcontractors found</CommandEmpty>
                      )}
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
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
            data-testid={task ? 'edit-sub-task-save' : 'add-sub-task-save'}
          >
            {submitting ? 'Saving...' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function fuzzyMatch(value: string, query: string) {
  const normalizedValue = value.toLowerCase()
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return true

  let queryIndex = 0
  for (const character of normalizedValue) {
    if (character === normalizedQuery[queryIndex]) queryIndex += 1
    if (queryIndex === normalizedQuery.length) return true
  }

  return false
}
