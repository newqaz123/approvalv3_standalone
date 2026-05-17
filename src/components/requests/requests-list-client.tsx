'use client'

import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { RequestsListWithFilters } from '@/components/requests/requests-list-with-filters'
import { BulkDeleteByDateRange } from '@/components/requests/bulk-delete-by-date-range'
import { SubmitterModal } from '@/components/requests/submitter-modal'
import { createRequest } from '@/server-actions/requests'
import { uploadFileAction } from '@/server-actions/files'
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
  const [showNewRequestModal, setShowNewRequestModal] = useState(false)
  const [requestListRefreshSignal, setRequestListRefreshSignal] = useState(0)
  const router = useRouter()

  const handleSubmitRequest = async (data: {
    title: string
    description: string
    templateId?: string
    files: File[]
  }) => {
    try {
      const result = await createRequest({
        title: data.title,
        description: data.description,
      })

      if (result.success && result.requestId) {
        // Upload files if any
        if (data.files && data.files.length > 0) {
          for (const file of data.files) {
            const formData = new FormData()
            formData.append('file', file)
            formData.append('requestId', result.requestId)

            const uploadResult = await uploadFileAction(null, formData)
            if (!uploadResult.success) {
              toast.error(`Failed to upload ${file.name}: ${uploadResult.error}`)
            }
          }
        }

        toast.success('Request created successfully')
        setShowNewRequestModal(false)
        setRequestListRefreshSignal((signal) => signal + 1)
        router.refresh()
      } else {
        toast.error(result.error || 'Failed to create request')
      }
    } catch (error) {
      console.error('Failed to create request:', error)
      toast.error('An error occurred while creating the request')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h1 className="text-2xl font-bold">Requests</h1>
          <p className="text-muted-foreground">
            View and track improvement requests from your department
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
          <BulkDeleteByDateRange />
          <Button 
            className="w-full sm:w-auto"
            onClick={() => setShowNewRequestModal(true)}
          >
            <Plus className="mr-2 h-4 w-4" />
            New Request
          </Button>
        </div>
      </div>

      <RequestsListWithFilters
        initialRequests={initialRequests}
        departments={departments}
        requesters={requesters}
        refreshSignal={requestListRefreshSignal}
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
