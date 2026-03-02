import { Suspense } from 'react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getHierarchyData, getPendingApprovalsCount, getHierarchyChangeHistory } from '@/server-actions/hierarchy'
import { HierarchyView } from '@/components/admin/hierarchy-view'
import { Button } from '@/components/ui/button'
import { ArrowLeft } from 'lucide-react'

interface HierarchyPageProps {
  params: Promise<{ id: string }>
}

async function HierarchyContent({ departmentId }: { departmentId: string }) {
  const [hierarchyData, pendingCount, changeHistory] = await Promise.all([
    getHierarchyData(departmentId),
    getPendingApprovalsCount(departmentId),
    getHierarchyChangeHistory(departmentId, 5), // Last 5 changes
  ])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Link href="/admin/departments">
              <Button variant="ghost" size="sm">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Departments
              </Button>
            </Link>
          </div>
          <h1 className="text-2xl font-bold mt-2">
            {hierarchyData.department.name} - Approval Hierarchy
          </h1>
          <p className="text-muted-foreground">
            View and manage the approval hierarchy for this department
          </p>
        </div>
      </div>

      <HierarchyView
        department={hierarchyData.department}
        initialUsersByLevel={hierarchyData.usersByLevel}
        maxLevel={hierarchyData.maxLevel}
        pendingApprovalsCount={pendingCount}
        changeHistory={changeHistory}
      />
    </div>
  )
}

export default async function HierarchyPage({ params }: HierarchyPageProps) {
  const { id } = await params

  return (
    <div className="container mx-auto py-6">
      <Suspense fallback={<div>Loading hierarchy...</div>}>
        <HierarchyContent departmentId={id} />
      </Suspense>
    </div>
  )
}
