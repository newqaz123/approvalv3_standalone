import { Suspense } from 'react'
import { getDepartments } from '@/server-actions/departments'
import { DepartmentTable } from '@/components/admin/department-table'
import { CreateDepartmentDialog } from '@/components/admin/create-department-dialog'
import { AdminPageSkeleton } from '@/components/admin/admin-skeleton'

async function DepartmentsList() {
  const departments = await getDepartments()

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm p-6 md:p-8">
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold">Departments</h1>
            <p className="text-muted-foreground">
              Manage departments and organization structure
            </p>
          </div>
          <CreateDepartmentDialog />
        </div>

        <DepartmentTable data={departments as any} />
      </div>
    </div>
  )
}

export default function DepartmentsPage() {
  return (
    <Suspense fallback={<AdminPageSkeleton />}>
      <DepartmentsList />
    </Suspense>
  )
}
