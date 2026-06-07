'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { GripVertical, MoreHorizontal, Plus, Power, RotateCcw, Save, Trash2 } from 'lucide-react'
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
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  activateSubTaskStage,
  createSubTaskStage,
  deactivateSubTaskStage,
  deleteSubTaskStage,
  updateSubTaskStage,
} from '@/server-actions/sub-task-stages'

interface SubTaskStage {
  id: string
  name: string
  sortOrder: number
  isDefault: boolean
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
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [isCreating, startCreating] = useTransition()

  useEffect(() => {
    setStages(initialStages)
  }, [initialStages])

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

  const handleActivate = async (stage: SubTaskStage) => {
    setPendingId(stage.id)
    const result = await activateSubTaskStage(stage.id)
    setPendingId(null)

    if (!result.success) {
      toast.error(result.error)
      return
    }

    updateLocalStage(stage.id, { isActive: true })
    toast.success('Sub-task stage activated')
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

  const handleDelete = async (stage: SubTaskStage) => {
    setPendingId(stage.id)
    const result = await deleteSubTaskStage(stage.id)
    setPendingId(null)

    if (!result.success) {
      toast.error(result.error)
      return
    }

    setStages((current) => current.filter((item) => item.id !== stage.id))
    toast.success('Sub-task stage deleted')
    router.refresh()
  }

  const handleCreate = () => {
    startCreating(async () => {
      const result = await createSubTaskStage({
        name: newName,
      })

      if (!result.success) {
        toast.error(result.error)
        return
      }

      setNewName('')
      toast.success('Sub-task stage created')
      router.refresh()
    })
  }

  return (
    <div className="space-y-6">
      <Card role="region" aria-label="Add stage card">
        <CardHeader className="p-6 pb-3">
          <CardTitle className="text-base">Add stage</CardTitle>
          <CardDescription>Create a stage for engineering sub-task follow-up.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 p-6 pt-0 md:grid-cols-[1fr_auto]">
          <Input
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder="New stage name"
            aria-label="New sub-task stage name"
            className="h-11"
          />
          <Button
            type="button"
            onClick={handleCreate}
            disabled={isCreating || !newName.trim()}
            className="h-10 gap-2"
          >
            <Plus className="h-4 w-4" />
            Add stage
          </Button>
        </CardContent>
      </Card>

      <Card role="region" aria-label="Stage list card">
        <CardHeader className="p-6 pb-3">
          <CardTitle className="text-base">Stage list</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 p-6 pt-0">
          {stages.map((stage) => {
            const isPending = pendingId === stage.id
            const isCompletedDefaultStage = stage.name === 'Completed'

            return (
              <div
                key={stage.id}
                className="grid min-h-[68px] gap-3 rounded-lg border bg-background p-3 md:grid-cols-[auto_1fr_auto_auto_auto] md:items-center"
              >
                <div
                  className="flex h-10 w-8 items-center justify-center text-muted-foreground"
                  aria-label="Drag handle"
                  title="Drag handle"
                >
                  <GripVertical className="h-5 w-5" />
                </div>

                <div className="flex min-w-0 flex-col gap-2 md:flex-row md:items-center">
                  <Input
                    value={stage.name}
                    disabled={stage.isOthers}
                    onChange={(event) => updateLocalStage(stage.id, { name: event.target.value })}
                    aria-label={`Name for ${stage.name}`}
                    className="h-11 md:max-w-xl"
                  />
                  {isCompletedDefaultStage && (
                    <Badge variant="outline" className="w-fit">Default</Badge>
                  )}
                  {stage.isOthers && (
                    <Badge variant="secondary" className="w-fit">Others</Badge>
                  )}
                </div>

                <Badge
                  variant={stage.isActive ? 'secondary' : 'outline'}
                  className={stage.isActive ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-50' : 'text-muted-foreground'}
                >
                  {stage.isActive ? 'Active' : 'Inactive'}
                </Badge>

                <Button
                  type="button"
                  variant="outline"
                  onClick={() => handleSave(stage)}
                  disabled={isPending || !stage.name.trim()}
                  className="h-10 gap-2"
                >
                  <Save className="h-4 w-4" />
                  Save changes
                </Button>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-10 w-10"
                      aria-label={`More actions for ${stage.name}`}
                      disabled={isPending}
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-[160px]">
                    <DropdownMenuItem
                      onClick={() => handleActivate(stage)}
                      disabled={isPending || stage.isActive}
                    >
                      <RotateCcw className="mr-2 h-4 w-4" />
                      Activate
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => handleDeactivate(stage)}
                      disabled={isPending || stage.isOthers || isCompletedDefaultStage || !stage.isActive}
                    >
                      <Power className="mr-2 h-4 w-4" />
                      Deactivate
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => handleDelete(stage)}
                      disabled={isPending || stage.isOthers || isCompletedDefaultStage}
                      className="text-red-600 focus:text-red-600"
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )
          })}
        </CardContent>
      </Card>
    </div>
  )
}
