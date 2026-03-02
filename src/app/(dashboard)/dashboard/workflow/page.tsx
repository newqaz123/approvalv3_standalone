import { Suspense } from 'react'
import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { getHierarchyDataForUser, getDepartmentsForHierarchyView } from '@/server-actions/hierarchy'
import { HierarchyView } from '@/components/admin/hierarchy-view'
import { DepartmentSelector } from '@/components/admin/department-selector'

interface WorkflowPageProps {
  searchParams: Promise<{ departmentId?: string }>
}

async function WorkflowContent({ departmentId }: { departmentId: string }) {
  const hierarchyData = await getHierarchyDataForUser(departmentId)

  return (
    <HierarchyView
      department={hierarchyData.department}
      initialUsersByLevel={hierarchyData.usersByLevel}
      maxLevel={hierarchyData.maxLevel}
      pendingApprovalsCount={0}
      readOnly={true}
    />
  )
}

export default async function WorkflowPage({ searchParams }: WorkflowPageProps) {
  const { userId } = await auth()
  if (!userId) redirect('/sign-in')

  const departments = await getDepartmentsForHierarchyView()

  const { departmentId } = await searchParams
  const selectedDeptId = departmentId || departments[0]?.id

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Approval Workflow</h1>
        <p className="text-muted-foreground">
          This is the approval workflow for your department. Shows who approves requests at each level.
        </p>
      </div>

      {departments.length > 1 && (
        <DepartmentSelector
          departments={departments}
          selectedDepartmentId={selectedDeptId}
          basePath="/dashboard/workflow"
        />
      )}

      {selectedDeptId ? (
        <Suspense fallback={<div className="text-muted-foreground">Loading workflow...</div>}>
          <WorkflowContent departmentId={selectedDeptId} />
        </Suspense>
      ) : (
        <p className="text-muted-foreground">
          You are not assigned to a department. Please contact your administrator.
        </p>
      )}
    </div>
  )
}
