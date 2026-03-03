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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
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
  const [deptToDelete, setDeptToDelete] = useState<{ id: string; name: string } | null>(null)

  const handleDelete = async (id: string) => {
    setDeletingId(id)
    try {
      await deleteDepartment(id)
      // Force page reload to refresh data
      window.location.reload()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete department')
    } finally {
      setDeletingId(null)
      setDeptToDelete(null)
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
          <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${
            type === 'ENGINEERING'
              ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 border border-blue-200 dark:border-blue-800'
              : 'bg-gray-50 text-gray-700 dark:bg-gray-900/30 dark:text-gray-300 border border-gray-200 dark:border-gray-700'
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
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="h-8 w-8 p-0 hover:bg-muted/50 transition-colors"
                >
                  <span className="sr-only">Open menu</span>
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
                  </svg>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[160px]">
                <DropdownMenuItem asChild>
                  <Link href={`/admin/departments/${dept.id}/hierarchy`} className="flex items-center gap-2">
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                    </svg>
                    View Hierarchy
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setDeptToDelete({ id: dept.id, name: dept.name })}
                  disabled={!canDelete || deletingId === dept.id}
                  className={!canDelete ? 'text-muted-foreground flex items-center gap-2' : 'text-destructive focus:text-destructive flex items-center gap-2'}
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
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
                    onClick: canDelete ? () => setDeptToDelete({ id: dept.id, name: dept.name }) : undefined,
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
      <div className="hidden md:block border rounded-lg overflow-hidden shadow-sm">
        <Table>
          <TableHeader className="bg-muted/30">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="border-b">
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id} className="font-semibold text-sm text-muted-foreground">
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
                  className="border-b hover:bg-muted/20 transition-colors cursor-pointer"
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className="py-3">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center text-muted-foreground">
                  No departments found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Delete confirmation dialog */}
      <AlertDialog open={!!deptToDelete} onOpenChange={(open) => !open && setDeptToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Department</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{deptToDelete?.name}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deptToDelete) {
                  handleDelete(deptToDelete.id)
                }
              }}
              disabled={deletingId !== null}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {deletingId === deptToDelete?.id ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
