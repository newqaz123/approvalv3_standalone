import { Suspense } from 'react'
import { getTemplates } from '@/server-actions/templates'
import { TemplatesTable } from '@/components/admin/template-table'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import Link from 'next/link'

async function TemplatesList() {
  const templates = await getTemplates({ includeInactive: true })

  return (
    <div className="space-y-4">
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
  )
}

export default function TemplatesPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <TemplatesList />
    </Suspense>
  )
}
