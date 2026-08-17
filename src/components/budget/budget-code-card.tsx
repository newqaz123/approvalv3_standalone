'use client'

import { ChevronDown, ChevronRight, Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getBudgetCodeHealth, getBudgetCodeLabel } from '@/lib/budget-control'
import type { BudgetCodeGroup } from '@/types/budget'

export function BudgetCodeCard({
  group,
  collapsed,
  onCollapsedChange,
  onEditBudgetCode,
}: {
  group: BudgetCodeGroup
  collapsed: boolean
  onCollapsedChange: (collapsed: boolean) => void
  onEditBudgetCode: () => void
}) {
  const health = getBudgetCodeHealth(group.remainingBudget, group.budgetCode.budgetAmount)
  const usedPercent =
    group.budgetCode.budgetAmount && group.budgetCode.budgetAmount > 0
      ? Math.min(100, Math.max(0, (group.usedAmount / group.budgetCode.budgetAmount) * 100))
      : null

  return (
    <section className="rounded-lg border bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <button
          type="button"
          className="min-h-11 min-w-0 flex-1 text-left"
          aria-expanded={!collapsed}
          onClick={() => onCollapsedChange(!collapsed)}
        >
          <div className="text-base font-semibold">{getBudgetCodeLabel(group.budgetCode)}</div>
          <p className="mt-1 text-xs text-gray-500">
            {group.budgetCode.displayCode} · {group.assignedRequestCount} assigned request
            {group.assignedRequestCount === 1 ? '' : 's'}
          </p>
        </button>
        <div className="flex items-center gap-1">
          <span className="rounded-full bg-gray-100 px-2 py-1 font-mono text-[11px]">{health}</span>
          <Button variant="ghost" size="icon" onClick={onEditBudgetCode} title="Edit budget code">
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onCollapsedChange(!collapsed)}
            title={collapsed ? 'Expand budget card' : 'Collapse budget card'}
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 overflow-hidden rounded-md border sm:grid-cols-3">
        <div className="border-b p-3 sm:border-b-0 sm:border-r">
          <div className="text-xs text-gray-500">Budget</div>
          <div className="font-mono text-lg tabular-nums">
            {group.budgetCode.budgetAmount?.toLocaleString() ?? '—'}
          </div>
        </div>
        <div className="border-b p-3 sm:border-b-0 sm:border-r">
          <div className="text-xs text-gray-500">Used</div>
          <div className="font-mono text-lg tabular-nums">{group.usedAmount.toLocaleString()}</div>
        </div>
        <div className="p-3">
          <div className="text-xs text-gray-500">Remaining</div>
          <div className="font-mono text-lg tabular-nums">
            {group.remainingBudget?.toLocaleString() ?? '—'}
          </div>
        </div>
      </div>

      {usedPercent !== null ? (
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-gray-200">
          <div className="h-full bg-gray-900" style={{ width: `${usedPercent}%` }} />
        </div>
      ) : null}

      {!collapsed ? (
        <div className="mt-3 border-t pt-2">
          {group.requests.length === 0 ? (
            <p className="text-xs text-gray-500">No requests assigned to this group yet.</p>
          ) : (
            group.requests.map((request) => (
              <div key={request.id} className="grid grid-cols-[1fr_auto_auto] gap-3 border-b py-2 text-sm last:border-b-0">
                <div className="min-w-0 truncate font-medium" title={request.title}>
                  {request.title}
                </div>
                <span className="text-xs text-gray-500">{request.status}</span>
                <span className="font-mono text-xs tabular-nums">
                  {request.usageAmount.toLocaleString()}
                </span>
              </div>
            ))
          )}
        </div>
      ) : null}
    </section>
  )
}
