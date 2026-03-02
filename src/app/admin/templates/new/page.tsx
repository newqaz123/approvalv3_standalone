'use client'

import { useRouter } from 'next/navigation'
import { TemplateForm } from '@/components/admin/template-form'

export default function NewTemplatePage() {
  const router = useRouter()

  return (
    <div className="container mx-auto py-6 max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Create New Template</h1>
        <p className="text-muted-foreground">
          Create a standardized request template that users can select when submitting requests
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
