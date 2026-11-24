import { createTranslator } from '@/lib/i18n/messages'
import { getRequestLocale } from '@/lib/i18n/server'
import { BudgetMonitorPage } from '@/components/budget/budget-monitor-page'
import { getBudgetMonitorData } from '@/server-actions/budget-control'

export default async function BudgetMonitorRoute() {
  const initialData = await getBudgetMonitorData().catch((error) => {
    console.error('Failed to load budget:', error)
    return null
  })

  if (!initialData) {
    const t = createTranslator(await getRequestLocale())
    return (
      <div className="space-y-2 py-4">
        <h1 className="text-2xl font-bold">{t('nav.budgetMonitor')}</h1>
        <p role="alert" className="text-destructive">{t('budget.error.initialLoad')}</p>
      </div>
    )
  }

  return <BudgetMonitorPage initialData={initialData} />
}
