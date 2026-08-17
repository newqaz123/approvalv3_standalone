'use client'

import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
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
}: {
  requests: BudgetRequestRecord[]
  budgetCodes: BudgetCodeSummary[]
  onAssign: (requestId: string, budgetCodeId: string) => Promise<void>
  onUnassign: (requestId: string) => Promise<void>
  onEditProjectEstimate: (requestId: string, value: number | null) => void
}) {
  const [assignedCollapsed, setAssignedCollapsed] = useState(false)
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
        className="w-full min-h-11 rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
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
    if (request.engineeringEstimateCost !== null) {
      return (
        <span className="font-mono tabular-nums text-gray-700">
          {projectEstimateAmount?.toLocaleString() ?? '—'}
        </span>
      )
    }
    return (
      <button
        type="button"
        className="font-mono tabular-nums text-blue-700 hover:underline"
        onClick={() => onEditProjectEstimate(request.id, request.projectEstimateCost)}
      >
        {projectEstimateAmount?.toLocaleString() ?? '—'}
      </button>
    )
  }

  function renderSectionRows(sectionRequests: BudgetRequestRecord[]) {
    return (
      <>
        <table className="hidden md:table min-w-full">
          <thead>
            <tr className="border-b text-left text-xs font-semibold text-gray-600">
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
                <td className="max-w-0 px-2 py-2">
                  <div className="truncate font-medium" title={request.title}>
                    {request.title}
                  </div>
                </td>
                <td className="px-2 py-2 text-gray-600">{request.department?.name ?? '—'}</td>
                <td className="px-2 py-2">{renderGroupSelect(request)}</td>
                <td className="px-2 py-2 text-gray-600">{request.status}</td>
                <td className="px-2 py-2 text-right">{renderCost(request)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="space-y-3 md:hidden">
          {sectionRequests.map((request) => (
            <div key={request.id} className="rounded-lg border bg-white p-3 shadow-sm">
              <div className="truncate text-sm font-medium" title={request.title}>
                {request.title}
              </div>
              <div className="mt-1 text-xs text-gray-500">
                {request.department?.name ?? '—'} · {request.status}
              </div>
              <div className="mt-2">{renderGroupSelect(request)}</div>
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="text-xs text-gray-500">Cost</span>
                {renderCost(request)}
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
    <div className="space-y-6">
      <section>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Unassigned</h2>
          <span className="rounded-full border px-2 py-0.5 text-xs text-gray-500">
            {unassigned.length} request{unassigned.length === 1 ? '' : 's'}
          </span>
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
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Assigned</h2>
          <div className="flex items-center gap-1">
            <span className="rounded-full border px-2 py-0.5 text-xs text-gray-500">
              {assigned.length} request{assigned.length === 1 ? '' : 's'}
            </span>
            <Button
              variant="ghost"
              size="icon"
              aria-expanded={!assignedCollapsed}
              onClick={() => setAssignedCollapsed(!assignedCollapsed)}
              title={assignedCollapsed ? 'Expand assigned requests' : 'Collapse assigned requests'}
            >
              {assignedCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </div>
        </div>
        {!assignedCollapsed &&
          (assigned.length === 0 ? (
            <p className="rounded-md border border-dashed border-gray-300 bg-gray-50 p-4 text-center text-sm text-gray-500">
              No assigned requests.
            </p>
          ) : (
            renderSectionRows(assigned)
          ))}
      </section>
    </div>
  )
}
