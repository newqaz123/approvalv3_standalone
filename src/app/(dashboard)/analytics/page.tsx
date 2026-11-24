import { createTranslator } from '@/lib/i18n/messages'
import { getRequestLocale } from '@/lib/i18n/server'
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
  const result = await Promise.all([
    getAnalyticsData({
      dateRange: '30days',
      unitId: undefined,
      status: undefined,
      requesterId: undefined,
    }),
    getAnalyticsFilters(),
  ]).catch((error) => {
    console.error('Failed to load analytics:', error)
    return null
  })

  if (!result) {
    const t = createTranslator(await getRequestLocale())
    return (
      <div className="space-y-2 py-4">
        <h1 className="text-2xl font-bold">{t('nav.analytics')}</h1>
        <p role="alert" className="text-destructive">{t('analytics.error.initialLoad')}</p>
      </div>
    )
  }
  const [initialData, filters] = result

  return <AnalyticsPage initialData={initialData} filters={filters} userId={userId} />
}
