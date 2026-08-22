import { Suspense } from 'react'
import { RequestsListClient } from '@/components/requests/requests-list-client'
import { RequestDeepLinkModal } from '@/components/requests/request-deep-link-modal'
import { getMyRequests, getRequestFilterOptions } from '@/server-actions/requests'

interface RequestsPageProps {
  searchParams: Promise<{ requestId?: string }>
}

async function RequestsList() {
  const [requests, filterOptions] = await Promise.all([
    // Default to the no-WR filter so the server-rendered first page already
    // matches the client default ("Show only no WR" enabled) and there is no
    // unfiltered first render. Keep in sync with DEFAULT_WR_FILTER in
    // request-filters.tsx (cannot be imported here: it is a client module).
    getMyRequests({ wrStatus: 'not-received' }),
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
