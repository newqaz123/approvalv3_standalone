import { Suspense } from 'react'
import { getDepartments } from '@/server-actions/departments'
import { DepartmentTable } from '@/components/admin/department-table'
import { CreateDepartmentDialog } from '@/components/admin/create-department-dialog'

async function DepartmentsList() {
  const departments = await getDepartments()

  return (
    <div className="space-y-4">
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
  )
}

export default function DepartmentsPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <DepartmentsList />
    </Suspense>
  )
}
