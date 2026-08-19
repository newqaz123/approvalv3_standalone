'use client'

import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { getBudgetCodeLabel, getBudgetProjectEstimateAmount } from '@/lib/budget-control'
import type { BudgetCodeSummary, BudgetRequestRecord } from '@/types/budget'

function sortBudgetCodesForRequest(
  budgetCodes: BudgetCodeSummary[],
  request: BudgetRequestRecord
) {
  return [...budgetCodes].sort((a, b) => {
    const aMatch = a.department?.id === request.department?.id ? 0 : 1
    const bMatch = b.department?.id === request.department?.id ? 0 : 1
    if (aMatch !== bMatch) return aMatch - bMatch
    return getBudgetCodeLabel(a).localeCompare(getBudgetCodeLabel(b))
  })
}

export function BudgetRequestTable({
  requests,
  budgetCodes,
  onAssign,
  onUnassign,
  onEditProjectEstimate,
  onOpenRequest,
}: {
  requests: BudgetRequestRecord[]
  budgetCodes: BudgetCodeSummary[]
  onAssign: (requestId: string, budgetCodeId: string) => Promise<void>
  onUnassign: (requestId: string) => Promise<void>
  onEditProjectEstimate: (requestId: string, value: number | null) => void
  onOpenRequest: (requestId: string) => void
}) {
  const [assignedExpanded, setAssignedExpanded] = useState(false)
  const unassigned = requests.filter((request) => !request.budgetCode)
  const assigned = requests.filter((request) => request.budgetCode)

  async function handleGroupChange(request: BudgetRequestRecord, budgetCodeId: string) {
    try {
      if (!budgetCodeId) await onUnassign(request.id)
      else await onAssign(request.id, budgetCodeId)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update assignment')
    }
  }

  function renderGroupSelect(request: BudgetRequestRecord) {
    return (
      <select
        aria-label="Assign group"
        className="h-8 w-full rounded-md border border-input bg-white px-2 text-sm text-gray-900 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        value={request.budgetCode?.id ?? ''}
        onChange={(event) => handleGroupChange(request, event.target.value)}
      >
        <option value="">Unassigned</option>
        {sortBudgetCodesForRequest(budgetCodes, request).map((code) => (
          <option key={code.id} value={code.id}>
            {getBudgetCodeLabel(code)} · {code.displayCode}
          </option>
        ))}
      </select>
    )
  }

  function renderCost(request: BudgetRequestRecord) {
    const projectEstimateAmount = getBudgetProjectEstimateAmount(request)
    const hasApprovedEstimate = request.engineeringEstimateCost !== null
    if (hasApprovedEstimate) {
      return (
        <span className="tabular-nums text-gray-700">
          {projectEstimateAmount?.toLocaleString() ?? '—'}
        </span>
      )
    }
    return (
      <button
        type="button"
        className="tabular-nums text-blue-700 hover:underline"
        onClick={() => onEditProjectEstimate(request.id, request.projectEstimateCost)}
      >
        {projectEstimateAmount?.toLocaleString() ?? '—'}
      </button>
    )
  }

  function renderSectionRows(sectionRequests: BudgetRequestRecord[]) {
    return (
      <>
        <table className="hidden min-w-full table-fixed md:table">
          <colgroup>
            <col className="w-[42%]" />
            <col className="w-[16%]" />
            <col className="w-[26%]" />
            <col className="w-[8%]" />
            <col className="w-[8%]" />
          </colgroup>
          <thead>
            <tr className="border-b text-left text-xs font-medium text-muted-foreground">
              <th className="px-2 py-2">Request</th>
              <th className="px-2 py-2">Department</th>
              <th className="px-2 py-2">Group</th>
              <th className="px-2 py-2">Status</th>
              <th className="px-2 py-2 text-right">Cost</th>
            </tr>
          </thead>
          <tbody>
            {sectionRequests.map((request) => (
              <tr key={request.id} className="border-b text-sm">
                <td className="px-2 py-2">
                  <button
                    type="button"
                    className="block w-full truncate text-left font-medium text-gray-900 underline-offset-2 hover:underline"
                    title={request.title}
                    onClick={() => onOpenRequest(request.id)}
                  >
                    {request.title}
                  </button>
                </td>
                <td className="truncate px-2 py-2 text-muted-foreground">{request.department?.name ?? '—'}</td>
                <td className="px-2 py-2">{renderGroupSelect(request)}</td>
                <td className="truncate px-2 py-2 text-xs text-muted-foreground" title={request.status}>{request.status}</td>
                <td className="px-2 py-2 text-right">{renderCost(request)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="space-y-3 md:hidden">
          {sectionRequests.map((request) => (
            <div key={request.id} className="rounded-xl border bg-white p-3">
              <div
                role="button"
                tabIndex={0}
                className="truncate text-sm font-semibold text-gray-900 underline-offset-2 hover:underline"
                title={request.title}
                onClick={() => onOpenRequest(request.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') onOpenRequest(request.id)
                }}
              >
                {request.title}
              </div>
              <div className="mt-0.5 text-[11px] text-gray-500">
                {request.department?.name ?? '—'} · {request.status}
                {request.budgetCode ? ` · in ${getBudgetCodeLabel(request.budgetCode)}` : ''}
              </div>
              <div className="mt-2.5 flex items-center gap-2">
                {renderGroupSelect(request)}
                <span className="shrink-0">{renderCost(request)}</span>
              </div>
            </div>
          ))}
        </div>
      </>
    )
  }

  if (requests.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-gray-300 bg-gray-50 p-4 text-center text-sm text-gray-500">
        No requests match these filters.
      </p>
    )
  }

  return (
    <div className="space-y-4">
      <section>
        <div className="mb-1.5 flex items-center gap-2">
          <h2 className="text-sm font-semibold text-gray-900">Unassigned</h2>
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-100 px-1.5 text-[11px] font-semibold text-amber-700">
            {unassigned.length}
          </span>
          <span className="text-xs text-muted-foreground">no budget code yet</span>
        </div>
        {unassigned.length === 0 ? (
          <p className="rounded-md border border-dashed border-gray-300 bg-gray-50 p-4 text-center text-sm text-gray-500">
            No unassigned requests.
          </p>
        ) : (
          renderSectionRows(unassigned)
        )}
      </section>

      <section>
        <button
          type="button"
          className="-mx-1.5 mb-1 flex w-[calc(100%+0.75rem)] items-center gap-2 rounded-md px-1.5 py-1.5 text-left transition-colors hover:bg-gray-50"
          aria-expanded={assignedExpanded}
          onClick={() => setAssignedExpanded(!assignedExpanded)}
        >
          <ChevronRight className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ${assignedExpanded ? 'rotate-90' : ''}`} />
          <h2 className="text-sm font-semibold text-gray-900">Assigned</h2>
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-green-100 px-1.5 text-[11px] font-semibold text-green-700">
            {assigned.length}
          </span>
          <span className="text-xs text-muted-foreground">{assignedExpanded ? 'click to collapse' : 'click to expand'}</span>
        </button>
        <div
          className={`grid transition-[grid-template-rows] duration-200 ease-out ${assignedExpanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
          {...(!assignedExpanded ? { inert: true } : {})}
        >
          <div className="overflow-hidden">
            {assigned.length === 0 ? (
              <p className="rounded-md border border-dashed border-gray-300 bg-gray-50 p-4 text-center text-sm text-gray-500">
                No assigned requests.
              </p>
            ) : (
              renderSectionRows(assigned)
            )}
          </div>
        </div>
      </section>
    </div>
  )
}
