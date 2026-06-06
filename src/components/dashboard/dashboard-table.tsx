'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  ColumnDef,
  ColumnFiltersState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  PaginationState,
  SortingState,
  useReactTable,
} from '@tanstack/react-table'
import { format, isWithinInterval, parseISO, endOfDay } from 'date-fns'
import { FileText, Clock, UserCircle } from 'lucide-react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { StatusBadge } from '@/components/requests/status-badge'
import { RejectedBadge } from '@/components/requests/rejected-badge'
import { RequestModalRouter } from '@/components/requests/request-modal-router'
import { ApprovalStatusBadge } from '@/components/requests/approval-status-badge'
import { TablePagination } from './table-pagination'
import { TableFilters, type DashboardFilters } from './table-filters'
import type { RequestListRow } from '@/server-actions/dashboard'
import { RequestCard, RequestCardsEmptyState } from '@/components/mobile/request-card'
import { filterRowsByWorkRequisition } from '@/lib/engineering-sub-tasks'

interface DashboardTableProps {
  initialData: RequestListRow[]
  dataFetchingFunction?: () => Promise<RequestListRow[]>
  departments: Array<{ id: string; name: string }>
  externalFilters?: DashboardFilters
  onFilterChange?: (filters: DashboardFilters) => void
  onModalOpen?: () => void
  onModalClose?: () => void
  onActionComplete?: () => void
}

export function DashboardTable({
  initialData,
  dataFetchingFunction,
  departments,
  externalFilters,
  onFilterChange,
  onModalOpen,
  onModalClose,
  onActionComplete,
}: DashboardTableProps) {
  const [data, setData] = useState<RequestListRow[]>(initialData)
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)

  // Sync data state when initialData prop changes (e.g., after refresh)
  useEffect(() => {
    setData(initialData)
  }, [initialData])

  // Memoize event handlers to prevent unnecessary re-renders of child components
  const handleRowClick = useCallback((requestId: string) => {
    setSelectedRequestId(requestId)
    setIsModalOpen(true)
    onModalOpen?.()
  }, [onModalOpen])

  const handleModalChange = useCallback((open: boolean) => {
    setIsModalOpen(open)
    if (!open) {
      onModalClose?.()
    }
  }, [onModalClose])

  const handleActionComplete = useCallback(async () => {
    // Call the parent's onActionComplete callback first
    onActionComplete?.()
    
    // Then refresh the table data
    if (dataFetchingFunction) {
      try {
        const freshData = await dataFetchingFunction()
        setData(freshData)
      } catch (error) {
        console.error('Failed to refresh after action:', error)
      }
    }
  }, [dataFetchingFunction, onActionComplete])

  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 10,
  })

  const [sorting, setSorting] = useState<SortingState>([])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])

  // Sync external filters to TanStack Table columnFilters
  useEffect(() => {
    const newFilters: ColumnFiltersState = []

    if (externalFilters?.search) {
      newFilters.push({ id: 'title', value: externalFilters.search })
    }

    if (externalFilters?.statuses && externalFilters.statuses.length > 0) {
      newFilters.push({ id: 'status', value: externalFilters.statuses })
    }

    if (externalFilters?.department) {
      newFilters.push({ id: 'departmentId', value: externalFilters.department })
    }

    if (externalFilters?.dateFrom || externalFilters?.dateTo) {
      newFilters.push({
        id: 'createdAt',
        value: {
          from: externalFilters.dateFrom,
          to: externalFilters.dateTo,
        },
      })
    }

    setColumnFilters(newFilters)

    // Reset pagination when filters change
    setPagination((prev) => ({ ...prev, pageIndex: 0 }))
  }, [externalFilters])

  const handleFilterChange = useCallback((filters: DashboardFilters) => {
    onFilterChange?.(filters)
  }, [onFilterChange])

  // Memoize column definitions to prevent recreation on every render
  const columns: ColumnDef<RequestListRow>[] = useMemo(() => [
    {
      accessorKey: 'title',
      header: 'Title',
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <span className="font-medium">{row.getValue('title')}</span>
          {row.original.hasRejection && (row.original.status === 'ImprovementRequest' || row.original.status === 'SentToEngineer') && <RejectedBadge size="sm" showText={false} />}
        </div>
      ),
      filterFn: 'includesString',
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => (
        <StatusBadge
          status={row.getValue('status') as any}
          hasRejection={row.original.hasRejection && (row.original.status === 'ImprovementRequest' || row.original.status === 'SentToEngineer')}
        />
      ),
      // Filter function for status multi-select (OR logic)
      filterFn: (row, columnId, filterValue: string[]) => {
        if (!filterValue || filterValue.length === 0) return true
        const rowValue = row.getValue(columnId) as string
        return filterValue.includes(rowValue)
      },
    },
    {
      id: 'approvalStatus',
      header: 'Approval Status',
      cell: ({ row }) => (
        <div className="flex justify-center">
          <ApprovalStatusBadge
            key={`approvals-${row.original.id}-${row.original.approvals?.map(a => a.status).join('-')}`}
            approvals={row.original.approvals || []}
            requestStatus={row.original.status}
            size="sm"
          />
        </div>
      ),
    },
    {
      id: 'pic',
      header: 'PIC',
      cell: ({ row }) => {
        const assignments = row.original.engineerAssignments
        if (!assignments || assignments.length === 0) return <span className="text-gray-400">—</span>
        return (
          <div className="flex items-center gap-1.5">
            <UserCircle className="h-3.5 w-3.5 text-blue-500 flex-shrink-0" />
            <span className="text-sm text-gray-700 truncate max-w-[150px]" title={assignments.map(a => a.engineer.name).join(', ')}>
              {assignments.map(a => a.engineer.name.split(' ')[0]).join(', ')}
            </span>
          </div>
        )
      },
    },
    {
      accessorKey: 'requester',
      header: 'Requester',
      cell: ({ row }) => row.original.requester?.name || '—',
    },
    {
      accessorKey: 'department',
      header: 'Department',
      cell: ({ row }) => row.original.department?.name || '—',
    },
    {
      accessorKey: 'createdAt',
      header: 'Date',
      cell: ({ row }) => {
        const date = new Date(row.getValue('createdAt'))
        return (
          <div className="flex items-center gap-1 text-sm text-gray-500">
            <Clock className="h-3 w-3" />
            {format(date, 'MMM d, yyyy')}
          </div>
        )
      },
      // Custom filter function for date range
      filterFn: (row, columnId, filterValue: { from?: string; to?: string }) => {
        if (!filterValue || (!filterValue.from && !filterValue.to)) return true

        const rowDate = parseISO(row.getValue(columnId) as string)

        if (filterValue.from && filterValue.to) {
          return isWithinInterval(rowDate, {
            start: parseISO(filterValue.from),
            end: endOfDay(parseISO(filterValue.to)),
          })
        }

        if (filterValue.from) {
          return rowDate >= parseISO(filterValue.from)
        }

        if (filterValue.to) {
          return rowDate <= endOfDay(parseISO(filterValue.to))
        }

        return true
      },
    },
  ], [])

  const tableData = useMemo(
    () => filterRowsByWorkRequisition(data, externalFilters?.wrStatus),
    [data, externalFilters?.wrStatus]
  )

  const table = useReactTable({
    data: tableData,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    state: {
      pagination,
      sorting,
      columnFilters,
    },
    onPaginationChange: setPagination,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
  })

  return (
    <>
      <TableFilters
        departments={departments}
        onFilterChange={handleFilterChange}
        initialFilters={externalFilters}
      />

      {/* Mobile card view */}
      <div className="md:hidden space-y-3 mt-4">
        {table.getRowModel().rows?.length ? (
          table.getRowModel().rows.map((row) => (
            <RequestCard
              key={row.id}
              request={row.original}
              onTap={handleRowClick}
              showRequester={true}
              showDepartment={true}
            />
          ))
        ) : (
          <RequestCardsEmptyState message="No requests found" submessage="Try adjusting your filters" />
        )}
      </div>

      {/* Desktop table view */}
      <div className="hidden md:block border rounded-md overflow-x-auto mt-4">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  className="cursor-pointer hover:bg-gray-50"
                  onClick={() => handleRowClick(row.original.id)}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center">
                  <div className="flex flex-col items-center justify-center text-gray-500">
                    <FileText className="h-8 w-8 mb-2 opacity-50" />
                    <p>No requests found</p>
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination component (works for both views) */}
      <TablePagination table={table} />

      {selectedRequestId && (
        <RequestModalRouter
          requestId={selectedRequestId}
          open={isModalOpen}
          onOpenChange={handleModalChange}
          onActionComplete={handleActionComplete}
        />
      )}
    </>
  )
}
