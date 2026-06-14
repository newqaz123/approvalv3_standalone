'use client'

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import { DndContext, DragOverlay, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core'
import { Download, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { BudgetCodeBox } from '@/components/budget/budget-code-box'
import { BudgetCodeCreateDialog } from '@/components/budget/budget-code-create-dialog'
import { BudgetCodeEditDialog } from '@/components/budget/budget-code-edit-dialog'
import { BudgetEditDialog } from '@/components/budget/budget-edit-dialog'
import { BudgetSearchInput } from '@/components/budget/budget-search-input'
import { RemainingRequestCard, RemainingRequestPanel } from '@/components/budget/remaining-request-panel'
import {
  assignRequestToBudgetCode,
  createBudgetCode,
  exportBudgetMonitorXlsx,
  getBudgetMonitorData,
  unassignRequestBudgetCode,
  updateBudgetCodeAmount,
  updateRequestProjectEstimate,
} from '@/server-actions/budget-control'
import type { BudgetCodeGroup, BudgetMonitorData, BudgetMonitorFilters } from '@/types/budget'

function buildRenderableGroups(data: BudgetMonitorData): BudgetCodeGroup[] {
  const groupsByCodeId = new Map(data.groups.map((group) => [group.budgetCode.id, group]))

  for (const budgetCode of data.budgetCodes) {
    if (!groupsByCodeId.has(budgetCode.id)) {
      groupsByCodeId.set(budgetCode.id, {
        budgetCode,
        usedAmount: 0,
        remainingBudget: budgetCode.budgetAmount,
        assignedRequestCount: 0,
        requests: [],
      })
    }
  }

  return [...groupsByCodeId.values()].sort((a, b) =>
    a.budgetCode.displayCode.localeCompare(b.budgetCode.displayCode)
  )
}

export function BudgetMonitorPage({ initialData }: { initialData: BudgetMonitorData }) {
  const [data, setData] = useState(initialData)
  const [filters, setFilters] = useState<BudgetMonitorFilters>({})
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const [remainingCollapsed, setRemainingCollapsed] = useState(false)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [editDialog, setEditDialog] = useState<
    | { type: 'budget'; group: BudgetCodeGroup }
    | { type: 'estimate'; requestId: string; value: number | null }
    | null
  >(null)

  const renderableGroups = useMemo(() => buildRenderableGroups(data), [data])
  const groupIds = useMemo(() => new Set(renderableGroups.map((group) => group.budgetCode.id)), [renderableGroups])
  const activeRequest = useMemo(
    () => data.remainingRequests.find((request) => request.id === activeRequestId) ?? null,
    [activeRequestId, data.remainingRequests]
  )
  const budgetCodeOptions = useMemo(
    () => data.budgetCodes.map((budgetCode) => ({
      value: budgetCode.displayCode,
      label: budgetCode.displayCode,
      meta: budgetCode.department?.name ?? 'No department',
    })),
    [data.budgetCodes]
  )
  const refresh = useCallback((nextFilters = filters) => {
    startTransition(async () => {
      setData(await getBudgetMonitorData(nextFilters))
    })
  }, [filters])

  useEffect(() => {
    const timeout = window.setTimeout(() => refresh(filters), 250)
    return () => window.clearTimeout(timeout)
  }, [filters, refresh])

  function updateFilters(nextFilters: BudgetMonitorFilters) {
    setFilters(nextFilters)
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveRequestId(String(event.active.id))
  }

  async function handleDragEnd(event: DragEndEvent) {
    setActiveRequestId(null)
    const requestId = String(event.active.id)
    const budgetCodeId = event.over?.id ? String(event.over.id) : null
    if (!budgetCodeId || !groupIds.has(budgetCodeId)) return

    try {
      await assignRequestToBudgetCode({ requestId, budgetCodeId })
      toast.success('Request assigned')
      refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to assign request')
    }
  }

  async function handleExport() {
    const result = await exportBudgetMonitorXlsx(filters)
    const link = document.createElement('a')
    link.href = `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${result.base64}`
    link.download = result.fileName
    link.click()
  }

  return (
    <DndContext
      id="budget-monitor-dnd"
      onDragStart={handleDragStart}
      onDragCancel={() => setActiveRequestId(null)}
      onDragEnd={handleDragEnd}
    >
      <div className="space-y-5 pb-24">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
          <div>
            <h1 className="text-2xl font-bold tracking-normal">Budget Monitor</h1>
            <p className="text-sm text-gray-500">
              Assign remaining requests into budget-code boxes and monitor visible usage.
            </p>
          </div>
          <Button onClick={handleExport}>
            <Download className="mr-2 h-4 w-4" />
            Export XLSX
          </Button>
        </div>

        <div className="grid gap-2 rounded-lg border bg-white p-3 lg:grid-cols-[1.2fr_1fr_1fr]">
          <BudgetSearchInput
            placeholder="Search budget code or request"
            value={filters.budgetCodeSearch ?? ''}
            options={budgetCodeOptions}
            onChange={(value) => updateFilters({ ...filters, budgetCodeSearch: value || undefined })}
          />
          <Select
            value={filters.departmentId ?? 'all'}
            onValueChange={(value) => updateFilters({ ...filters, departmentId: value === 'all' ? undefined : value })}
          >
            <SelectTrigger>
              <SelectValue placeholder="Department" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All departments</SelectItem>
              {data.filters.departments.map((department) => (
                <SelectItem key={department.id} value={department.id}>
                  {department.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={filters.status ?? 'all'}
            onValueChange={(value) => updateFilters({ ...filters, status: value === 'all' ? undefined : value })}
          >
            <SelectTrigger>
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {data.filters.statuses.map((status) => (
                <SelectItem key={status} value={status}>
                  {status}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-4">
          <div className="space-y-4">
            <Button variant="outline" onClick={() => setCreateDialogOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              New budget code
            </Button>
            {renderableGroups.map((group) => (
              <BudgetCodeBox
                key={group.budgetCode.id}
                group={group}
                collapsed={collapsedGroups.has(group.budgetCode.id)}
                onCollapsedChange={(collapsed) => {
                  const next = new Set(collapsedGroups)
                  if (collapsed) next.add(group.budgetCode.id)
                  else next.delete(group.budgetCode.id)
                  setCollapsedGroups(next)
                }}
                onEditBudgetAmount={() => setEditDialog({ type: 'budget', group })}
                onEditProjectEstimate={(requestId, value) => setEditDialog({ type: 'estimate', requestId, value })}
                onUnassign={async (requestId) => {
                  await unassignRequestBudgetCode(requestId)
                  refresh()
                }}
              />
            ))}
          </div>
          <RemainingRequestPanel
            requests={data.remainingRequests}
            collapsed={remainingCollapsed}
            onCollapsedChange={setRemainingCollapsed}
            onEditProjectEstimate={(requestId, value) => setEditDialog({ type: 'estimate', requestId, value })}
          />
        </div>

        <BudgetCodeEditDialog
          open={editDialog?.type === 'budget'}
          budgetCode={editDialog?.type === 'budget' ? editDialog.group.budgetCode : null}
          departments={data.filters.departments}
          onOpenChange={(open) => !open && setEditDialog(null)}
          onSave={async ({ budgetAmount, departmentId }) => {
            if (editDialog?.type !== 'budget') return
            await updateBudgetCodeAmount({
              budgetCodeId: editDialog.group.budgetCode.id,
              budgetAmount,
              departmentId,
            })
            refresh()
          }}
        />
        <BudgetEditDialog
          open={editDialog?.type === 'estimate'}
          title="Edit project estimate cost"
          label="Project estimate cost"
          initialValue={editDialog?.type === 'estimate' ? editDialog.value : null}
          onOpenChange={(open) => !open && setEditDialog(null)}
          onSave={async (value) => {
            if (editDialog?.type === 'estimate') {
              await updateRequestProjectEstimate({ requestId: editDialog.requestId, projectEstimateCost: value })
            }
            refresh()
          }}
        />
        <BudgetCodeCreateDialog
          open={createDialogOpen}
          onOpenChange={setCreateDialogOpen}
          departments={data.filters.departments}
          onCreate={async (input) => {
            await createBudgetCode(input)
            refresh()
          }}
        />
        <DragOverlay>
          {activeRequest ? <RemainingRequestCard request={activeRequest} dragging /> : null}
        </DragOverlay>
      </div>
    </DndContext>
  )
}
