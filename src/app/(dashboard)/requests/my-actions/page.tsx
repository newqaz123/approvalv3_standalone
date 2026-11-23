import { createTranslator } from '@/lib/i18n/messages'
import { getRequestLocale } from '@/lib/i18n/server'
import { Suspense } from 'react'
import Link from 'next/link'
import { ArrowLeft, Bell } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { RequestTable } from '@/components/requests/request-table'
import { RequestDeepLinkModal } from '@/components/requests/request-deep-link-modal'
import { getMyActionItems } from '@/server-actions/requests'

interface MyActionsPageProps {
  searchParams: Promise<{ requestId?: string }>
}

async function ActionItemsList() {
  const t = createTranslator(await getRequestLocale())
  const requests = await getMyActionItems()

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <Link href="/requests">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-2" />
            {t('requests.backToRequests')}
          </Button>
        </Link>
      </div>

      <div className="flex items-center gap-3">
        <Bell className="h-6 w-6 text-orange-500" />
        <div>
          <h1 className="text-2xl font-bold">{t('requests.myActions')}</h1>
          <p className="text-muted-foreground">
            {t('requests.awaitingYourApproval', { count: requests.length })}
          </p>
        </div>
      </div>

      {requests.length === 0 ? (
        <div className="border rounded-lg p-12 text-center">
          <Bell className="h-12 w-12 mx-auto mb-4 text-gray-300" />
          <h3 className="text-lg font-semibold mb-2">{t('requests.noActionItems')}</h3>
          <p className="text-muted-foreground">
            {t('requests.noPendingApprovals')}
          </p>
          <Link href="/requests">
            <Button variant="outline" className="mt-4">
              {t('requests.viewAll')}
            </Button>
          </Link>
        </div>
      ) : (
        <RequestTable initialData={requests as any} />
      )}
    </div>
  )
}

export default async function MyActionsPage({ searchParams }: MyActionsPageProps) {
  const t = createTranslator(await getRequestLocale())
  const { requestId } = await searchParams

  return (
    <div className="w-full py-6">
      <RequestDeepLinkModal requestId={requestId} returnTo="/requests/my-actions" />
      {requestId ? (
        <ActionItemsList />
      ) : (
        <Suspense fallback={<div>{t('requests.loading')}</div>}>
          <ActionItemsList />
        </Suspense>
      )}
    </div>
  )
}
