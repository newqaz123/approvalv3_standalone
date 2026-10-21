import { Suspense } from 'react'
import { getUsers } from '@/server-actions/users'
import { UserTable } from '@/components/admin/user-table'
import { CreateUserDialog } from '@/components/admin/create-user-dialog'
import { AdminPageSkeleton } from '@/components/admin/admin-skeleton'
import { BackButton } from '@/components/admin/back-button'

async function UsersList() {
  const users = await getUsers()

  return (
    <div>
      <BackButton />
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm p-6 md:p-8">
        <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold">Users</h1>
            <p className="text-muted-foreground">
              Manage user accounts and permissions. Organization assignment is edited in Organization & Approvals.
            </p>
          </div>
          <CreateUserDialog />
        </div>

        <UserTable data={users as any} />
        </div>
      </div>
    </div>
  )
}

export default function UsersPage() {
  return (
    <Suspense fallback={<AdminPageSkeleton />}>
      <UsersList />
    </Suspense>
  )
}
