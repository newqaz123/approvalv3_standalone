import { createTranslator } from '@/lib/i18n/messages'
import { getRequestLocale } from '@/lib/i18n/server'
import { Skeleton } from '@/components/ui/skeleton'

export default async function AnalyticsLoading() {
  const t = createTranslator(await getRequestLocale())
  return (
    <div className="w-full py-6">
      <h1 className="text-2xl font-bold mb-6">{t('nav.analytics')}</h1>

      <p role="status" className="sr-only">{t('requests.loading')}</p>

      {/* Summary cards skeleton */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="rounded-xl border bg-card text-card-foreground shadow">
            <div className="flex flex-col space-y-1.5 p-6">
              <Skeleton className="h-4 w-24" />
            </div>
            <div className="p-6 pt-0">
              <Skeleton className="h-8 w-16" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
