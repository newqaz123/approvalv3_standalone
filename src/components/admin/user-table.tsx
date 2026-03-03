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
import type { departments as Department } from '@prisma/client'
import { EditUserDialog } from '@/components/admin/edit-user-dialog'
import { ResetPasswordDialog } from '@/components/admin/reset-password-dialog'
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
  const [resetPasswordUser, setResetPasswordUser] = useState<{ id: string; name: string } | null>(null)

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
        const additionalDepts = row.original.departmentApproverRoles || []
        const primaryDeptId = row.original.department?.id
        
        // Filter out the user's primary department from additional departments
        const filteredDepts = additionalDepts.filter(
          role => role.department.id !== primaryDeptId
        )
        
        if (filteredDepts.length === 0) {
          return <span className="text-muted-foreground text-xs">-</span>
        }
        
        // Display department names as badges
        return (
          <div className="flex flex-wrap gap-1">
            {filteredDepts.map((role) => (
              <Badge key={role.id} variant="secondary" className="text-xs">
                {role.department.name}
              </Badge>
            ))}
          </div>
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
              <DropdownMenuItem
                onClick={() => setEditingUserId(user.id)}
                className="flex items-center gap-2"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
                Edit User
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setResetPasswordUser({ id: user.id, name: user.name || 'this user' })}
                className="flex items-center gap-2"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
                Reset Password
              </DropdownMenuItem>
              {user.isActive ? (
                <DropdownMenuItem
                  onClick={() => setUserToDeactivate({ id: user.id, name: user.name || 'this user' })}
                  disabled={processingId === user.id}
                  className="text-destructive focus:text-destructive flex items-center gap-2"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                  </svg>
                  Deactivate
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  onClick={() => handleToggleActive(user.id, false)}
                  disabled={processingId === user.id}
                  className="flex items-center gap-2"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Activate
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
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
            const additionalDepts = user.departmentApproverRoles || []
            const primaryDeptId = user.department?.id
            
            // Filter out the user's primary department from additional departments
            const filteredDepts = additionalDepts.filter(
              role => role.department.id !== primaryDeptId
            )
            
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
                  ...(filteredDepts.length > 0 ? [{
                    label: 'Additional Depts',
                    value: filteredDepts.map(role => role.department.name).join(', '),
                  }] : []),
                ]}
                badges={[]}
                actions={[
                  {
                    label: 'Edit',
                    onClick: () => setEditingUserId(user.id),
                  },
                  {
                    label: 'Reset Password',
                    onClick: () => setResetPasswordUser({ id: user.id, name: user.name || 'this user' }),
                  },
                  {
                    label: user.isActive ? 'Deactivate' : 'Activate',
                    onClick: user.isActive 
                      ? () => setUserToDeactivate({ id: user.id, name: user.name || 'this user' })
                      : () => handleToggleActive(user.id, false),
                    destructive: user.isActive,
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

      {/* Single edit dialog controlled by state */}
      {editingUserId && (
        <EditUserDialog
          user={{
            id: data.find(u => u.id === editingUserId)!.id,
            name: data.find(u => u.id === editingUserId)!.name,
            email: data.find(u => u.id === editingUserId)!.email,
            departmentId: data.find(u => u.id === editingUserId)!.department?.id || null,
            role: data.find(u => u.id === editingUserId)!.role,
            level: data.find(u => u.id === editingUserId)!.level,
          }}
          departments={departments}
          open={true}
          onOpenChange={(open) => !open && setEditingUserId(null)}
        />
      )}

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
      {/* Reset Password Dialog */}
      <ResetPasswordDialog
        userId={resetPasswordUser?.id || ''}
        userName={resetPasswordUser?.name || ''}
        open={!!resetPasswordUser}
        onOpenChange={(open) => !open && setResetPasswordUser(null)}
      />
    </>
  )
}
