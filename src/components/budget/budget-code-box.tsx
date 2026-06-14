'use client'

import { useDroppable } from '@dnd-kit/core'
import { ChevronDown, ChevronRight, Edit2, MinusCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getBudgetProjectEstimateAmount } from '@/lib/budget-control'
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
    <section
      ref={setNodeRef}
      className={`overflow-hidden rounded-lg border bg-white shadow-sm transition ${
        isOver ? 'border-blue-400 bg-blue-50/30 ring-2 ring-blue-500' : ''
      }`}
    >
      <div className="border-b bg-slate-50 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="break-words text-2xl font-bold tracking-normal text-gray-950">
              {group.budgetCode.displayCode}
            </h2>
            <p className="mt-1 text-xs text-gray-500">
              {group.budgetCode.department?.name ?? 'No department'} - {group.assignedRequestCount} assigned request(s)
            </p>
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
        <div className="p-3">
          <div className="overflow-x-auto">
            <div className="min-w-[960px]">
              <div className="grid grid-cols-[minmax(320px,1.8fr)_150px_220px_150px_64px] border-b px-2 py-2 text-xs font-semibold text-gray-600">
                <div>Request</div>
                <div>Dept.</div>
                <div>Status</div>
                <div className="text-right">Project estimate</div>
                <div className="sticky right-0 bg-white text-center">Remove</div>
              </div>
              {group.requests.map((request) => {
                const projectEstimateAmount = getBudgetProjectEstimateAmount(request)
                const hasApprovedEstimate = request.engineeringEstimateCost !== null

                return (
                  <div
                    key={request.id}
                    className="grid grid-cols-[minmax(320px,1.8fr)_150px_220px_150px_64px] items-center border-b px-2 py-2 text-sm"
                  >
                    <div className="min-w-0 truncate pr-3 font-medium">{request.title}</div>
                    <div className="truncate pr-3 text-gray-600">{request.department?.name ?? '-'}</div>
                    <div className="truncate pr-3 text-gray-600">{request.status}</div>
                    {hasApprovedEstimate ? (
                      <div className="text-right font-medium text-gray-700">
                        {projectEstimateAmount?.toLocaleString() ?? '-'}
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="text-right text-blue-700 hover:underline"
                        onClick={() => onEditProjectEstimate(request.id, request.projectEstimateCost)}
                      >
                        {projectEstimateAmount?.toLocaleString() ?? '-'}
                      </button>
                    )}
                    <div className="sticky right-0 flex justify-center bg-white">
                      <Button variant="ghost" size="icon" onClick={() => onUnassign(request.id)} title="Remove request from budget code">
                        <MinusCircle className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
          <div className="mt-3 rounded-md border border-dashed border-gray-300 bg-gray-50 p-4 text-center text-sm text-gray-500">
            Drop remaining request here
          </div>
        </div>
      )}
      {collapsed && (
        <div className="border-t border-dashed bg-slate-50 px-4 py-3 text-sm text-gray-500">
          Drop remaining request on this collapsed box
        </div>
      )}
    </section>
  )
}
