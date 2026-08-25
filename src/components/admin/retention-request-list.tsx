'use client'

import { useMemo, useState } from 'react'
import { Download } from 'lucide-react'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { RetentionControls } from '@/components/admin/retention-controls'
import { AdminCard, AdminCardsEmptyState } from '@/components/mobile/admin-card'
import { Calendar, FileText, Hash } from 'lucide-react'
import { filterRetentionRowsByUpdatedDate } from '@/lib/storage-dashboard'

export type RetentionRequestRow = {
  id: string
  title: string
  status: string
  isArchived: boolean
  updatedAt: string
  departmentName: string | null
  eligible: boolean
}

const MAX_BATCH_DOWNLOAD = 10

async function downloadBackup(requestIds: string[]) {
  const response = await fetch('/api/admin/retention/backup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestIds }),
  })

  if (!response.ok) {
    let message = 'Could not download backup'
    try {
      const body = await response.json()
      if (body.error) message = body.error
    } catch {
      // keep default
    }
    throw new Error(message)
  }

  const blob = await response.blob()
  const header = response.headers.get('Content-Disposition') ?? ''
  const match = header.match(/filename="([^"]+)"/)
  const filename = match?.[1] ?? 'retention-backup.zip'
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

export function RetentionRequestList({ requests }: { requests: RetentionRequestRow[] }) {
  const router = useRouter()
  const [selected, setSelected] = useState<string[]>([])
  const [downloading, setDownloading] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const visible = useMemo(
    () => filterRetentionRowsByUpdatedDate(requests, dateFrom, dateTo),
    [requests, dateFrom, dateTo]
  )
  const visibleIds = useMemo(() => visible.map((request) => request.id), [visible])

  const selectedSet = useMemo(() => new Set(selected), [selected])
  const selectedVisible = visibleIds.filter((id) => selectedSet.has(id))
  const selectedArchived = visible.filter(
    (request) => request.isArchived && selectedSet.has(request.id)
  )

  const allVisibleSelected = visibleIds.length > 0 && selectedVisible.length === visibleIds.length
  const someVisibleSelected = selectedVisible.length > 0 && !allVisibleSelected
  const dateFilterActive = dateFrom !== '' || dateTo !== ''

  function toggle(id: string, checked: boolean) {
    setSelected((current) =>
      checked ? [...new Set([...current, id])] : current.filter((item) => item !== id)
    )
  }

  function toggleAllVisible() {
    setSelected((current) => {
      if (allVisibleSelected) {
        const remove = new Set(visibleIds)
        return current.filter((id) => !remove.has(id))
      }
      return [...new Set([...current, ...visibleIds])]
    })
  }

  function clearVisibleSelection() {
    setSelected((current) => {
      const remove = new Set(visibleIds)
      return current.filter((id) => !remove.has(id))
    })
  }

  function clearAllSelection() {
    setSelected([])
  }

  async function handleDownload(ids: string[]) {
    if (ids.length > MAX_BATCH_DOWNLOAD) {
      toast.error(`Download up to ${MAX_BATCH_DOWNLOAD} requests at a time`)
      return
    }
    setDownloading(true)
    try {
      await downloadBackup(ids)
      toast.success(ids.length === 1 ? 'Backup downloaded' : `Downloaded ${ids.length} requests`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not download backup')
    } finally {
      setDownloading(false)
    }
  }

  async function handleHardDelete() {
    setDeleting(true)
    try {
      const response = await fetch('/api/admin/retention/hard-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestIds: selectedArchived.map((request) => request.id) }),
      })
      const result = await response.json()
      if (!response.ok || !result.success) {
        toast.error(result.error || 'Failed to hard-delete')
        return
      }
      toast.success(`Deleted ${result.deleted} archived request${result.deleted === 1 ? '' : 's'}`)
      if (Array.isArray(result.fileWarnings) && result.fileWarnings.length > 0) {
        toast.warning(`${result.fileWarnings.length} file(s) could not be removed from disk — see server logs`)
      }
      setSelected([])
      router.refresh()
    } catch {
      toast.error('Failed to hard-delete')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="date-from">Updated from</Label>
            <Input
              id="date-from"
              type="date"
              value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
              className="w-40"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="date-to">Updated to</Label>
            <Input
              id="date-to"
              type="date"
              value={dateTo}
              onChange={(event) => setDateTo(event.target.value)}
              className="w-40"
            />
          </div>
          {dateFilterActive ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setDateFrom('')
                setDateTo('')
              }}
            >
              Clear dates
            </Button>
          ) : null}
          <p className="text-sm text-muted-foreground pb-2">
            {visible.length} of {requests.length} request{visible.length === 1 ? '' : 's'} shown
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={downloading || selectedVisible.length === 0}
            title={
              selectedVisible.length > MAX_BATCH_DOWNLOAD
                ? `Up to ${MAX_BATCH_DOWNLOAD} per download`
                : undefined
            }
            onClick={() => handleDownload(selectedVisible)}
          >
            <Download className="mr-1 h-4 w-4" />
            {downloading ? 'Preparing…' : `Download selected (${selectedVisible.length})`}
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" variant="destructive" disabled={deleting || selectedArchived.length === 0}>
                Hard-delete selected ({selectedArchived.length})
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Hard-delete archived requests?</AlertDialogTitle>
                <AlertDialogDescription>
                  This permanently removes {selectedArchived.length} archived request
                  {selectedArchived.length === 1 ? '' : 's'} and their files. Download a backup first. This cannot be undone.
                  Active (not archived) rows in the selection are ignored.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  onClick={handleHardDelete}
                >
                  Hard-delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      <div className="md:hidden space-y-3">
        <div className="flex flex-wrap items-center gap-3 rounded-md border px-3 py-2">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              aria-label="Select all shown requests"
              checked={allVisibleSelected ? true : someVisibleSelected ? 'indeterminate' : false}
              onCheckedChange={() => toggleAllVisible()}
            />
            Select all shown
          </label>
          {selectedVisible.length > 0 ? (
            <Button type="button" variant="ghost" size="sm" onClick={clearVisibleSelection}>
              Clear shown selection ({selectedVisible.length})
            </Button>
          ) : null}
          {selected.length > selectedVisible.length ? (
            <Button type="button" variant="ghost" size="sm" onClick={clearAllSelection}>
              Clear all selection ({selected.length})
            </Button>
          ) : null}
        </div>
        {visible.length > 0 ? (
          visible.map((request) => (
            <div key={request.id} className="space-y-2">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={selectedSet.has(request.id)}
                  onCheckedChange={(value) => toggle(request.id, value === true)}
                />
                Include in zip
              </label>
              <AdminCard
                title={request.title}
                status={{
                  label: request.isArchived ? 'Archived' : request.eligible ? 'Ready to archive' : 'Active',
                  variant: request.isArchived ? 'secondary' : 'default',
                }}
                details={[
                  {
                    label: 'ID',
                    value: request.id.slice(0, 8) + '...',
                    icon: <Hash className="h-3.5 w-3.5" />,
                  },
                  {
                    label: 'Status',
                    value: request.status,
                    icon: <FileText className="h-3.5 w-3.5" />,
                  },
                  {
                    label: 'Updated',
                    value: new Date(request.updatedAt).toLocaleDateString('en-US', {
                      month: '2-digit',
                      day: '2-digit',
                      year: 'numeric',
                    }),
                    icon: <Calendar className="h-3.5 w-3.5" />,
                  },
                ]}
                badges={[]}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={downloading}
                  onClick={() => handleDownload([request.id])}
                >
                  <Download className="mr-1 h-4 w-4" />
                  Download backup
                </Button>
                <RetentionControls requestId={request.id} isArchived={request.isArchived} />
              </div>
            </div>
          ))
        ) : (
          <AdminCardsEmptyState
            message="No requests match the selected dates"
            submessage="Clear the date filters to see everything."
          />
        )}
      </div>

      <div className="hidden md:block border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted">
            <tr>
              <th className="px-4 py-3 w-10">
                <Checkbox
                  aria-label="Select all shown requests"
                  checked={allVisibleSelected ? true : someVisibleSelected ? 'indeterminate' : false}
                  onCheckedChange={() => toggleAllVisible()}
                  disabled={visibleIds.length === 0}
                />
              </th>
              <th className="text-left px-4 py-3 font-medium">ID</th>
              <th className="text-left px-4 py-3 font-medium">Title</th>
              <th className="text-left px-4 py-3 font-medium">Status</th>
              <th className="text-left px-4 py-3 font-medium">Archived</th>
              <th className="text-left px-4 py-3 font-medium">Department</th>
              <th className="text-left px-4 py-3 font-medium">Updated</th>
              <th className="text-left px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {visible.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center py-8 text-muted-foreground">
                  No requests match the selected dates
                </td>
              </tr>
            ) : (
              visible.map((request) => (
                <tr key={request.id} className={request.isArchived ? 'bg-muted/30' : ''}>
                  <td className="px-4 py-3">
                    <Checkbox
                      checked={selectedSet.has(request.id)}
                      onCheckedChange={(value) => toggle(request.id, value === true)}
                      aria-label={`Select ${request.title}`}
                    />
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                    {request.id.slice(0, 8)}...
                  </td>
                  <td className="px-4 py-3 max-w-xs truncate" title={request.title}>
                    {request.title}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant="outline">{request.status}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    {request.isArchived ? (
                      <Badge variant="secondary">Archived</Badge>
                    ) : request.eligible ? (
                      <Badge>Ready to archive</Badge>
                    ) : (
                      <Badge variant="default">Active</Badge>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {request.departmentName ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {new Date(request.updatedAt).toLocaleDateString('en-US', {
                      month: '2-digit',
                      day: '2-digit',
                      year: 'numeric',
                    })}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={downloading}
                        onClick={() => handleDownload([request.id])}
                      >
                        <Download className="mr-1 h-4 w-4" />
                        Backup
                      </Button>
                      <RetentionControls requestId={request.id} isArchived={request.isArchived} />
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
