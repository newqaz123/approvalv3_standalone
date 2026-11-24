'use client'

import { useRouter } from 'next/navigation'
import { TemplateForm } from '@/components/admin/template-form'
import { useTranslations } from '@/lib/i18n/client'

export default function NewTemplatePage() {
  const t = useTranslations()
  const router = useRouter()

  return (
    <div className="container mx-auto py-6 max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">{t('admin.createTemplateTitle')}</h1>
        <p className="text-muted-foreground">
          {t('admin.createTemplateDescription')}
        </p>
      </div>

      <TemplateForm
        onSuccess={() => {
          router.push('/admin/templates')
        }}
        onCancel={() => {
          router.push('/admin/templates')
        }}
      />
    </div>
  )
}
