'use client'

import { useTranslations } from '@/lib/i18n/client'
import { useState } from 'react'
import { Download, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { RequestsListWithFilters } from '@/components/requests/requests-list-with-filters'
import { BulkDeleteByDateRange } from '@/components/requests/bulk-delete-by-date-range'
import { SubmitterModal } from '@/components/requests/submitter-modal'
import { createRequest, exportRequestsXlsx } from '@/server-actions/requests'
import type { GetRequestsFilters } from '@/server-actions/requests'
import { DEFAULT_WR_FILTER } from '@/components/requests/request-filters'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

interface RequestsListClientProps {
  initialRequests: any[]
  departments: Array<{ id: string; name: string }>
  requesters: Array<{ id: string; name: string }>
}

export function RequestsListClient({
  initialRequests,
  departments,
  requesters,
}: RequestsListClientProps) {
  const t = useTranslations()
  const [showNewRequestModal, setShowNewRequestModal] = useState(false)
  const [requestListRefreshSignal, setRequestListRefreshSignal] = useState(0)
  const [exportFilters, setExportFilters] = useState<GetRequestsFilters>({
    wrStatus: DEFAULT_WR_FILTER,
  })
  const [isExporting, setIsExporting] = useState(false)
  const router = useRouter()

  const handleSubmitRequest = async (data: {
    title: string
    description: string
    templateId?: string
    stagedAttachmentIds: string[]
    inlineImageSessionId: string
  }): Promise<{ success: boolean; error?: string }> => {
    try {
      const result = await createRequest({
        title: data.title,
        description: data.description,
        inlineImageSessionId: data.inlineImageSessionId,
        stagedAttachmentIds: data.stagedAttachmentIds,
      })

      if (result.success) {
        toast.success(t('requests.requestCreated'))
        setRequestListRefreshSignal((signal) => signal + 1)
        router.refresh()
        return { success: true }
      } else {
        const error = t(result.errorKey ?? 'requests.error.create')
        toast.error(error)
        return { success: false, error }
      }
    } catch (error) {
      console.error('Failed to create request:', error)
      toast.error(t('requests.error.createUnexpected'))
      return { success: false, error: t('requests.error.createUnexpected') }
    }
  }

  const handleExportXlsx = async () => {
    setIsExporting(true)
    try {
      const result = await exportRequestsXlsx(exportFilters)
      const link = document.createElement('a')
      link.href = `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${result.base64}`
      link.download = result.fileName
      link.click()
    } catch (error) {
      console.error('Failed to export requests:', error)
      toast.error(t('requests.error.exportXlsx'))
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h1 className="text-3xl font-bold">{t('nav.requests')}</h1>
          <p className="text-muted-foreground">
            {t('requests.listIntro')}
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
          <BulkDeleteByDateRange />
          <Button
            variant="outline"
            className="w-full sm:w-auto"
            onClick={handleExportXlsx}
            disabled={isExporting}
          >
            <Download className="mr-2 h-4 w-4" />
            {isExporting ? t('requests.exporting') : t('requests.exportXlsx')}
          </Button>
          <Button 
            className="w-full bg-slate-950 text-white hover:bg-slate-800 sm:w-auto"
            onClick={() => setShowNewRequestModal(true)}
          >
            <Plus className="mr-2 h-4 w-4" />
            {t('requests.newRequest')}
          </Button>
        </div>
      </div>

      <RequestsListWithFilters
        initialRequests={initialRequests}
        departments={departments}
        requesters={requesters}
        refreshSignal={requestListRefreshSignal}
        onFiltersChange={setExportFilters}
      />

      <SubmitterModal
        mode="request"
        open={showNewRequestModal}
        onOpenChange={setShowNewRequestModal}
        onSubmitRequest={handleSubmitRequest}
      />
    </div>
  )
}
