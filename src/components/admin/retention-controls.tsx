'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
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
import { Archive, ArchiveRestore, Trash2 } from 'lucide-react'
import { archiveRequest, unarchiveRequest } from '@/server-actions/requests'
import { toast } from 'sonner'

interface RetentionControlsProps {
  requestId: string
  isArchived: boolean
}

export function RetentionControls({ requestId, isArchived }: RetentionControlsProps) {
  const router = useRouter()
  const [archiving, setArchiving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function handleArchive() {
    setArchiving(true)
    try {
      const result = await archiveRequest(requestId)
      if (result.success) {
        toast.success('Request archived. It is hidden from normal lists.')
        router.refresh()
      } else {
        toast.error(result.error || 'Failed to archive request')
      }
    } catch {
      toast.error('An unexpected error occurred')
    } finally {
      setArchiving(false)
    }
  }

  async function handleUnarchive() {
    setArchiving(true)
    try {
      const result = await unarchiveRequest(requestId)
      if (result.success) {
        toast.success('Request unarchived. It is visible in normal lists again.')
        router.refresh()
      } else {
        toast.error(result.error || 'Failed to unarchive request')
      }
    } catch {
      toast.error('An unexpected error occurred')
    } finally {
      setArchiving(false)
    }
  }

  async function handleDelete() {
    setDeleting(true)
    try {
      const response = await fetch('/api/admin/retention/hard-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestIds: [requestId] }),
      })
      const result = await response.json()
      if (!response.ok || !result.success) {
        toast.error(result.error || 'Failed to delete request')
        return
      }
      toast.success('Request permanently deleted')
      router.refresh()
    } catch {
      toast.error('An unexpected error occurred')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      {isArchived ? (
        <Button
          variant="outline"
          size="sm"
          onClick={handleUnarchive}
          disabled={archiving}
          title="Show this request in normal lists again"
        >
          <ArchiveRestore className="h-4 w-4 mr-1" />
          {archiving ? 'Unarchiving...' : 'Unarchive'}
        </Button>
      ) : (
        <Button
          variant="outline"
          size="sm"
          onClick={handleArchive}
          disabled={archiving}
          title="Hide this request from normal lists"
        >
          <Archive className="h-4 w-4 mr-1" />
          {archiving ? 'Archiving...' : 'Archive'}
        </Button>
      )}

      {isArchived ? (
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            variant="destructive"
            size="sm"
            disabled={deleting}
            title="Permanently delete archived request"
          >
            <Trash2 className="h-4 w-4 mr-1" />
            {deleting ? 'Deleting...' : 'Hard-delete'}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Permanently Delete Request</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The request and all associated data
              (approvals, activities, attachments) will be permanently removed
              from the database.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete Permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      ) : null}
    </div>
  )
}
