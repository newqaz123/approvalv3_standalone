import { NextRequest, NextResponse } from 'next/server'
import { getMyRequests, GetRequestsFilters } from '@/server-actions/requests'

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams

    const filters: GetRequestsFilters = {
      status: searchParams.get('status') || undefined,
      statuses: searchParams.getAll('statuses').length > 0
        ? searchParams.getAll('statuses')
        : undefined,
      departmentId: searchParams.get('departmentId') || undefined,
      requesterId: searchParams.get('requesterId') || undefined,
      dateFrom: searchParams.get('dateFrom') || undefined,
      dateTo: searchParams.get('dateTo') || undefined,
      search: searchParams.get('search') || undefined,
    }

    const requests = await getMyRequests(filters)
    return NextResponse.json(requests)
  } catch (error) {
    console.error('Error fetching requests:', error)
    return NextResponse.json(
      { error: 'Failed to fetch requests' },
      { status: 500 }
    )
  }
}
