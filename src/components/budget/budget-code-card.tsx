'use client'

import { ChevronRight, MinusCircle, Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getBudgetCodeHealth, getBudgetCodeLabel } from '@/lib/budget-control'
import type { BudgetCodeGroup } from '@/types/budget'

export function BudgetCodeCard({
  group,
  collapsed,
  onCollapsedChange,
  onEditBudgetCode,
  onUnassign,
  onOpenRequest,
}: {
  group: BudgetCodeGroup
  collapsed: boolean
  onCollapsedChange: (collapsed: boolean) => void
  onEditBudgetCode: () => void
  onUnassign: (requestId: string) => void
  onOpenRequest: (requestId: string) => void
}) {
  const health = getBudgetCodeHealth(group.remainingBudget, group.budgetCode.budgetAmount)
  const usedPercent =
    group.budgetCode.budgetAmount && group.budgetCode.budgetAmount > 0
      ? Math.min(100, Math.max(0, (group.usedAmount / group.budgetCode.budgetAmount) * 100))
      : null

  const healthClass =
    health === 'Over'
      ? 'bg-red-50 text-red-700'
      : health === 'Watch'
        ? 'bg-amber-50 text-amber-700'
        : health === 'Healthy'
          ? 'bg-green-50 text-green-700'
          : 'bg-gray-100 text-gray-600'
  const barClass =
    health === 'Over' ? 'bg-red-600' : health === 'Watch' ? 'bg-amber-600' : 'bg-gray-700'

  return (
    <section className="overflow-hidden rounded-lg border bg-white transition-shadow duration-200 hover:shadow-sm">
      <div className="grid items-center gap-3 px-3 py-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(240px,1.4fr)_auto]">
        <button
          type="button"
          className="group flex min-w-0 items-center gap-2 text-left"
          aria-expanded={!collapsed}
          onClick={() => onCollapsedChange(!collapsed)}
        >
          <ChevronRight className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ${collapsed ? '' : 'rotate-90'}`} />
          <span className="min-w-0">
            <span className="block font-mono text-[11px] font-medium text-gray-500">{group.budgetCode.displayCode}</span>
            <span className="block truncate text-sm font-semibold text-gray-900 group-hover:underline">
              {getBudgetCodeLabel(group.budgetCode)}
            </span>
          </span>
        </button>

        <div className="grid grid-cols-3 gap-0 max-lg:border-t max-lg:divide-x lg:gap-3">
          <div className="py-1 pl-1 lg:py-0 lg:pl-0">
            <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Budget amount</div>
            <div className="text-sm font-semibold tabular-nums text-gray-900">
              {group.budgetCode.budgetAmount?.toLocaleString() ?? '—'}
            </div>
          </div>
          <div className="py-1 pl-3 lg:py-0 lg:pl-0">
            <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Used</div>
            <div className="text-sm font-semibold tabular-nums text-gray-900">{group.usedAmount.toLocaleString()}</div>
          </div>
          <div className="py-1 pl-3 lg:py-0 lg:pl-0">
            <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Remaining</div>
            <div className={`text-sm font-semibold tabular-nums ${group.remainingBudget !== null && group.remainingBudget < 0 ? 'text-red-700' : 'text-gray-900'}`}>
              {group.remainingBudget?.toLocaleString() ?? '—'}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2 max-lg:px-3 max-lg:pb-3 lg:justify-end">
          <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${healthClass}`}>{health}</span>
          <Button variant="outline" size="sm" onClick={onEditBudgetCode} title="Edit budget code">
            <Pencil className="mr-1 h-3.5 w-3.5" />
            Edit
          </Button>
        </div>
      </div>

      {usedPercent !== null ? (
        <div className="h-1 bg-gray-100">
          <div className={`h-full transition-[width] duration-300 ${barClass}`} style={{ width: `${usedPercent}%` }} />
        </div>
      ) : null}

      <div
        className={`grid transition-[grid-template-rows] duration-200 ease-out ${collapsed ? 'grid-rows-[0fr]' : 'grid-rows-[1fr]'}`}
        {...(collapsed ? { inert: true } : {})}
      >
        <div className="overflow-hidden">
          <div className="border-t">
            {group.requests.length === 0 ? (
              <p className="px-3 py-3 text-sm text-muted-foreground">No requests assigned to this group yet.</p>
            ) : (
              group.requests.map((request) => (
                <div
                  key={request.id}
                  className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-3 border-t px-3 py-2 first:border-t-0"
                >
                  <button
                    type="button"
                    className="min-w-0 truncate text-left text-sm font-medium text-gray-900 underline-offset-2 hover:underline"
                    title={request.title}
                    onClick={() => onOpenRequest(request.id)}
                  >
                    {request.title}
                  </button>
                  <span className="text-xs text-muted-foreground">{request.status}</span>
                  <span className="tabular-nums text-sm font-semibold text-gray-900">
                    {request.usageAmount.toLocaleString()}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    title="Remove request from budget code"
                    onClick={() => onUnassign(request.id)}
                  >
                    <MinusCircle className="h-4 w-4" />
                  </Button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
