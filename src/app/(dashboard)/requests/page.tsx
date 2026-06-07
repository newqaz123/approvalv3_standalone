import { Suspense } from 'react'
import { RequestsListClient } from '@/components/requests/requests-list-client'
import { getMyRequests, getRequestFilterOptions } from '@/server-actions/requests'

async function RequestsList() {
  const [requests, filterOptions] = await Promise.all([
    getMyRequests({ wrStatus: 'all' }),
    getRequestFilterOptions(),
  ])

  return (
    <RequestsListClient
      initialRequests={requests as any}
      departments={filterOptions.departments}
      requesters={filterOptions.requesters}
    />
  )
}

export default function RequestsPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <RequestsList />
    </Suspense>
  )
}
