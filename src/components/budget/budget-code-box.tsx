'use client'

import { useDroppable } from '@dnd-kit/core'
import { ChevronDown, ChevronRight, Edit2, MinusCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { BudgetCodeGroup } from '@/types/budget'

export function BudgetCodeBox({
  group,
  collapsed,
  onCollapsedChange,
  onEditBudgetAmount,
  onEditProjectEstimate,
  onUnassign,
}: {
  group: BudgetCodeGroup
  collapsed: boolean
  onCollapsedChange: (collapsed: boolean) => void
  onEditBudgetAmount: () => void
  onEditProjectEstimate: (requestId: string, value: number | null) => void
  onUnassign: (requestId: string) => void
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: group.budgetCode.id,
    data: { type: 'budget-code', budgetCodeId: group.budgetCode.id },
  })

  return (
    <section className={`overflow-hidden rounded-lg border bg-white shadow-sm ${isOver ? 'ring-2 ring-blue-500' : ''}`}>
      <div className="border-b bg-slate-50 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="break-words text-2xl font-bold tracking-normal text-gray-950">
              {group.budgetCode.displayCode}
            </h2>
            <p className="mt-1 text-xs text-gray-500">{group.assignedRequestCount} assigned request(s)</p>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={onEditBudgetAmount} title="Edit budget amount">
              <Edit2 className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => onCollapsedChange(!collapsed)} title="Minimize budget box">
              {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </div>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <div className="rounded-md border bg-white p-2">
            <div className="text-xs text-gray-500">Budget amount</div>
            <div className="text-sm font-semibold">{group.budgetCode.budgetAmount?.toLocaleString() ?? '-'}</div>
          </div>
          <div className="rounded-md border bg-white p-2">
            <div className="text-xs text-gray-500">Used amount</div>
            <div className="text-sm font-semibold">{group.usedAmount.toLocaleString()}</div>
          </div>
          <div className="rounded-md border bg-white p-2">
            <div className="text-xs text-gray-500">Remaining budget</div>
            <div className="text-sm font-semibold">{group.remainingBudget?.toLocaleString() ?? '-'}</div>
          </div>
        </div>
      </div>

      {!collapsed && (
        <div ref={setNodeRef} className="p-3">
          <div className="grid grid-cols-[1.6fr_.7fr_.8fr_.9fr_.9fr_auto] border-b px-2 py-2 text-xs font-semibold text-gray-600">
            <div>Request</div>
            <div>Dept.</div>
            <div>Status</div>
            <div className="text-right">Budget amount</div>
            <div className="text-right">Remaining budget</div>
            <div />
          </div>
          {group.requests.map((request) => (
            <div
              key={request.id}
              className="grid grid-cols-[1.6fr_.7fr_.8fr_.9fr_.9fr_auto] items-center border-b px-2 py-2 text-sm"
            >
              <div className="min-w-0 truncate font-medium">{request.title}</div>
              <div className="truncate text-gray-600">{request.department?.name ?? '-'}</div>
              <div className="truncate text-gray-600">{request.status}</div>
              <button
                className="text-right text-blue-700 hover:underline"
                onClick={() => onEditProjectEstimate(request.id, request.projectEstimateCost)}
              >
                {request.projectEstimateCost?.toLocaleString() ?? '-'}
              </button>
              <div className="text-right text-gray-600">{group.remainingBudget?.toLocaleString() ?? '-'}</div>
              <Button variant="ghost" size="icon" onClick={() => onUnassign(request.id)} title="Unassign request">
                <MinusCircle className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <div className="mt-3 rounded-md border border-dashed border-gray-300 bg-gray-50 p-4 text-center text-sm text-gray-500">
            Drop remaining request here
          </div>
        </div>
      )}
    </section>
  )
}
