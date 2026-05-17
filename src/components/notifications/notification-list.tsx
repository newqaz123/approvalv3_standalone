'use client'
import { formatDistanceToNow } from 'date-fns'
import {
  Bell,
  CheckCircle,
  XCircle,
  AlertCircle,
  RefreshCw,
  FileCheck,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { NotificationType } from '@prisma/client'

interface NotificationListProps {
  notifications: Array<{
    id: string
    type: NotificationType
    title: string
    message: string
    requestId: string | null
    request?: { title: string } | null
    isRead: boolean
    createdAt: Date
  }>
  onMarkAsRead: (id: string) => void
  onMarkAllAsRead: () => void
  onOpenRequest: (requestId: string) => void
}

export function NotificationList({
  notifications,
  onMarkAsRead,
  onMarkAllAsRead,
  onOpenRequest,
}: NotificationListProps) {
  const getNotificationIcon = (type: NotificationType) => {
    const iconClass = 'h-5 w-5'

    switch (type) {
      case 'approval_needed':
      case 'final_approval_needed':
        return <AlertCircle className={`${iconClass} text-yellow-600`} />
      case 'approval_granted':
        return <CheckCircle className={`${iconClass} text-green-600`} />
      case 'approval_rejected':
        return <XCircle className={`${iconClass} text-red-600`} />
      case 'status_changed':
        return <RefreshCw className={`${iconClass} text-blue-600`} />
      case 'solution_ready':
        return <FileCheck className={`${iconClass} text-green-600`} />
      case 'request_assigned':
        return <Bell className={`${iconClass} text-blue-600`} />
      default:
        return <Bell className={iconClass} />
    }
  }

  const handleNotificationClick = (notification: typeof notifications[0]) => {
    onMarkAsRead(notification.id)

    if (notification.requestId) {
      onOpenRequest(notification.requestId)
    }
  }

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h3 className="font-semibold">Notifications</h3>
        {notifications.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onMarkAllAsRead}
            className="text-xs"
          >
            Mark all as read
          </Button>
        )}
      </div>

      {/* Notifications */}
      <ScrollArea className="h-[400px]">
        {notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-gray-500">
            <Bell className="mb-2 h-12 w-12 opacity-20" />
            <p className="text-sm">No notifications</p>
          </div>
        ) : (
          <div className="divide-y">
            {notifications.map((notification) => (
              <button
                key={notification.id}
                onClick={() => handleNotificationClick(notification)}
                className="flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50"
              >
                <div className="mt-0.5 flex-shrink-0">
                  {getNotificationIcon(notification.type)}
                </div>

                <div className="flex-1 overflow-hidden">
                  <div className="flex items-center gap-2">
                    <p
                      className={`text-sm font-medium ${
                        notification.isRead ? 'text-gray-700' : 'text-gray-900'
                      }`}
                    >
                      {notification.title}
                    </p>
                    {!notification.isRead && (
                      <span className="h-2 w-2 rounded-full bg-blue-600" />
                    )}
                  </div>

                  <p className="line-clamp-2 text-xs text-gray-600">
                    {notification.message}
                  </p>

                  {notification.request && (
                    <p className="mt-1 text-xs text-gray-500">
                      Request: {notification.request.title}
                    </p>
                  )}

                  <p className="mt-1 text-xs text-gray-400">
                    {formatDistanceToNow(new Date(notification.createdAt), {
                      addSuffix: true,
                    })}
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  )
}
