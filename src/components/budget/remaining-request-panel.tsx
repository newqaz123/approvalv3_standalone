'use client'

import { useDraggable } from '@dnd-kit/core'
import { ChevronLeft, ChevronRight, Edit2, GripVertical } from 'lucide-react'
import type { HTMLAttributes } from 'react'
import { Button } from '@/components/ui/button'
import type { BudgetRequestRecord } from '@/types/budget'

export function RemainingRequestCard({
  request,
  onEditProjectEstimate,
  dragging = false,
  dragHandleProps,
}: {
  request: BudgetRequestRecord
  onEditProjectEstimate?: (requestId: string, value: number | null) => void
  dragging?: boolean
  dragHandleProps?: HTMLAttributes<HTMLButtonElement>
}) {
  return (
    <div
      className={`rounded-md border border-amber-200 bg-amber-50 p-3 shadow-sm ${
        dragging ? 'cursor-grabbing shadow-lg ring-2 ring-amber-400' : ''
      }`}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          className="mt-0.5 cursor-grab rounded p-0.5 text-amber-700 hover:bg-amber-100 active:cursor-grabbing"
          title="Drag request"
          {...dragHandleProps}
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-gray-950">{request.title}</div>
          <div className="mt-1 text-xs text-gray-600">
            {request.department?.name ?? 'No department'} - {request.status}
          </div>
          <button
            type="button"
            className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-amber-900 hover:underline"
            onClick={(event) => {
              event.stopPropagation()
              onEditProjectEstimate?.(request.id, request.projectEstimateCost)
            }}
          >
            <Edit2 className="h-3 w-3" />
            Project estimate: {request.projectEstimateCost?.toLocaleString() ?? '-'}
          </button>
        </div>
      </div>
    </div>
  )
}

function DraggableRemainingRequestCard({
  request,
  onEditProjectEstimate,
}: {
  request: BudgetRequestRecord
  onEditProjectEstimate: (requestId: string, value: number | null) => void
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: request.id,
    data: { type: 'request', requestId: request.id },
  })

  return (
    <div
      ref={setNodeRef}
      className={isDragging ? 'opacity-40' : undefined}
    >
      <RemainingRequestCard
        request={request}
        onEditProjectEstimate={onEditProjectEstimate}
        dragHandleProps={{ ...attributes, ...listeners }}
      />
    </div>
  )
}

export function RemainingRequestPanel({
  requests,
  collapsed,
  onCollapsedChange,
  onEditProjectEstimate,
}: {
  requests: BudgetRequestRecord[]
  collapsed: boolean
  onCollapsedChange: (collapsed: boolean) => void
  onEditProjectEstimate: (requestId: string, value: number | null) => void
}) {
  if (collapsed) {
    return (
      <aside className="fixed bottom-4 right-4 z-40 lg:bottom-auto lg:top-24">
        <Button
          variant="outline"
          className="h-auto flex-col gap-2 bg-white px-3 py-4 shadow-lg"
          onClick={() => onCollapsedChange(false)}
        >
          <ChevronLeft className="h-4 w-4" />
          <span className="text-xs font-semibold">{requests.length} remaining</span>
        </Button>
      </aside>
    )
  }

  return (
    <aside className="fixed bottom-4 right-4 z-40 flex max-h-[min(620px,calc(100vh-7rem))] w-[min(360px,calc(100vw-2rem))] flex-col overflow-hidden rounded-lg border bg-white shadow-xl lg:bottom-auto lg:top-24">
      <div className="flex items-start justify-between gap-3 border-b bg-gray-50 p-3">
        <div>
          <h2 className="text-sm font-semibold">Remaining request list</h2>
          <p className="text-xs text-gray-500">Only unassigned visible requests appear here.</p>
        </div>
        <Button variant="ghost" size="icon" onClick={() => onCollapsedChange(true)}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
      <div className="grid gap-2 overflow-y-auto p-3">
        {requests.length === 0 ? (
          <div className="rounded-md border border-dashed p-4 text-center text-sm text-gray-500">
            No remaining requests
          </div>
        ) : (
          requests.map((request) => (
            <DraggableRemainingRequestCard
              key={request.id}
              request={request}
              onEditProjectEstimate={onEditProjectEstimate}
            />
          ))
        )}
      </div>
    </aside>
  )
}
