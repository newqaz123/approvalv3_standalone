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
import { deactivateUser, activateUser } from '@/server-actions/users'
import { UserWithDepartment } from '@/server-actions/users'
import { EditUserDialog } from '@/components/admin/edit-user-dialog'
import { ResetPasswordDialog } from '@/components/admin/reset-password-dialog'
import { isAdminRole } from '@/lib/user-role'
import { AdminCard, AdminCardsEmptyState } from '@/components/mobile/admin-card'
import { toast } from 'sonner'
import { Mail, Building, Shield } from 'lucide-react'
import { useTranslations } from '@/lib/i18n/client'

interface UserTableProps {
  data: UserWithDepartment[]
}

function organizationLabel(user: UserWithDepartment, unassigned: string): string {
  if (user.organizationAssignment) {
    return `${user.organizationAssignment.unitName} · ${user.organizationAssignment.positionName}`
  }
  return unassigned
}

export function UserTable({ data }: UserTableProps) {
  const t = useTranslations()
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
      router.refresh()
    } catch {
      toast.error(t('admin.userStatusFailed'))
    } finally {
      setProcessingId(null)
    }
  }

  const columns: ColumnDef<UserWithDepartment>[] = [
    {
      accessorKey: 'name',
      header: t('admin.name'),
      cell: ({ row }) => row.getValue('name'),
    },
    {
      accessorKey: 'email',
      header: t('admin.email'),
      cell: ({ row }) => row.getValue('email'),
    },
    {
      accessorKey: 'department',
      header: t('admin.unitAndPosition'),
      cell: ({ row }) => organizationLabel(row.original, t('admin.unassigned')),
    },
    {
      accessorKey: 'role',
      header: t('admin.role'),
      cell: ({ row }) => isAdminRole(row.original.role) ? t('admin.admin') : '',
    },
    {
      accessorKey: 'isActive',
      header: t('common.status'),
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
                <span className="sr-only">{t('admin.openMenu')}</span>
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
                {t('admin.editUser')}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setResetPasswordUser({ id: user.id, name: user.name || t('admin.thisUser') })}
                className="flex items-center gap-2"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
                {t('admin.resetPassword')}
              </DropdownMenuItem>
              {user.isActive ? (
                <DropdownMenuItem
                  onClick={() => setUserToDeactivate({ id: user.id, name: user.name || t('admin.thisUser') })}
                  disabled={processingId === user.id}
                  className="text-destructive focus:text-destructive flex items-center gap-2"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                  </svg>
                  {t('admin.deactivate')}
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
                  {t('admin.activate')}
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
      <div className="md:hidden space-y-3">
        {data.length > 0 ? (
          data.map((user) => (
            <AdminCard
              key={user.id}
              title={user.name || t('admin.unnamedUser')}
              status={{
                label: user.isActive ? 'Active' : 'Inactive',
                variant: user.isActive ? 'success' : 'secondary',
              }}
              details={[
                {
                  label: t('admin.email'),
                  value: user.email,
                  icon: <Mail className="h-3.5 w-3.5" />,
                },
                {
                  label: t('admin.unitAndPosition'),
                  value: organizationLabel(user, t('admin.unassigned')),
                  icon: <Building className="h-3.5 w-3.5" />,
                },
                {
                  label: t('admin.role'),
                  value: isAdminRole(user.role) ? t('admin.admin') : '',
                  icon: <Shield className="h-3.5 w-3.5" />,
                },
              ]}
              badges={[]}
              actions={[
                {
                  label: t('admin.edit'),
                  onClick: () => setEditingUserId(user.id),
                },
                {
                  label: t('admin.resetPassword'),
                  onClick: () => setResetPasswordUser({ id: user.id, name: user.name || t('admin.thisUser') }),
                },
                {
                  label: user.isActive ? t('admin.deactivate') : t('admin.activate'),
                  onClick: user.isActive
                    ? () => setUserToDeactivate({ id: user.id, name: user.name || t('admin.thisUser') })
                    : () => handleToggleActive(user.id, false),
                  destructive: user.isActive,
                  disabled: processingId === user.id,
                },
              ]}
            />
          ))
        ) : (
          <AdminCardsEmptyState message={t('admin.noUsers')} />
        )}
      </div>

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
                  {t('admin.noUsersPeriod')}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {editingUserId && (
        <EditUserDialog
          user={{
            id: data.find(u => u.id === editingUserId)!.id,
            name: data.find(u => u.id === editingUserId)!.name,
            email: data.find(u => u.id === editingUserId)!.email,
            isAdmin: isAdminRole(data.find(u => u.id === editingUserId)!.role),
          }}
          open={true}
          onOpenChange={(open) => !open && setEditingUserId(null)}
        />
      )}

      <AlertDialog open={!!userToDeactivate} onOpenChange={(open) => !open && setUserToDeactivate(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('admin.deactivateUser')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('admin.deactivateUserConfirm', { name: userToDeactivate?.name ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
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
              {processingId === userToDeactivate?.id ? t('admin.deactivating') : t('admin.deactivate')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <ResetPasswordDialog
        userId={resetPasswordUser?.id || ''}
        userName={resetPasswordUser?.name || ''}
        open={!!resetPasswordUser}
        onOpenChange={(open) => !open && setResetPasswordUser(null)}
      />
    </>
  )
}
