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
import { useTranslations } from '@/lib/i18n/client'

interface RetentionControlsProps {
  requestId: string
  isArchived: boolean
}

export function RetentionControls({ requestId, isArchived }: RetentionControlsProps) {
  const t = useTranslations()
  const router = useRouter()
  const [archiving, setArchiving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function handleArchive() {
    setArchiving(true)
    try {
      const result = await archiveRequest(requestId)
      if (result.success) {
        toast.success(t('admin.archiveSucceeded'))
        router.refresh()
      } else {
        toast.error(t('admin.archiveFailed'))
      }
    } catch {
      toast.error(t('admin.unexpectedError'))
    } finally {
      setArchiving(false)
    }
  }

  async function handleUnarchive() {
    setArchiving(true)
    try {
      const result = await unarchiveRequest(requestId)
      if (result.success) {
        toast.success(t('admin.unarchiveSucceeded'))
        router.refresh()
      } else {
        toast.error(t('admin.unarchiveFailed'))
      }
    } catch {
      toast.error(t('admin.unexpectedError'))
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
        toast.error(t('admin.deleteRequestFailed'))
        return
      }
      toast.success(t('admin.deleteRequestSucceeded'))
      router.refresh()
    } catch {
      toast.error(t('admin.unexpectedError'))
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
          title={t('admin.unarchiveHelp')}
        >
          <ArchiveRestore className="h-4 w-4 mr-1" />
          {archiving ? t('admin.unarchiving') : t('admin.unarchive')}
        </Button>
      ) : (
        <Button
          variant="outline"
          size="sm"
          onClick={handleArchive}
          disabled={archiving}
          title={t('admin.archiveHelp')}
        >
          <Archive className="h-4 w-4 mr-1" />
          {archiving ? t('admin.archiving') : t('admin.archive')}
        </Button>
      )}

      {isArchived ? (
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            variant="destructive"
            size="sm"
            disabled={deleting}
            title={t('admin.hardDeleteHelp')}
          >
            <Trash2 className="h-4 w-4 mr-1" />
            {deleting ? t('admin.deleting') : t('admin.hardDelete')}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('admin.deletePermanentTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('admin.hardDeleteDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t('admin.confirmHardDelete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      ) : null}
    </div>
  )
}
