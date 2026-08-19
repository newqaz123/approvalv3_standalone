'use client'

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import { ClipboardPaste, FileSpreadsheet, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { BudgetCodeCreateDialog } from '@/components/budget/budget-code-create-dialog'
import { BudgetCodeEditDialog } from '@/components/budget/budget-code-edit-dialog'
import { BudgetCodePasteDialog } from '@/components/budget/budget-code-paste-dialog'
import { BudgetDepartmentPanel } from '@/components/budget/budget-department-panel'
import { BudgetEditDialog } from '@/components/budget/budget-edit-dialog'
import { BudgetRequestTable } from '@/components/budget/budget-request-table'
import { RequestModalRouter } from '@/components/requests/request-modal-router'
import { BudgetSearchInput } from '@/components/budget/budget-search-input'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
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
  const [filterSheetOpen, setFilterSheetOpen] = useState(false)
  const [detailRequestId, setDetailRequestId] = useState<string | null>(null)
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
  const unassignedCount = useMemo(
    () => data.requests.filter((request) => !request.budgetCode).length,
    [data.requests]
  )
  const activeFilterCount = useMemo(
    () =>
      [filters.budgetCodeSearch, filters.departmentId, filters.status].filter((value) =>
        Boolean(value)
      ).length,
    [filters.budgetCodeSearch, filters.departmentId, filters.status]
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

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== '/') return
      const target = event.target as HTMLElement | null
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
      event.preventDefault()
      const mobile = document.getElementById('budget-monitor-search-sm')
      const desktop = document.getElementById('budget-monitor-search-md')
      const visible = [mobile, desktop].find((el) => el && el.offsetParent !== null)
      visible?.focus()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

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

  function clearFilters() {
    setFilters({})
    setFilterSheetOpen(false)
  }

  return (
    <div className="pb-8">
      <Tabs value={view} onValueChange={updateView}>
      {/* ── merged header: sticky app bar on mobile ─────────────── */}
      <div className="sticky top-0 z-30 -mx-4 mb-4 border-b bg-white/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-white/85 md:static md:mx-0 md:mb-0 md:border-0 md:bg-transparent md:px-0 md:backdrop-blur-none">
        {/* row 1 — title + stats · actions */}
        <div className="flex items-center justify-between gap-3 pt-3 md:pt-0">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2.5">
            <h1 className="whitespace-nowrap text-base font-bold tracking-tight text-gray-900 md:text-[15px]">
              Budget Monitor
            </h1>
            <p className="min-w-0 truncate text-xs text-muted-foreground md:text-[12.5px]">
              <span className="font-semibold tabular-nums text-gray-900">{remaining.total.toLocaleString()}</span>
              {' '}remaining · {remaining.groupCount} group{remaining.groupCount === 1 ? '' : 's'} ·{' '}
              {data.requests.length} request{data.requests.length === 1 ? '' : 's'}
            </p>
          </div>
          {/* mobile: icon-only actions */}
          <div className="flex shrink-0 gap-1.5 md:hidden">
            <Button type="button" variant="outline" size="icon" className="h-9 w-9" title="Paste budget codes" aria-label="Paste budget codes" onClick={() => setPasteDialogOpen(true)}>
              <ClipboardPaste className="h-4 w-4" />
            </Button>
            <Button type="button" variant="outline" size="icon" className="h-9 w-9" title="Reports" aria-label="Reports" onClick={handleExport} disabled={isPending}>
              <FileSpreadsheet className="h-4 w-4" />
            </Button>
            <Button type="button" size="icon" className="h-9 w-9" title="New budget code" aria-label="New budget code" onClick={() => setCreateDialogOpen(true)}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          {/* desktop: labeled actions */}
          <div className="hidden shrink-0 gap-2 md:flex">
            <Button type="button" variant="outline" size="sm" onClick={() => setPasteDialogOpen(true)}>
              <ClipboardPaste className="mr-2 h-4 w-4" />
              Paste budget codes
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={handleExport} disabled={isPending}>
              <FileSpreadsheet className="mr-2 h-4 w-4" />
              Reports
            </Button>
            <Button type="button" size="sm" onClick={() => setCreateDialogOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              New budget code
            </Button>
          </div>
        </div>

        {/* row 2 — tabs left · filters right, shared baseline */}
        <div className="mt-2 flex flex-col gap-2 md:mt-2.5 md:flex-row md:items-end md:justify-between md:gap-4">
            <TabsList className="h-auto w-full justify-start gap-5 rounded-none border-b border-border bg-transparent p-0 md:w-auto md:min-w-[16rem]">
              <TabsTrigger
                value="depts"
                className="group relative min-h-9 rounded-none border-b-2 border-transparent bg-transparent px-1 pb-1 pt-1.5 text-[13.5px] font-medium text-muted-foreground shadow-none transition-colors data-[state=active]:border-gray-900 data-[state=active]:font-semibold data-[state=active]:text-gray-900 data-[state=active]:shadow-none"
              >
                Budgets
              </TabsTrigger>
              <TabsTrigger
                value="requests"
                className="group relative min-h-9 rounded-none border-b-2 border-transparent bg-transparent px-1 pb-1 pt-1.5 text-[13.5px] font-medium text-muted-foreground shadow-none transition-colors data-[state=active]:border-gray-900 data-[state=active]:font-semibold data-[state=active]:text-gray-900 data-[state=active]:shadow-none"
              >
                Requests
                <span className="ml-1.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-amber-100 px-1 text-[10.5px] font-semibold text-amber-700 transition-colors group-data-[state=active]:bg-amber-500 group-data-[state=active]:text-white">
                  {unassignedCount}
                </span>
              </TabsTrigger>
            </TabsList>

            {/* mobile: search + filters button under tabs */}
            <div className="flex flex-1 items-center gap-1.5 py-2.5 md:hidden">
              <div className="min-w-0 flex-1">
                <BudgetSearchInput
                  id="budget-monitor-search-sm"
                  placeholder="Search code or request"
                  value={filters.budgetCodeSearch ?? ''}
                  options={budgetCodeOptions}
                  onChange={(value) => setFilters({ ...filters, budgetCodeSearch: value || undefined })}
                />
              </div>
              <Button
                type="button"
                variant={activeFilterCount > 0 ? 'default' : 'outline'}
                size="sm"
                className="h-9 shrink-0"
                onClick={() => setFilterSheetOpen(true)}
              >
                Filters
                {activeFilterCount > 0 ? (
                  <span className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-white/25 px-1 text-[10px] font-semibold">
                    {activeFilterCount}
                  </span>
                ) : null}
              </Button>
            </div>



          {/* desktop filters — right side of the shared baseline */}
          <div className="hidden min-w-0 flex-1 items-center justify-end gap-2 pb-1.5 md:flex">
            <div className="min-w-0 flex-1 md:max-w-md">
              <BudgetSearchInput
                id="budget-monitor-search-md"
                placeholder="Search code or request"
                value={filters.budgetCodeSearch ?? ''}
                options={budgetCodeOptions}
                onChange={(value) => setFilters({ ...filters, budgetCodeSearch: value || undefined })}
              />
            </div>
            {filters.departmentId ? (
              <button
                type="button"
                className="inline-flex h-9 items-center gap-1 rounded-full bg-gray-900 px-3 text-xs font-semibold text-white"
                onClick={() => setFilters({ ...filters, departmentId: undefined })}
                title="Clear department filter"
              >
                {data.filters.departments.find((d) => d.id === filters.departmentId)?.name ?? 'Department'}
                <span aria-hidden>✕</span>
              </button>
            ) : (
              <Select
                value={filters.departmentId ?? 'all'}
                onValueChange={(value) =>
                  setFilters({ ...filters, departmentId: value === 'all' ? undefined : value })
                }
              >
                <SelectTrigger className="h-9 w-auto min-w-[9rem] text-xs text-muted-foreground">
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
            )}
            {filters.status ? (
              <button
                type="button"
                className="inline-flex h-9 items-center gap-1 rounded-full bg-gray-900 px-3 text-xs font-semibold text-white"
                onClick={() => setFilters({ ...filters, status: undefined })}
                title="Clear status filter"
              >
                {filters.status}
                <span aria-hidden>✕</span>
              </button>
            ) : (
              <Select
                value={filters.status ?? 'all'}
                onValueChange={(value) =>
                  setFilters({ ...filters, status: value === 'all' ? undefined : value })
                }
              >
                <SelectTrigger className="h-9 w-auto min-w-[8rem] text-xs text-muted-foreground">
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
            )}
            {activeFilterCount > 0 ? (
              <button
                type="button"
                className="h-9 px-1 text-xs font-semibold text-muted-foreground underline underline-offset-2 hover:text-gray-900"
                onClick={() => setFilters({})}
              >
                Clear
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <TabsContent value="depts" className="mt-4 md:mt-5">
        <BudgetDepartmentPanel
          groups={renderableGroups}
          onEditBudgetCode={(group) => setEditDialog({ type: 'budget', group })}
          onOpenRequest={setDetailRequestId}
          onUnassign={async (requestId) => {
            try {
              await unassignRequestBudgetCode(requestId)
              toast.success('Request unassigned')
              refresh()
            } catch (error) {
              toast.error(error instanceof Error ? error.message : 'Failed to unassign request')
            }
          }}
              />
      </TabsContent>
      <TabsContent value="requests" className="mt-4 md:mt-5">
        <BudgetRequestTable
          requests={data.requests}
          budgetCodes={data.budgetCodes}
          onOpenRequest={setDetailRequestId}
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

      {/* ── mobile filter bottom sheet ──────────────────────────── */}
      <Dialog open={filterSheetOpen} onOpenChange={setFilterSheetOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              Filters
              {activeFilterCount > 0 ? (
                <span className="ml-1.5 text-sm font-normal text-muted-foreground">
                  · {activeFilterCount} active
                </span>
              ) : null}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Department</Label>
              <Select
                value={filters.departmentId ?? 'all'}
                onValueChange={(value) =>
                  setFilters({ ...filters, departmentId: value === 'all' ? undefined : value })
                }
              >
                <SelectTrigger className="h-10">
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
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Status</Label>
              <Select
                value={filters.status ?? 'all'}
                onValueChange={(value) =>
                  setFilters({ ...filters, status: value === 'all' ? undefined : value })
                }
              >
                <SelectTrigger className="h-10">
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
            <div className="flex gap-2 pt-1">
              <Button type="button" variant="outline" className="h-10 flex-1" onClick={clearFilters}>
                Clear
              </Button>
              <Button type="button" className="h-10 flex-1" onClick={() => setFilterSheetOpen(false)}>
                Apply
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

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

      {detailRequestId ? (
        <RequestModalRouter
          requestId={detailRequestId}
          open
          onOpenChange={(open) => {
            if (!open) setDetailRequestId(null)
          }}
          onActionComplete={refresh}
        />
      ) : null}
    </div>
  )
}
