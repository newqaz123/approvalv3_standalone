'use client'

import { useDraggable } from '@dnd-kit/core'
import { ChevronLeft, ChevronRight, GripVertical } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { BudgetRequestRecord } from '@/types/budget'

function RemainingRequestCard({ request }: { request: BudgetRequestRecord }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: request.id,
    data: { type: 'request', requestId: request.id },
  })

  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={`rounded-md border border-amber-200 bg-amber-50 p-3 shadow-sm ${
        isDragging ? 'opacity-60' : ''
      }`}
    >
      <div className="flex items-start gap-2">
        <GripVertical className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-gray-950">{request.title}</div>
          <div className="mt-1 text-xs text-gray-600">
            {request.department?.name ?? 'No department'} - {request.status}
          </div>
          <div className="mt-1 text-xs text-amber-800">
            Estimate: {request.projectEstimateCost?.toLocaleString() ?? '-'}
          </div>
        </div>
      </div>
    </div>
  )
}

export function RemainingRequestPanel({
  requests,
  collapsed,
  onCollapsedChange,
}: {
  requests: BudgetRequestRecord[]
  collapsed: boolean
  onCollapsedChange: (collapsed: boolean) => void
}) {
  if (collapsed) {
    return (
      <aside className="sticky top-4">
        <Button
          variant="outline"
          className="h-auto flex-col gap-2 px-3 py-4"
          onClick={() => onCollapsedChange(false)}
        >
          <ChevronLeft className="h-4 w-4" />
          <span className="text-xs font-semibold">{requests.length} remaining</span>
        </Button>
      </aside>
    )
  }

  return (
    <aside className="sticky top-4 max-h-[calc(100vh-7rem)] overflow-hidden rounded-lg border bg-white shadow-sm">
      <div className="flex items-start justify-between gap-3 border-b bg-gray-50 p-3">
        <div>
          <h2 className="text-sm font-semibold">Remaining request list</h2>
          <p className="text-xs text-gray-500">Only unassigned visible requests appear here.</p>
        </div>
        <Button variant="ghost" size="icon" onClick={() => onCollapsedChange(true)}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
      <div className="grid max-h-[calc(100vh-12rem)] gap-2 overflow-y-auto p-3">
        {requests.length === 0 ? (
          <div className="rounded-md border border-dashed p-4 text-center text-sm text-gray-500">
            No remaining requests
          </div>
        ) : (
          requests.map((request) => <RemainingRequestCard key={request.id} request={request} />)
        )}
      </div>
    </aside>
  )
}
