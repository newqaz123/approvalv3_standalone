import { BudgetMonitorPage } from '@/components/budget/budget-monitor-page'
import { getBudgetMonitorData } from '@/server-actions/budget-control'

export default async function BudgetMonitorRoute() {
  const initialData = await getBudgetMonitorData()
  return <BudgetMonitorPage initialData={initialData} />
}
