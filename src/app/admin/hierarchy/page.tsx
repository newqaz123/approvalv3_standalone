import { Suspense } from 'react'
import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import prisma from '@/lib/prisma'
import { getHierarchyData, getPendingApprovalsCount, getHierarchyChangeHistory } from '@/server-actions/hierarchy'
import { HierarchyView } from '@/components/admin/hierarchy-view'
import { DepartmentSelector } from '@/components/admin/department-selector'

interface HierarchyPageProps {
  searchParams: Promise<{ departmentId?: string }>
}

async function HierarchyContent({ departmentId }: { departmentId: string }) {
  const [hierarchyData, pendingCount, changeHistory] = await Promise.all([
    getHierarchyData(departmentId),
    getPendingApprovalsCount(departmentId),
    getHierarchyChangeHistory(departmentId, 5),
  ])

  return (
    <HierarchyView
      department={hierarchyData.department}
      initialUsersByLevel={hierarchyData.usersByLevel}
      maxLevel={hierarchyData.maxLevel}
      pendingApprovalsCount={pendingCount}
      changeHistory={changeHistory}
      readOnly={false}
    />
  )
}

export default async function HierarchyPage({ searchParams }: HierarchyPageProps) {
  const { userId } = await auth()
  if (!userId) redirect('/sign-in')

  // Verify admin access
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  })
  if (!user || user.role !== 'admin') redirect('/dashboard')

  // Fetch all departments for the selector
  const departments = await prisma.department.findMany({
    orderBy: { name: 'asc' },
    select: { id: true, name: true, type: true },
  })

  const { departmentId } = await searchParams
  const selectedDeptId = departmentId || departments[0]?.id

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Hierarchy Management</h1>
        <p className="text-muted-foreground">
          Manage the approval hierarchy for each department. Drag users between levels to update their position.
        </p>
      </div>

      <DepartmentSelector
        departments={departments}
        selectedDepartmentId={selectedDeptId}
        basePath="/admin/hierarchy"
      />

      {selectedDeptId ? (
        <Suspense fallback={<div className="text-muted-foreground">Loading hierarchy...</div>}>
          <HierarchyContent departmentId={selectedDeptId} />
        </Suspense>
      ) : (
        <p className="text-muted-foreground">No departments found. Create a department first.</p>
      )}
    </div>
  )
}
