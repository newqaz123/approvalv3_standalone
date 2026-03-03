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

  // Fetch initial data with default 30-day filter
  // Note: getAnalyticsData() internally uses Promise.all() to fetch all data sources in parallel
  const initialData = await getAnalyticsData({
    dateRange: '30days',
    departmentId: undefined,
    status: undefined,
    requesterId: undefined,
  })

  // Fetch filters for filter controls (independent of analytics data)
  // Future optimization: Could parallelize getAnalyticsData() + getAnalyticsFilters() with Promise.all()
  const filters = await getAnalyticsFilters()

  return <AnalyticsPage initialData={initialData} filters={filters} userId={userId} />
}
