import { Suspense } from 'react'
import Link from 'next/link'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { RequestsListWithFilters } from '@/components/requests/requests-list-with-filters'
import { BulkDeleteByDateRange } from '@/components/requests/bulk-delete-by-date-range'
import { getMyRequests, getRequestFilterOptions } from '@/server-actions/requests'

async function RequestsList() {
  const [requests, filterOptions] = await Promise.all([
    getMyRequests(),
    getRequestFilterOptions(),
  ])

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
          <Link href="/requests/new" className="w-full sm:w-auto">
            <Button className="w-full sm:w-auto">
              <Plus className="mr-2 h-4 w-4" />
              New Request
            </Button>
          </Link>
        </div>
      </div>

      <RequestsListWithFilters
        initialRequests={requests as any}
        departments={filterOptions.departments}
        requesters={filterOptions.requesters}
      />
    </div>
  )
}

export default function RequestsPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <RequestsList />
    </Suspense>
  )
}
