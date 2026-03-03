import { auth } from '@/lib/auth-config'
import { DashboardTabs } from '@/components/dashboard/dashboard-tabs'

export default async function DashboardPage() {
  const session = await auth()

  return (
    <div className="container py-6">
      <h1 className="text-2xl font-bold mb-6">Dashboard</h1>
      <DashboardTabs userId={session?.user?.id ?? null} />
    </div>
  )
}
