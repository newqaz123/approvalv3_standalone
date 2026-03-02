import { auth } from '@clerk/nextjs/server'
import { DashboardTabs } from '@/components/dashboard/dashboard-tabs'

export default async function DashboardPage() {
  const { userId } = await auth()

  return (
    <div className="container py-6">
      <h1 className="text-2xl font-bold mb-6">Dashboard</h1>
      <DashboardTabs userId={userId} />
    </div>
  )
}
