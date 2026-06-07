import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SubTaskStageSettings } from '@/components/admin/sub-task-stage-settings'
import { getSubTaskStagesForAdmin } from '@/server-actions/sub-task-stages'

export const metadata = {
  title: 'Sub-task Stages | Admin',
}

export default async function AdminSubTaskStagesPage() {
  const subTaskStages = await getSubTaskStagesForAdmin()

  return (
    <div className="space-y-6 p-8">
      <div className="flex flex-col gap-3">
        <Button asChild variant="ghost" className="w-fit gap-2 px-0">
          <Link href="/admin">
            <ChevronLeft className="h-4 w-4" />
            Admin
          </Link>
        </Button>
        <div>
          <h1 className="text-3xl font-bold">Sub-task stages</h1>
          <p className="mt-2 text-muted-foreground">
            Manage stages used in engineering request sub-tasks.
          </p>
        </div>
      </div>

      <SubTaskStageSettings initialStages={subTaskStages} />
    </div>
  )
}
