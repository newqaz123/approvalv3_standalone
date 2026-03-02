'use client'

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Card } from '@/components/ui/card'

interface HierarchyUserCardProps {
  user: {
    id: string
    name: string
    email: string
    level: number | null
    isExternal?: boolean
  }
  isDragDisabled?: boolean
}

export function HierarchyUserCard({ user, isDragDisabled }: HierarchyUserCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
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
    </Card>
  )
}
