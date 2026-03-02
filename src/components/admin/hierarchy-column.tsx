'use client'

import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { HierarchyUserCard } from './hierarchy-user-card'

interface User {
  id: string
  name: string
  email: string
  level: number | null
  isExternal?: boolean
}

interface HierarchyColumnProps {
  level: number
  users: User[]
  isDragDisabled?: boolean
  customLabel?: string
}

export function HierarchyColumn({ level, users, isDragDisabled, customLabel }: HierarchyColumnProps) {
  const { isOver, setNodeRef } = useDroppable({
    id: `level-${level}`,
    data: { level },
    disabled: isDragDisabled,
  })

  // Use custom label if provided, otherwise fall back to "Level N"
  const displayLabel = customLabel || `Level ${level}`

  return (
    <div className="flex flex-col min-w-[200px] max-w-[280px]">
      <div className="bg-slate-100 rounded-t-lg p-3 border-b">
        <h3 className="font-semibold text-sm">Level {level}</h3>
        <p className="text-xs text-muted-foreground">
          {displayLabel}
        </p>
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
        <SortableContext
          items={users.map(u => u.id)}
          strategy={verticalListSortingStrategy}
        >
          {users.map((user) => (
            <HierarchyUserCard
              key={user.id}
              user={user}
              isDragDisabled={isDragDisabled}
            />
          ))}
        </SortableContext>

        {users.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-4">
            No users at this level
          </p>
        )}
      </div>
    </div>
  )
}
