import { getTemplate } from '@/server-actions/templates'
import { Suspense } from 'react'
import { EditTemplateFormClient } from '../edit-template-client'

async function EditTemplateContent({ id }: { id: string }) {
  const template = await getTemplate(id)

  if (!template) {
    return <div className="text-red-500">Template not found</div>
  }

  return <EditTemplateFormClient template={template} />
}

export default async function EditTemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  // If ID is invalid, redirect back
  if (!id || id === 'undefined') {
    return <div className="container mx-auto py-6 max-w-2xl">
      <div className="text-red-500">Invalid template ID</div>
    </div>
  }

  return (
    <div className="container mx-auto py-6 max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Edit Template</h1>
        <p className="text-muted-foreground">
          Update this template. Changes will apply to new requests only.
        </p>
      </div>

      <Suspense fallback={<div>Loading template...</div>}>
        <EditTemplateContent id={id} />
      </Suspense>
    </div>
  )
}
