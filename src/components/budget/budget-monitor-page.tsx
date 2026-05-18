'use client'

import { useMemo, useState, useTransition } from 'react'
import { DndContext, type DragEndEvent } from '@dnd-kit/core'
import { Download, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { BudgetCodeBox } from '@/components/budget/budget-code-box'
import { BudgetCodeCreateDialog } from '@/components/budget/budget-code-create-dialog'
import { BudgetEditDialog } from '@/components/budget/budget-edit-dialog'
import { RemainingRequestPanel } from '@/components/budget/remaining-request-panel'
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
  const [isPending, startTransition] = useTransition()
  const [editDialog, setEditDialog] = useState<
    | { type: 'budget'; group: BudgetCodeGroup }
    | { type: 'estimate'; requestId: string; value: number | null }
    | null
  >(null)

  const renderableGroups = useMemo(() => buildRenderableGroups(data), [data])
  const groupIds = useMemo(() => new Set(renderableGroups.map((group) => group.budgetCode.id)), [renderableGroups])

  function refresh(nextFilters = filters) {
    startTransition(async () => {
      setData(await getBudgetMonitorData(nextFilters))
    })
  }

  async function handleDragEnd(event: DragEndEvent) {
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
    <DndContext onDragEnd={handleDragEnd}>
      <div className="space-y-5">
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

        <div className="grid gap-2 rounded-lg border bg-white p-3 lg:grid-cols-[1.2fr_1fr_1fr_1fr_auto]">
          <Input
            placeholder="Filter budget code"
            value={filters.budgetCodeSearch ?? ''}
            onChange={(event) => setFilters({ ...filters, budgetCodeSearch: event.target.value })}
          />
          <Input
            placeholder="Filter remaining request"
            value={filters.requestSearch ?? ''}
            onChange={(event) => setFilters({ ...filters, requestSearch: event.target.value })}
          />
          <Select
            value={filters.departmentId ?? 'all'}
            onValueChange={(value) => setFilters({ ...filters, departmentId: value === 'all' ? undefined : value })}
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
            onValueChange={(value) => setFilters({ ...filters, status: value === 'all' ? undefined : value })}
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
          <Button disabled={isPending} onClick={() => refresh()}>
            Apply
          </Button>
        </div>

        <div className="grid items-start gap-4 lg:grid-cols-[1fr_320px]">
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
          />
        </div>

        <BudgetEditDialog
          open={editDialog !== null}
          title={editDialog?.type === 'budget' ? 'Edit budget amount' : 'Edit project estimate cost'}
          label={editDialog?.type === 'budget' ? 'Budget amount' : 'Project estimate cost'}
          initialValue={editDialog?.type === 'budget' ? editDialog.group.budgetCode.budgetAmount : editDialog?.value ?? null}
          onOpenChange={(open) => !open && setEditDialog(null)}
          onSave={async (value) => {
            if (editDialog?.type === 'budget') {
              await updateBudgetCodeAmount({ budgetCodeId: editDialog.group.budgetCode.id, budgetAmount: value })
            } else if (editDialog?.type === 'estimate') {
              await updateRequestProjectEstimate({ requestId: editDialog.requestId, projectEstimateCost: value })
            }
            refresh()
          }}
        />
        <BudgetCodeCreateDialog
          open={createDialogOpen}
          onOpenChange={setCreateDialogOpen}
          onCreate={async (input) => {
            await createBudgetCode(input)
            refresh()
          }}
        />
      </div>
    </DndContext>
  )
}
