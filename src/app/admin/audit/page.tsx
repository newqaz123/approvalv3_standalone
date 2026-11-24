import { RequestExportCard } from "@/components/admin/request-export-card"
import { DateRangeExportCard } from "@/components/admin/date-range-export-card"
import { BackButton } from '@/components/admin/back-button'
import { createTranslator } from '@/lib/i18n/messages'
import { getRequestLocale } from '@/lib/i18n/server'

export default async function AuditExportPage() {
  const t = createTranslator(await getRequestLocale())
  return (
    <div>
      <BackButton />
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm p-6 md:p-8">
        <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">{t('admin.auditExport')}</h1>
          <p className="text-muted-foreground mt-2">
            {t('admin.auditDescription')}
          </p>
        </div>
        <div className="grid gap-6 md:grid-cols-2">
          <RequestExportCard />
          <DateRangeExportCard />
        </div>
        </div>
      </div>
    </div>
  )
}
