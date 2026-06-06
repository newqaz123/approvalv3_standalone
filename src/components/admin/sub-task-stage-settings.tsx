'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Save, Power } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import {
  createSubTaskStage,
  deactivateSubTaskStage,
  updateSubTaskStage,
} from '@/server-actions/sub-task-stages'

interface SubTaskStage {
  id: string
  name: string
  sortOrder: number
  isOthers: boolean
  isActive: boolean
}

interface SubTaskStageSettingsProps {
  initialStages: SubTaskStage[]
}

export function SubTaskStageSettings({ initialStages }: SubTaskStageSettingsProps) {
  const router = useRouter()
  const [stages, setStages] = useState(initialStages)
  const [newName, setNewName] = useState('')
  const [newSortOrder, setNewSortOrder] = useState(() => {
    const maxSortOrder = initialStages.reduce((max, stage) => Math.max(max, stage.sortOrder), 0)
    return String(maxSortOrder + 10)
  })
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [isCreating, startCreating] = useTransition()

  const updateLocalStage = (id: string, patch: Partial<SubTaskStage>) => {
    setStages((current) => current.map((stage) => (
      stage.id === id ? { ...stage, ...patch } : stage
    )))
  }

  const handleSave = async (stage: SubTaskStage) => {
    setPendingId(stage.id)
    const result = await updateSubTaskStage({
      id: stage.id,
      name: stage.name,
      sortOrder: stage.sortOrder,
      isActive: stage.isActive,
    })
    setPendingId(null)

    if (!result.success) {
      toast.error(result.error)
      return
    }

    toast.success('Sub-task stage updated')
    router.refresh()
  }

  const handleDeactivate = async (stage: SubTaskStage) => {
    setPendingId(stage.id)
    const result = await deactivateSubTaskStage(stage.id)
    setPendingId(null)

    if (!result.success) {
      toast.error(result.error)
      return
    }

    updateLocalStage(stage.id, { isActive: false })
    toast.success('Sub-task stage deactivated')
    router.refresh()
  }

  const handleCreate = () => {
    startCreating(async () => {
      const result = await createSubTaskStage({
        name: newName,
        sortOrder: Number(newSortOrder),
      })

      if (!result.success) {
        toast.error(result.error)
        return
      }

      setNewName('')
      setNewSortOrder(String(Number(newSortOrder || 0) + 10))
      toast.success('Sub-task stage created')
      router.refresh()
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sub-task stages</CardTitle>
        <CardDescription>
          Manage the shared global stage list engineers use for request sub-tasks.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 rounded-lg border bg-muted/30 p-4 md:grid-cols-[1fr_140px_auto]">
          <Input
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder="New stage name"
            aria-label="New sub-task stage name"
          />
          <Input
            type="number"
            value={newSortOrder}
            onChange={(event) => setNewSortOrder(event.target.value)}
            placeholder="Sort order"
            aria-label="New sub-task stage sort order"
          />
          <Button
            type="button"
            onClick={handleCreate}
            disabled={isCreating || !newName.trim() || !newSortOrder}
            className="gap-2"
          >
            <Plus className="h-4 w-4" />
            Add stage
          </Button>
        </div>

        <div className="space-y-3">
          {stages.map((stage) => {
            const isPending = pendingId === stage.id

            return (
              <div
                key={stage.id}
                className="grid gap-3 rounded-lg border p-4 md:grid-cols-[1fr_120px_120px_auto_auto]"
              >
                <div className="space-y-1">
                  <Input
                    value={stage.name}
                    onChange={(event) => updateLocalStage(stage.id, { name: event.target.value })}
                    aria-label={`Name for ${stage.name}`}
                  />
                  {stage.isOthers && (
                    <Badge variant="secondary">Others</Badge>
                  )}
                </div>

                <Input
                  type="number"
                  value={stage.sortOrder}
                  onChange={(event) => updateLocalStage(stage.id, { sortOrder: Number(event.target.value) })}
                  aria-label={`Sort order for ${stage.name}`}
                />

                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Checkbox
                    checked={stage.isActive}
                    disabled={stage.isOthers}
                    onCheckedChange={(checked) => updateLocalStage(stage.id, { isActive: checked === true })}
                  />
                  <span>Active</span>
                </label>

                <Button
                  type="button"
                  variant="outline"
                  onClick={() => handleSave(stage)}
                  disabled={isPending || !stage.name.trim()}
                  className="gap-2"
                >
                  <Save className="h-4 w-4" />
                  Save
                </Button>

                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => handleDeactivate(stage)}
                  disabled={isPending || stage.isOthers || !stage.isActive}
                  title={stage.isOthers ? 'Others stage cannot be deactivated' : 'Deactivate stage'}
                  className="gap-2 text-muted-foreground"
                >
                  <Power className="h-4 w-4" />
                  Deactivate
                </Button>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
