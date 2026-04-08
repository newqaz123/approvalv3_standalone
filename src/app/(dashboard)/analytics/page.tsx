import { auth } from '@/lib/auth-config'
import { redirect } from 'next/navigation'
import { AnalyticsPage } from '@/components/analytics/analytics-page'
import { getAnalyticsData, getAnalyticsFilters } from '@/server-actions/analytics'

export default async function AnalyticsDashboard() {
  const session = await auth()
  const userId = session?.user?.id

  if (!userId) {
    redirect('/sign-in')
  }

  // Fetch initial data and filter options in parallel
  const [initialData, filters] = await Promise.all([
    getAnalyticsData({
      dateRange: '30days',
      departmentId: undefined,
      status: undefined,
      requesterId: undefined,
    }),
    getAnalyticsFilters(),
  ])

  return <AnalyticsPage initialData={initialData} filters={filters} userId={userId} />
}
