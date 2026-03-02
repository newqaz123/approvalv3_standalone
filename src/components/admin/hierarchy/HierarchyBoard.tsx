'use client'

import { useState, useEffect } from 'react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { updateUserLevel, updateHierarchy } from '@/server-actions/hierarchy'

interface HierarchyUser {
  id: string
  name: string
  email: string
  level: number | null
  isExternal?: boolean
}

interface HierarchyBoardProps {
  department: {
    id: string
    name: string
    type: string
    levelNames?: Record<string, string> | null
  }
  initialUsersByLevel: Record<number, HierarchyUser[]>
  maxLevel: number
  pendingApprovalsCount: number
  readOnly?: boolean
}

function UserCard({
  user,
  isDragDisabled,
}: {
  user: HierarchyUser
  isDragDisabled?: boolean
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: user.id,
    disabled: isDragDisabled,
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <Card
      ref={setNodeRef}
      style={style}
      className={`p-3 cursor-grab active:cursor-grabbing ${
        isDragging ? 'shadow-lg ring-2 ring-blue-400' : ''
      } ${isDragDisabled ? 'cursor-not-allowed opacity-60' : ''}`}
      {...attributes}
      {...listeners}
    >
      <p className="font-medium text-sm">{user.name}</p>
      <p className="text-xs text-muted-foreground truncate">{user.email}</p>
      {user.isExternal && (
        <Badge variant="secondary" className="mt-1 text-xs">
          External
        </Badge>
      )}
    </Card>
  )
}

function LevelColumn({
  level,
  users,
  isDragDisabled,
  customLabel,
}: {
  level: number
  users: HierarchyUser[]
  isDragDisabled?: boolean
  customLabel?: string
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: `level-${level}`,
    data: { level },
    disabled: isDragDisabled,
  })

  const displayLabel = customLabel || `Level ${level}`

  return (
    <div className="flex flex-col min-w-[200px] max-w-[280px]">
      <div className="bg-slate-100 rounded-t-lg p-3 border-b">
        <h3 className="font-semibold text-sm">Level {level}</h3>
        <p className="text-xs text-muted-foreground">{displayLabel}</p>
        <p className="text-xs text-muted-foreground mt-1">
          {users.length} user{users.length !== 1 ? 's' : ''}
        </p>
      </div>

      <div
        ref={setNodeRef}
        className={`flex-1 p-2 space-y-2 min-h-[200px] rounded-b-lg border border-t-0 transition-colors ${
          isOver && !isDragDisabled ? 'bg-blue-50 border-blue-300' : 'bg-slate-50'
        }`}
      >
        <SortableContext items={users.map(u => u.id)} strategy={verticalListSortingStrategy}>
          {users.map(user => (
            <UserCard key={user.id} user={user} isDragDisabled={isDragDisabled} />
          ))}
        </SortableContext>

        {users.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-4">No users at this level</p>
        )}
      </div>
    </div>
  )
}

export function HierarchyBoard({
  department,
  initialUsersByLevel,
  maxLevel,
  pendingApprovalsCount,
  readOnly = false,
}: HierarchyBoardProps) {
  const [usersByLevel, setUsersByLevel] = useState(initialUsersByLevel)
  const [isBlocked, setIsBlocked] = useState(pendingApprovalsCount > 0)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  useEffect(() => {
    setUsersByLevel(initialUsersByLevel)
    setIsBlocked(pendingApprovalsCount > 0)
  }, [initialUsersByLevel, pendingApprovalsCount])

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event

    if (!over || isBlocked || readOnly) return

    const targetLevelStr = over.id.toString()
    if (!targetLevelStr.startsWith('level-')) return

    const targetLevel = parseInt(targetLevelStr.replace('level-', ''), 10)
    const userId = active.id.toString()

    // Find current level and user
    let currentLevel: number | null = null
    let user: HierarchyUser | null = null
    for (const [level, users] of Object.entries(usersByLevel)) {
      const found = users.find(u => u.id === userId)
      if (found) {
        currentLevel = parseInt(level, 10)
        user = found
        break
      }
    }

    if (!currentLevel || !user || currentLevel === targetLevel) return

    // Optimistic update
    const previousState = { ...usersByLevel }
    setUsersByLevel(prev => {
      const newState = { ...prev }
      newState[currentLevel!] = newState[currentLevel!].filter(u => u.id !== userId)
      newState[targetLevel] = [...(newState[targetLevel] || []), { ...user!, level: targetLevel }]
      return newState
    })

    // Call appropriate server action based on user type
    try {
      let result: { success: boolean; error?: string }

      if (user.isExternal) {
        result = await updateHierarchy(department.id, [
          { userId, level: targetLevel, isExternal: true },
        ])
      } else {
        result = await updateUserLevel(userId, targetLevel)
      }

      if (!result.success) {
        setUsersByLevel(previousState)
        toast.error(result.error || 'Failed to update level')
        if (result.error?.includes('pending approvals')) {
          setIsBlocked(true)
        }
      } else {
        toast.success(`Moved ${user.name} to Level ${targetLevel}`)
      }
    } catch (error) {
      setUsersByLevel(previousState)
      const message = error instanceof Error ? error.message : 'Failed to update level'
      toast.error(message)
    }
  }

  const levels = Array.from({ length: maxLevel }, (_, i) => i + 1)
  const levelNames = department.levelNames as Record<string, string> | null | undefined

  const content = (
    <div className="space-y-4">
      {!readOnly && isBlocked && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Hierarchy Changes Blocked</AlertTitle>
          <AlertDescription>
            Cannot modify hierarchy - {pendingApprovalsCount} request(s) have pending approvals.
            Complete or cancel pending requests first.
          </AlertDescription>
        </Alert>
      )}

      <div className="flex gap-4 overflow-x-auto pb-4">
        {levels.map(level => (
          <LevelColumn
            key={level}
            level={level}
            users={usersByLevel[level] || []}
            isDragDisabled={isBlocked || readOnly}
            customLabel={
              levelNames ? (levelNames[level.toString()] ?? levelNames[level as unknown as string]) : undefined
            }
          />
        ))}
      </div>

      {!readOnly && !isBlocked && (
        <p className="text-sm text-muted-foreground">
          Drag users between levels to update their approval hierarchy position. External approvers
          (from other departments) are shown with an &quot;External&quot; badge.
        </p>
      )}
    </div>
  )

  if (readOnly) {
    return content
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      {content}
    </DndContext>
  )
}
