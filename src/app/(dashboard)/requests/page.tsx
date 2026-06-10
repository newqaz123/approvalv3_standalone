import { Suspense } from 'react'
import { RequestsListClient } from '@/components/requests/requests-list-client'
import { RequestDeepLinkModal } from '@/components/requests/request-deep-link-modal'
import { getMyRequests, getRequestFilterOptions } from '@/server-actions/requests'

interface RequestsPageProps {
  searchParams: Promise<{ requestId?: string }>
}

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

export default async function RequestsPage({ searchParams }: RequestsPageProps) {
  const { requestId } = await searchParams

  return (
    <>
      <RequestDeepLinkModal requestId={requestId} returnTo="/requests" />
      {requestId ? (
        <RequestsList />
      ) : (
        <Suspense fallback={<div>Loading...</div>}>
          <RequestsList />
        </Suspense>
      )}
    </>
  )
}
