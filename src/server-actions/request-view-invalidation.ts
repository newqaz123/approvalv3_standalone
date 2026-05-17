import { revalidatePath } from 'next/cache'

const REQUEST_VIEW_PATHS = [
  '/requests',
  '/requests/my-actions',
  '/dashboard',
  '/engineering',
  '/analytics',
  '/admin/retention',
  '/admin/deleted-requests',
]

export function revalidateRequestViews(requestId?: string) {
  for (const path of REQUEST_VIEW_PATHS) {
    revalidatePath(path)
  }

  if (requestId) {
    revalidatePath(`/requests/${requestId}`)
  }
}
