import { RequestExportCard } from "@/components/admin/request-export-card"
import { DateRangeExportCard } from "@/components/admin/date-range-export-card"
import { BackButton } from '@/components/admin/back-button'

export default async function AuditExportPage() {
  return (
    <div>
      <BackButton />
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm p-6 md:p-8">
        <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Audit Trail Export</h1>
          <p className="text-muted-foreground mt-2">
            Export audit logs for compliance and external system integration
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
