import { Suspense } from 'react'
import { getUsers } from '@/server-actions/users'
import { UserTable } from '@/components/admin/user-table'
import { CreateUserDialog } from '@/components/admin/create-user-dialog'
import { AdminPageSkeleton } from '@/components/admin/admin-skeleton'
import { BackButton } from '@/components/admin/back-button'
import { createTranslator } from '@/lib/i18n/messages'
import { getRequestLocale } from '@/lib/i18n/server'

async function UsersList() {
  const t = createTranslator(await getRequestLocale())
  const users = await getUsers()

  return (
    <div>
      <BackButton />
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm p-6 md:p-8">
        <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold">{t('admin.users')}</h1>
            <p className="text-muted-foreground">
              {t('admin.usersDescription')}
            </p>
          </div>
          <CreateUserDialog />
        </div>

        <UserTable data={users} />
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
