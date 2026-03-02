'use client'

import { useState, useEffect, useMemo } from 'react'
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
import { HierarchyColumn } from './hierarchy-column'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { updateHierarchy } from '@/server-actions/hierarchy'
import { format } from 'date-fns'
import { Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'

interface User {
  id: string
  name: string
  email: string
  level: number | null
  isExternal?: boolean
}

interface HierarchyChangeRecord {
  id: string
  adminName: string
  targetUserName: string
  oldLevel: number | null
  newLevel: number
  change: string
  timestamp: Date
}

interface HierarchyViewProps {
  department: {
    id: string
    name: string
    type: string
    levelNames?: Record<string, string> | null
  }
  initialUsersByLevel: Record<number, User[]>
  maxLevel: number
  pendingApprovalsCount: number
  changeHistory?: HierarchyChangeRecord[]
  readOnly?: boolean
}

export function HierarchyView({
  department,
  initialUsersByLevel,
  maxLevel,
  pendingApprovalsCount,
  changeHistory,
  readOnly = false,
}: HierarchyViewProps) {
  const [usersByLevel, setUsersByLevel] = useState(initialUsersByLevel)
  const [isSaving, setIsSaving] = useState(false)
  const router = useRouter()

  // Track changes by comparing current state with initial state
  const hasChanges = useMemo(() => {
    // Deep compare usersByLevel with initialUsersByLevel
    for (const level of Object.keys(usersByLevel)) {
      const levelNum = parseInt(level, 10)
      const currentUsers = usersByLevel[levelNum] || []
      const initialUsers = initialUsersByLevel[levelNum] || []

      // If lengths differ, there's a change
      if (currentUsers.length !== initialUsers.length) {
        return true
      }

      // Compare each user's level
      for (const user of currentUsers) {
        const initialUser = initialUsers.find(u => u.id === user.id)
        if (!initialUser || initialUser.level !== user.level) {
          return true
        }
      }
    }
    return false
  }, [usersByLevel, initialUsersByLevel])

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  // Update when props change
  useEffect(() => {
    setUsersByLevel(initialUsersByLevel)
  }, [initialUsersByLevel])

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event

    if (!over || readOnly) return

    // Get target level from droppable id (e.g., "level-2")
    const targetLevelStr = over.id.toString()
    if (!targetLevelStr.startsWith('level-')) return

    const targetLevel = parseInt(targetLevelStr.replace('level-', ''), 10)
    const userId = active.id.toString()

    // Find current level and user
    let currentLevel: number | null = null
    let user: User | null = null
    for (const [level, users] of Object.entries(usersByLevel)) {
      const found = users.find(u => u.id === userId)
      if (found) {
        currentLevel = parseInt(level, 10)
        user = found
        break
      }
    }

    if (!currentLevel || !user || currentLevel === targetLevel) return

    // Optimistic update (local state only - no server call)
    setUsersByLevel(prev => {
      const newState = { ...prev }
      newState[currentLevel!] = newState[currentLevel!].filter(u => u.id !== userId)
      newState[targetLevel] = [...(newState[targetLevel] || []), { ...user!, level: targetLevel }]
      return newState
    })
  }

  function resetChanges() {
    // Revert to initial state
    setUsersByLevel(initialUsersByLevel)
    toast.success('Changes reset')
  }

  async function handleSave() {
    if (isSaving) return

    setIsSaving(true)

    try {
      // Calculate diffs - find users who changed levels
      const updates: Array<{ userId: string; level: number | null; isExternal?: boolean }> = []
      const processedUserIds = new Set<string>()

      for (const [level, currentUsers] of Object.entries(usersByLevel)) {
        const levelNum = parseInt(level, 10)
        const initialUsers = initialUsersByLevel[levelNum] || []

        for (const currentUser of currentUsers) {
          const initialUser = initialUsers.find(u => u.id === currentUser.id)

          // Check if this user changed level (new to this bucket or level property changed)
          if (!initialUser || initialUser.level !== currentUser.level) {
            updates.push({
              userId: currentUser.id,
              level: currentUser.level,
              isExternal: currentUser.isExternal,
            })
          }
          // Track all users found in current state so we know who was moved vs removed
          processedUserIds.add(currentUser.id)
        }
      }

      // Also check for users truly removed (exist in initial but not anywhere in current state)
      for (const level of Object.keys(initialUsersByLevel)) {
        const levelNum = parseInt(level, 10)
        const initialUsers = initialUsersByLevel[levelNum] || []

        for (const initialUser of initialUsers) {
          // Skip users already processed - they moved to a different level, not removed
          if (processedUserIds.has(initialUser.id)) continue

          if (initialUser.level !== null) {
            // User was truly removed from hierarchy (not in any current level)
            updates.push({
              userId: initialUser.id,
              level: null,
              isExternal: initialUser.isExternal,
            })
          }
        }
      }

      if (updates.length === 0) {
        toast.info('No changes to save')
        setIsSaving(false)
        return
      }

      // Call updateHierarchy with all updates
      const result = await updateHierarchy(department.id, updates)

      if (!result.success) {
        toast.error(result.error || 'Failed to save hierarchy changes')
        // Don't refresh on error - user can fix and retry
      } else {
        toast.success('Hierarchy saved successfully')
        // Refresh the page to show updated data
        router.refresh()
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save hierarchy'
      toast.error(message)
    } finally {
      setIsSaving(false)
    }
  }

  // Generate level columns (1 to maxLevel)
  const levels = Array.from({ length: maxLevel }, (_, i) => i + 1)

  // Parse levelNames from department prop (JSON field from Prisma)
  const levelNames = department.levelNames as Record<string, string> | null | undefined

  const content = (
    <div className="space-y-4">
      <div className="flex gap-4 overflow-x-auto pb-4">
        {levels.map((level) => (
          <HierarchyColumn
            key={level}
            level={level}
            users={usersByLevel[level] || []}
            isDragDisabled={readOnly}
            customLabel={levelNames ? (levelNames[level.toString()] ?? levelNames[level as unknown as string]) : undefined}
          />
        ))}
      </div>

      {!readOnly && (
        <p className="text-sm text-muted-foreground">
          Drag users between levels to update their approval hierarchy position.
        </p>
      )}

      {readOnly && (
        <p className="text-sm text-muted-foreground">
          This is a read-only view of the approval hierarchy.
        </p>
      )}

      {!readOnly && changeHistory && changeHistory.length > 0 && (
        <div className="mt-6 border-t pt-4">
          <h3 className="text-sm font-medium mb-2">Recent Changes</h3>
          <div className="space-y-2">
            {changeHistory.map((change) => (
              <div key={change.id} className="text-sm">
                <span className="text-muted-foreground">
                  {format(new Date(change.timestamp), 'MMM d, yyyy HH:mm')}
                </span>
                {' — '}
                <span className="font-medium">{change.adminName}</span>
                {' changed '}
                <span className="font-medium">{change.targetUserName}</span>
                {' from Level '}
                <span className="font-mono bg-gray-100 px-1 rounded">{change.oldLevel || '?'}</span>
                {' to Level '}
                <span className="font-mono bg-gray-100 px-1 rounded">{change.newLevel}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {!readOnly && hasChanges && (
        <div className="sticky bottom-4 left-0 right-0 z-10 bg-background border-t p-4 shadow-lg">
          <div className="flex items-center justify-center gap-4">
            <div className="flex items-center gap-2 text-sm">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              <span className="text-muted-foreground">You have unsaved changes</span>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={resetChanges}
                disabled={isSaving}
              >
                Reset
              </Button>
              <Button
                onClick={handleSave}
                disabled={isSaving}
              >
                {isSaving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  'Save Changes'
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )

  // In read-only mode, render without DndContext (no drag-and-drop)
  if (readOnly) {
    return content
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      {content}
    </DndContext>
  )
}
