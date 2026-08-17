'use client'

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import { FileSpreadsheet } from 'lucide-react'
import { toast } from 'sonner'
import { BudgetCodeCreateDialog } from '@/components/budget/budget-code-create-dialog'
import { BudgetCodeEditDialog } from '@/components/budget/budget-code-edit-dialog'
import { BudgetCodePasteDialog } from '@/components/budget/budget-code-paste-dialog'
import { BudgetDepartmentPanel } from '@/components/budget/budget-department-panel'
import { BudgetEditDialog } from '@/components/budget/budget-edit-dialog'
import { BudgetRequestTable } from '@/components/budget/budget-request-table'
import { BudgetSearchInput } from '@/components/budget/budget-search-input'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  assignRequestToBudgetCode,
  createBudgetCode,
  exportBudgetMonitorXlsx,
  getBudgetMonitorData,
  pasteBudgetCodes,
  unassignRequestBudgetCode,
  updateBudgetCodeAmount,
  updateRequestProjectEstimate,
} from '@/server-actions/budget-control'
import { sumVisibleRemainingBudget } from '@/lib/budget-control'
import type { BudgetCodeGroup, BudgetMonitorData, BudgetMonitorFilters } from '@/types/budget'

const VIEW_STORAGE_KEY = 'budget-monitor-view'

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
  const [view, setView] = useState<'depts' | 'requests'>('depts')
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [pasteDialogOpen, setPasteDialogOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [editDialog, setEditDialog] = useState<
    | { type: 'budget'; group: BudgetCodeGroup }
    | { type: 'estimate'; requestId: string; value: number | null }
    | null
  >(null)

  const renderableGroups = useMemo(() => buildRenderableGroups(data), [data])
  const remaining = useMemo(() => sumVisibleRemainingBudget(renderableGroups), [renderableGroups])
  const budgetCodeOptions = useMemo(
    () =>
      data.budgetCodes.map((budgetCode) => ({
        value: budgetCode.displayCode,
        label: budgetCode.name?.trim() || budgetCode.displayCode,
        meta: budgetCode.department?.name ?? 'No department',
      })),
    [data.budgetCodes]
  )

  const refresh = useCallback(
    (nextFilters = filters) => {
      startTransition(async () => {
        setData(await getBudgetMonitorData(nextFilters))
      })
    },
    [filters]
  )

  useEffect(() => {
    const saved = window.localStorage.getItem(VIEW_STORAGE_KEY)
    if (saved === 'depts' || saved === 'requests') setView(saved)
  }, [])

  useEffect(() => {
    const timeout = window.setTimeout(() => refresh(filters), 250)
    return () => window.clearTimeout(timeout)
  }, [filters, refresh])

  function updateView(nextView: string) {
    const resolved = nextView === 'requests' ? 'requests' : 'depts'
    setView(resolved)
    window.localStorage.setItem(VIEW_STORAGE_KEY, resolved)
  }

  async function handleExport() {
    const result = await exportBudgetMonitorXlsx(filters)
    const link = document.createElement('a')
    link.href = `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${result.base64}`
    link.download = result.fileName
    link.click()
  }

  return (
    <div className="space-y-5 pb-10">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <h1 className="text-2xl font-bold tracking-normal">Budget Monitor</h1>
          <p className="text-sm text-gray-500">Assign requests to a budget code.</p>
        </div>
        <div className="text-left sm:text-right">
          <div className="text-3xl font-semibold tabular-nums">{remaining.total.toLocaleString()}</div>
          <div className="text-xs text-gray-500">
            total remaining across {remaining.groupCount} group{remaining.groupCount === 1 ? '' : 's'}
          </div>
        </div>
      </div>

      <div className="grid gap-2 rounded-lg border bg-white p-3 lg:grid-cols-[1.4fr_1fr_1fr_auto_auto]">
        <BudgetSearchInput
          placeholder="Search budget code or request"
          value={filters.budgetCodeSearch ?? ''}
          options={budgetCodeOptions}
          onChange={(value) => setFilters({ ...filters, budgetCodeSearch: value || undefined })}
        />
        <Select
          value={filters.departmentId ?? 'all'}
          onValueChange={(value) =>
            setFilters({ ...filters, departmentId: value === 'all' ? undefined : value })
          }
        >
          <SelectTrigger className="min-h-11">
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
          <SelectTrigger className="min-h-11">
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
        <Button type="button" variant="outline" className="min-h-11" onClick={() => setFilters({})}>
          Clear
        </Button>
        <Button type="button" variant="outline" className="min-h-11" onClick={handleExport} disabled={isPending}>
          <FileSpreadsheet className="mr-2 h-4 w-4" />
          Reports
        </Button>
      </div>

      <Tabs value={view} onValueChange={updateView}>
        <TabsList>
          <TabsTrigger value="depts">Budget by department</TabsTrigger>
          <TabsTrigger value="requests">All requests</TabsTrigger>
        </TabsList>
        <TabsContent value="depts">
          <BudgetDepartmentPanel
            groups={renderableGroups}
            onEditBudgetCode={(group) => setEditDialog({ type: 'budget', group })}
            onPaste={() => setPasteDialogOpen(true)}
            onCreate={() => setCreateDialogOpen(true)}
          />
        </TabsContent>
        <TabsContent value="requests">
          <BudgetRequestTable
            requests={data.requests}
            budgetCodes={data.budgetCodes}
            onAssign={async (requestId, budgetCodeId) => {
              await assignRequestToBudgetCode({ requestId, budgetCodeId })
              toast.success('Request assigned')
              refresh()
            }}
            onUnassign={async (requestId) => {
              await unassignRequestBudgetCode(requestId)
              toast.success('Request unassigned')
              refresh()
            }}
            onEditProjectEstimate={(requestId, value) => setEditDialog({ type: 'estimate', requestId, value })}
          />
        </TabsContent>
      </Tabs>

      <BudgetCodeEditDialog
        open={editDialog?.type === 'budget'}
        budgetCode={editDialog?.type === 'budget' ? editDialog.group.budgetCode : null}
        departments={data.filters.departments}
        onOpenChange={(open) => !open && setEditDialog(null)}
        onSave={async ({ name, budgetAmount, departmentId }) => {
          if (editDialog?.type !== 'budget') return
          await updateBudgetCodeAmount({
            budgetCodeId: editDialog.group.budgetCode.id,
            name,
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
      <BudgetCodePasteDialog
        open={pasteDialogOpen}
        existingCodes={data.budgetCodes}
        onOpenChange={setPasteDialogOpen}
        onPaste={async (rows) => {
          const result = await pasteBudgetCodes({ rows })
          toast.success(`Created ${result.created}, updated ${result.updated}`)
          refresh()
          return result
        }}
      />
    </div>
  )
}
