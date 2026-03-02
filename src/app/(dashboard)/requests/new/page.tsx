import { RequestForm } from '@/components/requests/request-form'
import { getActiveTemplates, getDefaultTemplatePublic } from '@/server-actions/templates'

export default async function NewRequestPage() {
  // Fetch active templates and default template
  const templates = await getActiveTemplates()
  const defaultTemplate = await getDefaultTemplatePublic()

  return (
    <div className="container mx-auto py-6 max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">New Improvement Request</h1>
        <p className="text-muted-foreground">
          Submit an improvement request for review and approval.
        </p>
      </div>
      <RequestForm
        templates={templates}
        defaultTemplateId={defaultTemplate?.id}
      />
    </div>
  )
}
