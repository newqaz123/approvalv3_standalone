import { getTemplate } from '@/server-actions/templates'
import { Suspense } from 'react'
import { EditTemplateFormClient } from '../edit-template-client'
import { createTranslator } from '@/lib/i18n/messages'
import { getRequestLocale } from '@/lib/i18n/server'

async function EditTemplateContent({ id }: { id: string }) {
  const t = createTranslator(await getRequestLocale())
  const template = await getTemplate(id)

  if (!template) {
    return <div className="text-red-500">{t('admin.templateNotFound')}</div>
  }

  return <EditTemplateFormClient template={template} />
}

export default async function EditTemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const t = createTranslator(await getRequestLocale())
  const { id } = await params

  // If ID is invalid, redirect back
  if (!id || id === 'undefined') {
    return <div className="container mx-auto py-6 max-w-2xl">
      <div className="text-red-500">{t('admin.invalidTemplateId')}</div>
    </div>
  }

  return (
    <div className="container mx-auto py-6 max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">{t('admin.editTemplate')}</h1>
        <p className="text-muted-foreground">
          {t('admin.editTemplateDescription')}
        </p>
      </div>

      <Suspense fallback={<div>{t('admin.loadingTemplate')}</div>}>
        <EditTemplateContent id={id} />
      </Suspense>
    </div>
  )
}
