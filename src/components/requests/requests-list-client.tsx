'use client'

import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { RequestsListWithFilters } from '@/components/requests/requests-list-with-filters'
import { BulkDeleteByDateRange } from '@/components/requests/bulk-delete-by-date-range'
import { SubmitterModal } from '@/components/requests/submitter-modal'

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
      />

      <SubmitterModal
        mode="request"
        open={showNewRequestModal}
        onOpenChange={setShowNewRequestModal}
      />
    </div>
  )
}
