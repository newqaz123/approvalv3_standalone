import { auth } from '@/lib/auth-config'
import { DashboardTabs } from '@/components/dashboard/dashboard-tabs'

export default async function DashboardPage() {
  const session = await auth()

  return (
    <div className="container py-4">
      <DashboardTabs userId={session?.user?.id ?? null} />
    </div>
  )
}
