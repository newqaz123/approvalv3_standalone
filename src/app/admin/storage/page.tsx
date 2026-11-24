import { HardDrive } from 'lucide-react'
import { BackButton } from '@/components/admin/back-button'
import { StorageDashboard } from '@/components/admin/storage-dashboard'
import { getStorageDashboardData } from '@/server-actions/storage-dashboard'
import { createTranslator } from '@/lib/i18n/messages'
import { getRequestLocale } from '@/lib/i18n/server'

export async function generateMetadata() {
  const t = createTranslator(await getRequestLocale())
  return { title: `${t('admin.storage')} | ${t('admin.admin')}` }
}

export default async function AdminStoragePage() {
  const t = createTranslator(await getRequestLocale())
  const data = await getStorageDashboardData()

  return (
    <div className="space-y-6">
      <div>
        <BackButton />
        <h1 className="flex items-center gap-2 text-3xl font-bold">
          <HardDrive className="h-8 w-8 text-muted-foreground" />
          {t('admin.storage')}
        </h1>
        <p className="mt-2 text-muted-foreground">
          {t('admin.storageDescription')}
        </p>
      </div>

      <StorageDashboard data={data} t={t} />
    </div>
  )
}
