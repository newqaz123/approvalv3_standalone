import { Suspense } from 'react'
import { getTemplates } from '@/server-actions/templates'
import { TemplatesTable } from '@/components/admin/template-table'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import Link from 'next/link'
import { AdminPageSkeleton } from '@/components/admin/admin-skeleton'
import { BackButton } from '@/components/admin/back-button'
import { richTextToPlainText } from '@/lib/rich-text-sanitizer'
import { createTranslator } from '@/lib/i18n/messages'
import { getRequestLocale } from '@/lib/i18n/server'

async function TemplatesList() {
  const t = createTranslator(await getRequestLocale())
  const templates = await getTemplates({ includeInactive: true })

  return (
    <div>
      <BackButton />
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm p-6 md:p-8">
        <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold">{t('admin.templates')}</h1>
            <p className="text-muted-foreground">
              {t('admin.templatesDescription')}
            </p>
          </div>
          <Button asChild>
            <Link href="/admin/templates/new">
              <Plus className="mr-2 h-4 w-4" />
              {t('admin.createNew')}
            </Link>
          </Button>
        </div>

        <TemplatesTable data={templates.map((template) => ({
          ...template,
          description: richTextToPlainText(template.description),
        }))} />
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
