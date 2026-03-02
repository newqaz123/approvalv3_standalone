import { Suspense } from 'react'
import Link from 'next/link'
import { ArrowLeft, Bell } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { RequestTable } from '@/components/requests/request-table'
import { getMyActionItems } from '@/server-actions/requests'

async function ActionItemsList() {
  const requests = await getMyActionItems()

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <Link href="/requests">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to All Requests
          </Button>
        </Link>
      </div>

      <div className="flex items-center gap-3">
        <Bell className="h-6 w-6 text-orange-500" />
        <div>
          <h1 className="text-2xl font-bold">My Action Items</h1>
          <p className="text-muted-foreground">
            Requests awaiting your approval ({requests.length})
          </p>
        </div>
      </div>

      {requests.length === 0 ? (
        <div className="border rounded-lg p-12 text-center">
          <Bell className="h-12 w-12 mx-auto mb-4 text-gray-300" />
          <h3 className="text-lg font-semibold mb-2">No Action Items</h3>
          <p className="text-muted-foreground">
            You have no pending requests to approve at this time.
          </p>
          <Link href="/requests">
            <Button variant="outline" className="mt-4">
              View All Requests
            </Button>
          </Link>
        </div>
      ) : (
        <RequestTable initialData={requests as any} />
      )}
    </div>
  )
}

export default function MyActionsPage() {
  return (
    <div className="container mx-auto py-6">
      <Suspense fallback={<div>Loading...</div>}>
        <ActionItemsList />
      </Suspense>
    </div>
  )
}
