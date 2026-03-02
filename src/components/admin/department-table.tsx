'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { deleteDepartment } from '@/server-actions/departments'
import { EditDepartmentDialog } from '@/components/admin/edit-department-dialog'
import { AdminCard, AdminCardsEmptyState } from '@/components/mobile/admin-card'
import { Building, Users, Layers, Hash } from 'lucide-react'

interface DepartmentWithCount {
  id: string
  name: string
  type: 'GENERAL' | 'ENGINEERING'
  levelNames?: Record<string, string> | null
  _count: {
    users: number // members + external approvers
  }
}

interface DepartmentTableProps {
  data: DepartmentWithCount[]
}

export function DepartmentTable({ data }: DepartmentTableProps) {
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this department?')) {
      return
    }

    setDeletingId(id)
    try {
      await deleteDepartment(id)
      // Force page reload to refresh data
      window.location.reload()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete department')
    } finally {
      setDeletingId(null)
    }
  }

  const columns: ColumnDef<DepartmentWithCount>[] = [
    {
      accessorKey: 'id',
      header: 'ID',
      cell: ({ row }) => <span className="font-mono text-sm">{row.getValue('id')}</span>,
    },
    {
      accessorKey: 'name',
      header: 'Name',
      cell: ({ row }) => row.getValue('name'),
    },
    {
      accessorKey: 'type',
      header: 'Type',
      cell: ({ row }) => {
        const type = row.getValue('type') as string
        return (
          <span className={`px-2 py-1 rounded-full text-xs ${
            type === 'ENGINEERING'
              ? 'bg-blue-100 text-blue-800'
              : 'bg-gray-100 text-gray-800'
          }`}>
            {type === 'ENGINEERING' ? 'Engineering' : 'General'}
          </span>
        )
      },
    },
    {
      accessorKey: '_count.users',
      header: 'Users',
      cell: ({ row }) => row.original._count.users,
    },
    {
      id: 'levels',
      header: 'Levels',
      cell: ({ row }) => {
        const levelNames = row.original.levelNames
        if (!levelNames || Object.keys(levelNames).length === 0) {
          return <span className="text-muted-foreground text-xs">None</span>
        }
        const count = Object.keys(levelNames).length
        return (
          <span className="text-xs text-muted-foreground">
            {count} level{count !== 1 ? 's' : ''} configured
          </span>
        )
      },
    },
    {
      id: 'actions',
      cell: ({ row }) => {
        const dept = row.original
        const canDelete = dept._count.users === 0
        return (
          <div className="flex items-center gap-1">
            <EditDepartmentDialog
              department={{
                id: dept.id,
                name: dept.name,
                type: dept.type,
                levelNames: dept.levelNames as Record<string, string> | null,
              }}
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm">Actions</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild>
                  <Link href={`/admin/departments/${dept.id}/hierarchy`}>
                    View Hierarchy
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => handleDelete(dept.id)}
                  disabled={!canDelete || deletingId === dept.id}
                  className={!canDelete ? 'text-gray-400' : 'text-red-600'}
                >
                  {canDelete ? 'Delete' : 'Has users'}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )
      },
    },
  ]

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
          data.map((dept) => {
            const levelCount = dept.levelNames ? Object.keys(dept.levelNames).length : 0
            const canDelete = dept._count.users === 0
            return (
              <AdminCard
                key={dept.id}
                title={dept.name}
                details={[
                  {
                    label: 'Type',
                    value: dept.type === 'ENGINEERING' ? 'Engineering' : 'General',
                    icon: <Building className="h-3.5 w-3.5" />,
                  },
                  {
                    label: 'Users',
                    value: String(dept._count.users),
                    icon: <Users className="h-3.5 w-3.5" />,
                  },
                  ...(levelCount > 0 ? [{
                    label: 'Levels',
                    value: `${levelCount} level${levelCount !== 1 ? 's' : ''} configured`,
                    icon: <Layers className="h-3.5 w-3.5" />,
                  }] : []),
                  {
                    label: 'ID',
                    value: dept.id,
                    icon: <Hash className="h-3.5 w-3.5" />,
                  },
                ]}
                badges={[]}
                actions={[
                  {
                    label: 'View Hierarchy',
                    asChild: true,
                    href: `/admin/departments/${dept.id}/hierarchy`,
                  },
                  {
                    label: canDelete ? 'Delete' : 'Has users',
                    onClick: canDelete ? () => handleDelete(dept.id) : undefined,
                    destructive: canDelete,
                    disabled: !canDelete || deletingId === dept.id,
                  },
                ]}
              />
            )
          })
        ) : (
          <AdminCardsEmptyState message="No departments found" />
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
                <TableRow key={row.id}>
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
                  No departments found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </>
  )
}
