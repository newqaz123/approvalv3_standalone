'use client'

import { useMemo, useState } from 'react'
import { Download } from 'lucide-react'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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

export type RetentionRequestRow = {
  id: string
  title: string
  status: string
  isArchived: boolean
  updatedAt: string
  departmentName: string | null
  eligible: boolean
}

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
  const selectedSet = useMemo(() => new Set(selected), [selected])
  const selectedArchived = selected.filter((id) =>
    requests.some((request) => request.id === id && request.isArchived)
  )

  function toggle(id: string, checked: boolean) {
    setSelected((current) =>
      checked ? [...new Set([...current, id])] : current.filter((item) => item !== id)
    )
  }

  async function handleDownload(ids: string[]) {
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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Download a zip with one folder per request: report.pdf plus original attachments.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={downloading || selected.length === 0}
            onClick={() => handleDownload(selected)}
          >
            <Download className="mr-1 h-4 w-4" />
            {downloading ? 'Preparing…' : `Download selected (${selected.length})`}
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
                  onClick={async () => {
                    setDeleting(true)
                    try {
                      const response = await fetch('/api/admin/retention/hard-delete', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ requestIds: selectedArchived }),
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
                  }}
                >
                  Hard-delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      <div className="md:hidden space-y-3">
        {requests.length > 0 ? (
          requests.map((request) => (
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
          <AdminCardsEmptyState message="No requests found" />
        )}
      </div>

      <div className="hidden md:block border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted">
            <tr>
              <th className="px-4 py-3 w-10" />
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
            {requests.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center py-8 text-muted-foreground">
                  No requests found
                </td>
              </tr>
            ) : (
              requests.map((request) => (
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
