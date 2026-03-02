'use client'

import { useState } from 'react'
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
import { Archive, Trash2 } from 'lucide-react'
import { archiveRequest, permanentDeleteRequest } from '@/server-actions/requests'
import { toast } from 'sonner'

interface RetentionControlsProps {
  requestId: string
  isArchived: boolean
}

export function RetentionControls({ requestId, isArchived }: RetentionControlsProps) {
  const [archiving, setArchiving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function handleArchive() {
    setArchiving(true)
    try {
      const result = await archiveRequest(requestId)
      if (result.success) {
        toast.success('Request archived successfully')
      } else {
        toast.error(result.error || 'Failed to archive request')
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
      const result = await permanentDeleteRequest(requestId)
      if (result.success) {
        toast.success('Request permanently deleted')
      } else {
        toast.error(result.error || 'Failed to delete request')
      }
    } catch {
      toast.error('An unexpected error occurred')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      {!isArchived && (
        <Button
          variant="outline"
          size="sm"
          onClick={handleArchive}
          disabled={archiving}
          title="Archive request"
        >
          <Archive className="h-4 w-4 mr-1" />
          {archiving ? 'Archiving...' : 'Archive'}
        </Button>
      )}

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            variant="destructive"
            size="sm"
            disabled={deleting}
            title="Permanently delete request"
          >
            <Trash2 className="h-4 w-4 mr-1" />
            {deleting ? 'Deleting...' : 'Delete'}
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
    </div>
  )
}
