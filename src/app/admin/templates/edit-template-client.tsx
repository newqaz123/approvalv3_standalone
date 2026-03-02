'use client'

import { useRouter } from 'next/navigation'
import { TemplateForm, type TemplateFormValues } from '@/components/admin/template-form'

interface Template {
  id: string
  name: string
  title: string
  description: string
}

interface EditTemplateFormProps {
  template: Template
}

export function EditTemplateFormClient({ template }: EditTemplateFormProps) {
  const router = useRouter()

  const initialData: TemplateFormValues & { id: string } = {
    id: template.id,
    name: template.name,
    title: template.title,
    description: template.description,
  }

  return (
    <TemplateForm
      initialData={initialData}
      onSuccess={() => {
        router.push('/admin/templates')
      }}
      onCancel={() => {
        router.push('/admin/templates')
      }}
    />
  )
}
