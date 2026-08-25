import { HardDrive } from 'lucide-react'
import { BackButton } from '@/components/admin/back-button'
import { StorageDashboard } from '@/components/admin/storage-dashboard'
import { getStorageDashboardData } from '@/server-actions/storage-dashboard'

export const metadata = { title: 'Data storage | Admin' }

export default async function AdminStoragePage() {
  const data = await getStorageDashboardData()

  return (
    <div className="space-y-6">
      <div>
        <BackButton />
        <h1 className="flex items-center gap-2 text-3xl font-bold">
          <HardDrive className="h-8 w-8 text-muted-foreground" />
          Data storage
        </h1>
        <p className="mt-2 text-muted-foreground">
          How much disk and database this installation is using.
        </p>
      </div>

      <StorageDashboard data={data} />
    </div>
  )
}
