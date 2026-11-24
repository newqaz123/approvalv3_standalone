'use client'

import { useState, useEffect, useRef } from 'react'
import { useTranslations } from '@/lib/i18n/client'
import { Bell } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { NotificationList } from './notification-list'
import { RequestModalRouter } from '@/components/requests/request-modal-router'
import {
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
} from '@/server-actions/notifications'
import { toast } from 'sonner'

interface NotificationBellProps {
  userId: string
}

export function NotificationBell({ userId }: NotificationBellProps) {
  const t = useTranslations()
  const latestTranslations = useRef(t)
  useEffect(() => { latestTranslations.current = t }, [t])
  const [notifications, setNotifications] = useState<Awaited<ReturnType<typeof getNotifications>>>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [isOpen, setIsOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)

  // Fetch once per user, then refresh in place. A loaded-flag dependency
  // restarts this effect, fetches again, and replaces the open list while a
  // click is in progress.
  useEffect(() => {
    let cancelled = false
    let loaded = false

    async function fetchNotifications() {
      if (!loaded) setIsLoading(true)
      try {
        const [notifs, count] = await Promise.all([
          getNotifications(userId, 20),
          getUnreadCount(userId),
        ])
        if (cancelled) return
        setNotifications(notifs)
        setUnreadCount(count)
        loaded = true
      } catch (error) {
        if (cancelled) return
        console.error('Failed to fetch notifications:', error)
        toast.error(latestTranslations.current('notifications.loadFailed'))
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    void fetchNotifications()

    const interval = setInterval(() => {
      void fetchNotifications()
    }, 30000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [userId])

  const handleMarkAsRead = async (notificationId: string) => {
    try {
      await markAsRead(notificationId)

      // Update local state
      setNotifications((prev) =>
        prev.map((notif) =>
          notif.id === notificationId ? { ...notif, isRead: true } : notif
        )
      )
      setUnreadCount((prev) => Math.max(0, prev - 1))
    } catch (error) {
      console.error('Failed to mark as read:', error)
      toast.error(latestTranslations.current('notifications.markReadFailed'))
    }
  }

  const handleMarkAllAsRead = async () => {
    try {
      const result = await markAllAsRead(userId)

      // Update local state
      setNotifications((prev) =>
        prev.map((notif) => ({ ...notif, isRead: true }))
      )
      setUnreadCount(0)

      toast.success(latestTranslations.current('notifications.markedAllRead', { count: result.count }))
    } catch (error) {
      console.error('Failed to mark all as read:', error)
      toast.error(latestTranslations.current('notifications.markAllReadFailed'))
    }
  }

  const handleOpenRequest = (requestId: string) => {
    setSelectedRequestId(requestId)
    setIsModalOpen(true)
    setIsOpen(false)
  }

  const handleModalChange = (open: boolean) => {
    setIsModalOpen(open)
    if (!open) {
      setSelectedRequestId(null)
    }
  }

  return (
    <>
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="relative"
            aria-label={unreadCount > 0 ? t('notifications.unread', { count: unreadCount }) : t('notifications.heading')}
          >
            <Bell className="h-5 w-5" aria-hidden="true" />
            {unreadCount > 0 && (
              <span aria-hidden="true" className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-xs text-white">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-96 p-0" align="end">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="text-sm text-gray-500">{t('notifications.loading')}</div>
            </div>
          ) : (
            <NotificationList
              notifications={notifications}
              onMarkAsRead={handleMarkAsRead}
              onMarkAllAsRead={handleMarkAllAsRead}
              onOpenRequest={handleOpenRequest}
            />
          )}
        </PopoverContent>
      </Popover>

      {selectedRequestId && (
        <RequestModalRouter
          requestId={selectedRequestId}
          open={isModalOpen}
          onOpenChange={handleModalChange}
        />
      )}
    </>
  )
}
