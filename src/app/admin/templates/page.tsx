import { Suspense } from 'react'
import { getTemplates } from '@/server-actions/templates'
import { TemplatesTable } from '@/components/admin/template-table'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import Link from 'next/link'
import { AdminPageSkeleton } from '@/components/admin/admin-skeleton'
import { BackButton } from '@/components/admin/back-button'

async function TemplatesList() {
  const templates = await getTemplates({ includeInactive: true })

  return (
    <div>
      <BackButton />
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm p-6 md:p-8">
        <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold">Request Templates</h1>
            <p className="text-muted-foreground">
              Manage standardized request templates for users
            </p>
          </div>
          <Button asChild>
            <Link href="/admin/templates/new">
              <Plus className="mr-2 h-4 w-4" />
              Create New
            </Link>
          </Button>
        </div>

        <TemplatesTable data={templates as any} />
        </div>
      </div>
    </div>
  )
}

export default function TemplatesPage() {
  return (
    <Suspense fallback={<AdminPageSkeleton />}>
      <TemplatesList />
    </Suspense>
  )
}
