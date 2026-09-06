'use client'

import { useState } from 'react'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ORGANIZATION_POSITION_LEVEL } from '@/lib/organization/types'
import type { OrganizationPositionCode } from '@/lib/organization/types'
import type { ApprovalRouteStepDefinition } from '@/lib/approval-routes/types'

/** Exact position labels from the approved ladder (Staff (1) .. Factory Manager (6)). */
export const ROUTE_POSITION_LABELS: Record<OrganizationPositionCode, string> = {
  STAFF: 'Staff (1)',
  SUPERVISOR: 'Supervisor (2)',
  SECTION_MANAGER: 'Section Manager (3)',
  DEPARTMENT_MANAGER: 'Department Manager (4)',
  DIVISION_MANAGER: 'Division Manager (5)',
  FACTORY_MANAGER: 'Factory Manager (6)',
}

interface RouteStepListProps {
  steps: ApprovalRouteStepDefinition[]
  onReorder: (steps: ApprovalRouteStepDefinition[]) => void
}

function SortableStepRow({ step }: { step: ApprovalRouteStepDefinition }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: step.position,
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <li
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 rounded-md border bg-card px-3 py-2"
      {...attributes}
      {...listeners}
    >
      <span className="cursor-grab text-muted-foreground active:cursor-grabbing" aria-hidden="true">
        ⠿
      </span>
      <span className="text-sm font-medium">{step.order}.</span>
      <span className="text-sm">{ROUTE_POSITION_LABELS[step.position]}</span>
    </li>
  )
}

/**
 * Ordered route positions with drag reordering. A drag that would create a
 * downward order (a position placed below a higher position) is rejected
 * with a visible validation error: the previous order stays untouched
 * because route definitions must be strictly ascending.
 */
export function RouteStepList({ steps, onReorder }: RouteStepListProps) {
  const [orderError, setOrderError] = useState<string | null>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) {
      setOrderError(null)
      return
    }
    const fromIndex = steps.findIndex((step) => step.position === active.id)
    const toIndex = steps.findIndex((step) => step.position === over.id)
    if (fromIndex < 0 || toIndex < 0) return
    const reordered = arrayMove(steps, fromIndex, toIndex).map((step, index) => ({
      ...step,
      order: index + 1,
    }))

    for (let index = 1; index < reordered.length; index += 1) {
      const previousLevel = ORGANIZATION_POSITION_LEVEL[reordered[index - 1].position]
      const level = ORGANIZATION_POSITION_LEVEL[reordered[index].position]
      if (level <= previousLevel) {
        setOrderError(
          `${ROUTE_POSITION_LABELS[reordered[index].position]} cannot be ordered below ` +
            `${ROUTE_POSITION_LABELS[reordered[index - 1].position]}: route steps must stay ` +
            'strictly ascending. The reorder was not applied.',
        )
        return
      }
    }

    setOrderError(null)
    onReorder(reordered)
  }

  if (steps.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No positions configured yet. Add positions in ascending order.
      </p>
    )
  }

  return (
    <div className="space-y-2">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={steps.map((step) => step.position)} strategy={verticalListSortingStrategy}>
          <ul className="space-y-2">
            {steps.map((step) => (
              <SortableStepRow key={step.position} step={step} />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      {orderError ? (
        <p role="alert" className="text-sm font-medium text-red-600">
          {orderError}
        </p>
      ) : null}
    </div>
  )
}
