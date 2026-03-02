'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
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
import { Badge } from '@/components/ui/badge'
import { deactivateUser, activateUser } from '@/server-actions/users'
import { UserWithDepartment } from '@/server-actions/users'
import { Department } from '@prisma/client'
import { EditUserDialog } from '@/components/admin/edit-user-dialog'
import { AdminCard, AdminCardsEmptyState } from '@/components/mobile/admin-card'
import { Mail, Building, Shield, Hash } from 'lucide-react'

interface UserTableProps {
  data: UserWithDepartment[]
  departments: Department[]
}

export function UserTable({ data, departments }: UserTableProps) {
  const router = useRouter()
  const [processingId, setProcessingId] = useState<string | null>(null)
  const [userToDeactivate, setUserToDeactivate] = useState<{ id: string; name: string } | null>(null)
  const [editingUserId, setEditingUserId] = useState<string | null>(null)

  const handleToggleActive = async (userId: string, isActive: boolean) => {
    setProcessingId(userId)
    try {
      if (isActive) {
        await deactivateUser(userId)
      } else {
        await activateUser(userId)
      }
      // Refresh data without full page reload
      router.refresh()
    } finally {
      setProcessingId(null)
    }
  }

  const columns: ColumnDef<UserWithDepartment>[] = [
    {
      accessorKey: 'name',
      header: 'Name',
      cell: ({ row }) => row.getValue('name'),
    },
    {
      accessorKey: 'email',
      header: 'Email',
      cell: ({ row }) => row.getValue('email'),
    },
    {
      accessorKey: 'department',
      header: 'Department',
      cell: ({ row }) => row.original.department?.name || 'None',
    },
    {
      id: 'additionalDepts',
      header: 'Additional Depts',
      cell: ({ row }) => {
        const count = (row.original as any)._count?.departmentApproverRoles || 0
        return count > 0 ? (
          <Badge variant="secondary">+{count} dept{count > 1 ? 's' : ''}</Badge>
        ) : (
          <span className="text-muted-foreground text-xs">-</span>
        )
      },
    },
    {
      accessorKey: 'role',
      header: 'Role',
      cell: ({ row }) => {
        const role = row.getValue('role') as string
        const roleLabels: Record<string, string> = {
          admin: 'Admin',
          general_dept: 'General Dept',
          engineering: 'Engineering',
        }
        return roleLabels[role] || role
      },
    },
    {
      accessorKey: 'level',
      header: 'Level',
      cell: ({ row }) => {
        const level = row.original.level
        return level !== null && level !== undefined ? (
          <span className="px-2 py-1 rounded-full text-xs bg-blue-100 text-blue-800">
            Level {level}
          </span>
        ) : (
          <span className="text-muted-foreground text-xs">-</span>
        )
      },
    },
    {
      accessorKey: 'isActive',
      header: 'Status',
      cell: ({ row }) => {
        const isActive = row.getValue('isActive') as boolean
        return (
          <span className={`px-2 py-1 rounded-full text-xs ${
            isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
          }`}>
            {isActive ? 'Active' : 'Inactive'}
          </span>
        )
      },
    },
    {
      id: 'actions',
      cell: ({ row }) => {
        const user = row.original
        return (
          <div className="flex items-center gap-1">
            <EditUserDialog
              user={{
                id: user.id,
                name: user.name,
                email: user.email,
                departmentId: user.department?.id || null,
                role: user.role,
                level: user.level,
              }}
              departments={departments}
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm">Actions</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {user.isActive ? (
                  <DropdownMenuItem
                    onClick={() => setUserToDeactivate({ id: user.id, name: user.name || 'this user' })}
                    disabled={processingId === user.id}
                    className="text-destructive focus:text-destructive"
                  >
                    Deactivate
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem
                    onClick={() => handleToggleActive(user.id, false)}
                    disabled={processingId === user.id}
                  >
                    Activate
                  </DropdownMenuItem>
                )}
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
          data.map((user) => {
            const additionalDeptCount = (user as any)._count?.departmentApproverRoles || 0
            return (
              <AdminCard
                key={user.id}
                title={user.name || 'Unnamed User'}
                status={{
                  label: user.isActive ? 'Active' : 'Inactive',
                  variant: user.isActive ? 'success' : 'secondary',
                }}
                details={[
                  {
                    label: 'Email',
                    value: user.email,
                    icon: <Mail className="h-3.5 w-3.5" />,
                  },
                  {
                    label: 'Department',
                    value: user.department?.name || 'None',
                    icon: <Building className="h-3.5 w-3.5" />,
                  },
                  {
                    label: 'Role',
                    value: {
                      admin: 'Admin',
                      general_dept: 'General Dept',
                      engineering: 'Engineering',
                    }[user.role] || user.role,
                    icon: <Shield className="h-3.5 w-3.5" />,
                  },
                  ...(user.level !== null && user.level !== undefined ? [{
                    label: 'Level',
                    value: `Level ${user.level}`,
                    icon: <Hash className="h-3.5 w-3.5" />,
                  }] : []),
                  ...(additionalDeptCount > 0 ? [{
                    label: 'Additional Depts',
                    value: `+${additionalDeptCount} dept${additionalDeptCount > 1 ? 's' : ''}`,
                  }] : []),
                ]}
                badges={[]}
                actions={[
                  {
                    label: 'Edit',
                    onClick: () => setEditingUserId(user.id),
                  },
                  user.isActive
                    ? {
                        label: 'Deactivate',
                        onClick: () => setUserToDeactivate({ id: user.id, name: user.name || 'this user' }),
                        destructive: true,
                        disabled: processingId === user.id,
                      }
                    : {
                        label: 'Activate',
                        onClick: () => handleToggleActive(user.id, false),
                        disabled: processingId === user.id,
                      },
                ]}
              />
            )
          })
        ) : (
          <AdminCardsEmptyState message="No users found" />
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
                  No users found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Mobile edit dialogs - render all but only open one at a time */}
      {data.map((user) => (
        <EditUserDialog
          key={`edit-${user.id}`}
          user={{
            id: user.id,
            name: user.name,
            email: user.email,
            departmentId: user.department?.id || null,
            role: user.role,
            level: user.level,
          }}
          departments={departments}
        />
      ))}

      {/* AlertDialog for deactivation confirmation */}
      <AlertDialog open={!!userToDeactivate} onOpenChange={(open) => !open && setUserToDeactivate(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate User</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to deactivate {userToDeactivate?.name}?
              They will no longer be able to log in or perform actions in the system.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (userToDeactivate) {
                  handleToggleActive(userToDeactivate.id, true)
                  setUserToDeactivate(null)
                }
              }}
              disabled={processingId !== null}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {processingId === userToDeactivate?.id ? 'Deactivating...' : 'Deactivate'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
