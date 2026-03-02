import { Suspense } from 'react'
import { getUsers } from '@/server-actions/users'
import { UserTable } from '@/components/admin/user-table'
import prisma from '@/lib/prisma'
import { CreateUserDialog } from '@/components/admin/create-user-dialog'

async function UsersList() {
  const users = await getUsers()
  const departments = await prisma.department.findMany({
    orderBy: { name: 'asc' },
  })

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">Users</h1>
          <p className="text-muted-foreground">
            Manage user accounts and permissions
          </p>
        </div>
        <CreateUserDialog departments={departments} />
      </div>

      <UserTable data={users as any} departments={departments} />
    </div>
  )
}

export default function UsersPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <UsersList />
    </Suspense>
  )
}
