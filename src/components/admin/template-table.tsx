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
import { setTemplateDefault, toggleTemplateStatus, deleteTemplate } from '@/server-actions/templates'
import { AdminCard, AdminCardsEmptyState } from '@/components/mobile/admin-card'
import { FileText, CheckCircle2, XCircle, Power, Calendar, MoreVertical } from 'lucide-react'
import { useTranslations } from '@/lib/i18n/client'

interface Template {
  id: string
  name: string
  title: string
  description: string
  isDefault: boolean
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

interface TemplatesTableProps {
  data: Template[]
}

export function TemplatesTable({ data }: TemplatesTableProps) {
  const t = useTranslations()
  const [actioningId, setActioningId] = useState<string | null>(null)

  const handleSetDefault = async (id: string) => {
    setActioningId(id)
    try {
      await setTemplateDefault(id)
      window.location.reload()
    } catch (err) {
      alert(t('admin.setDefaultFailed'))
    } finally {
      setActioningId(null)
    }
  }

  const handleToggleStatus = async (id: string) => {
    setActioningId(id)
    try {
      await toggleTemplateStatus(id)
      window.location.reload()
    } catch (err) {
      alert(t('admin.setStatusFailed'))
    } finally {
      setActioningId(null)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm(t('admin.confirmDeleteTemplate'))) {
      return
    }

    setActioningId(id)
    try {
      await deleteTemplate(id)
      window.location.reload()
    } catch (err) {
      alert(t('admin.deleteTemplateFailed'))
    } finally {
      setActioningId(null)
    }
  }

  const columns: ColumnDef<Template>[] = [
    {
      accessorKey: 'name',
      header: t('admin.internalName'),
      cell: ({ row }) => row.getValue('name'),
    },
    {
      accessorKey: 'title',
      header: t('admin.title'),
      cell: ({ row }) => row.getValue('title'),
    },
    {
      accessorKey: 'description',
      header: t('admin.description'),
      cell: ({ row }) => {
        const desc = row.getValue('description') as string
        return (
          <div className="max-w-md truncate" title={desc}>
            {desc}
          </div>
        )
      },
    },
    {
      accessorKey: 'isDefault',
      header: t('admin.default'),
      cell: ({ row }) => {
        const isDefault = row.getValue('isDefault') as boolean
        return isDefault ? (
          <span className="flex items-center gap-1 text-green-600 font-medium">
            <CheckCircle2 className="h-4 w-4" />
            {t('admin.yes')}
          </span>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleSetDefault(row.original.id)}
            disabled={actioningId === row.original.id}
            className="h-7 px-2 text-xs"
          >
            {t('admin.setDefault')}
          </Button>
        )
      },
    },
    {
      accessorKey: 'isActive',
      header: t('common.status'),
      cell: ({ row }) => {
        const isActive = row.getValue('isActive') as boolean
        const isDefault = row.getValue('isDefault') as boolean
        return (
          <div className="flex items-center gap-2">
            <span className={`flex items-center gap-1 ${isActive ? 'text-green-600' : 'text-gray-400'}`}>
              {isActive ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
              {isActive ? 'Active' : 'Inactive'}
            </span>
            {!isDefault && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleToggleStatus(row.original.id)}
                disabled={actioningId === row.original.id}
                title={isActive ? t('admin.deactivate') : t('admin.activate')}
              >
                <Power className={`h-4 w-4 ${isActive ? 'text-yellow-600' : ''}`} />
              </Button>
            )}
          </div>
        )
      },
    },
    {
      accessorKey: 'createdAt',
      header: t('admin.created'),
      cell: ({ row }) => {
        const date = new Date(row.getValue('createdAt') as string)
        return date.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })
      },
    },
    {
      id: 'actions',
      header: t('admin.actions'),
      cell: ({ row }) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="h-11 w-11 p-0">
              <span className="sr-only">{t('admin.openMenu')}</span>
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link href={`/admin/templates/${row.original.id}`}>
                {t('admin.edit')}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => handleDelete(row.original.id)}
              disabled={actioningId === row.original.id || row.original.isDefault}
              className="text-destructive focus:text-destructive"
            >
              {t('admin.delete')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
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
          data.map((template) => {
            const isDefault = template.isDefault
            const isActive = template.isActive
            return (
              <AdminCard
                key={template.id}
                title={template.title}
                status={{
                  label: isActive ? 'Active' : 'Inactive',
                  variant: isActive ? 'success' : 'secondary',
                }}
                details={[
                  {
                    label: t('admin.name'),
                    value: template.name,
                    icon: <FileText className="h-3.5 w-3.5" />,
                  },
                  {
                    label: t('admin.description'),
                    value: template.description,
                  },
                  {
                    label: t('admin.created'),
                    value: new Date(template.createdAt).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }),
                    icon: <Calendar className="h-3.5 w-3.5" />,
                  },
                ].filter(Boolean)}
                badges={[
                  ...(isDefault ? [{ label: t('admin.default'), variant: 'success' as const }] : []),
                ]}
                actions={[
                  ...(!isDefault ? [{
                    label: t('admin.setDefault'),
                    onClick: () => handleSetDefault(template.id),
                    disabled: actioningId === template.id,
                  }] : []),
                  ...(!isDefault ? [{
                    label: isActive ? t('admin.deactivate') : t('admin.activate'),
                    onClick: () => handleToggleStatus(template.id),
                    disabled: actioningId === template.id,
                  }] : []),
                  {
                    label: t('admin.edit'),
                    asChild: true,
                    href: `/admin/templates/${template.id}`,
                  },
                  {
                    label: t('admin.delete'),
                    onClick: () => handleDelete(template.id),
                    destructive: true,
                    disabled: actioningId === template.id || isDefault,
                  },
                ]}
              />
            )
          })
        ) : (
          <AdminCardsEmptyState
            message={t('admin.noTemplates')}
            submessage={t('admin.createTemplateToStart')}
          />
        )}
      </div>

      {/* Desktop table view */}
      <div className="hidden md:block rounded-md border">
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
                  {t('admin.noTemplatesDescription')}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </>
  )
}
