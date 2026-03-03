'use client'

import { useState, useMemo, useCallback } from 'react'
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table'
import { format } from 'date-fns'
import { FileText, Clock } from 'lucide-react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { StatusBadge } from './status-badge'
import { RequestDetailModal } from './request-detail-modal'
import { RejectedBadge } from './rejected-badge'
import { RequestCard, RequestCardsEmptyState } from '@/components/mobile/request-card'
import { ApprovalStatusBadge } from './approval-status-badge'

export type RequestListRow = {
  id: string
  title: string
  status: string
  createdAt: Date
  requesterId: string
  department: { name: string } | null
  requester: { id: string; name: string } | null
  _count: { fileAttachments: number }
  hasRejection?: boolean
  approvals?: Array<{
    id: string
    status: 'pending' | 'approved' | 'rejected'
    approver?: { name: string } | null
    requiredLevel: number
    order: number
    approvedAt?: Date | null
  }>
}

interface RequestTableProps {
  initialData: RequestListRow[]
  onDataRefresh?: () => void
}

export function RequestTable({ initialData, onDataRefresh }: RequestTableProps) {
  const [data] = useState<RequestListRow[]>(initialData)
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)

  // Memoize event handler to prevent unnecessary re-renders
  const handleRowClick = useCallback((requestId: string) => {
    setSelectedRequestId(requestId)
    setIsModalOpen(true)
  }, [])

  // Memoize column definitions to prevent recreation on every render
  const columns: ColumnDef<RequestListRow>[] = useMemo(() => [
    {
      accessorKey: 'title',
      header: 'Title',
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <span className="font-medium">{row.getValue('title')}</span>
          {row.original.hasRejection && <RejectedBadge size="sm" showText={false} />}
        </div>
      ),
    },
    {
      accessorKey: 'requester',
      header: 'Requester',
      cell: ({ row }) => row.original.requester?.name || '—',
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => (
        <StatusBadge
          status={row.getValue('status') as any}
          hasRejection={row.original.hasRejection}
        />
      ),
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
      accessorKey: 'department',
      header: 'Department',
      cell: ({ row }) => row.original.department?.name || '—',
    },
    {
      accessorKey: '_count.fileAttachments',
      header: 'Files',
      cell: ({ row }) => {
        const count = row.original._count.fileAttachments
        return count > 0 ? (
          <div className="flex items-center gap-1">
            <FileText className="h-4 w-4 text-gray-400" />
            <span>{count}</span>
          </div>
        ) : null
      },
    },
    {
      accessorKey: 'createdAt',
      header: 'Created',
      cell: ({ row }) => {
        const date = new Date(row.getValue('createdAt'))
        return (
          <div className="flex items-center gap-1 text-sm text-gray-500">
            <Clock className="h-3 w-3" />
            {format(date, 'MMM d, yyyy')}
          </div>
        )
      },
    },
  ], [])

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
  })

  return (
    <>
      {/* Mobile card view */}
      <div className="md:hidden space-y-3">
        {data.length > 0 ? (
          data.map((request) => (
            <RequestCard
              key={request.id}
              request={request}
              onTap={handleRowClick}
            />
          ))
        ) : (
          <RequestCardsEmptyState />
        )}
      </div>

      {/* Desktop table view */}
      <div className="hidden md:block border rounded-md">
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
                    <p className="text-sm">Create your first request to get started</p>
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {selectedRequestId && (
        <RequestDetailModal
          requestId={selectedRequestId}
          open={isModalOpen}
          onOpenChange={setIsModalOpen}
          onActionComplete={onDataRefresh}
        />
      )}
    </>
  )
}
