'use client'

import { UserButton, useUser } from '@clerk/nextjs'
import Link from 'next/link'
import { FileText, Settings, Bell, Wrench, BarChart3 } from 'lucide-react'
import { usePathname } from 'next/navigation'
import { NotificationBell } from '@/components/notifications/notification-bell'
import { useEffect, useState } from 'react'

export function Navbar() {
  const { user } = useUser()
  const pathname = usePathname()
  const [userRole, setUserRole] = useState<string | null>(null)

  // Fetch role from Prisma (source of truth) to avoid Clerk metadata sync issues
  useEffect(() => {
    if (user?.id) {
      fetch('/api/user/role')
        .then((res) => res.json())
        .then((data) => {
          if (data.role) {
            setUserRole(data.role)
          }
        })
        .catch((err) => console.error('Error fetching user role:', err))
    }
  }, [user?.id])

  const isAdmin = userRole === 'admin'
  const isEngineering = userRole === 'engineering'

  return (
    <nav className="border-b bg-white">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          {/* Left side - Logo and main nav */}
          <div className="flex items-center gap-8">
            <Link href="/requests" className="text-xl font-bold text-gray-900">
              Approval System
            </Link>

            <div className="flex items-center gap-4">
              <Link
                href="/requests"
                className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium ${
                  pathname === '/requests'
                    ? 'bg-gray-100 text-gray-900'
                    : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900'
                }`}
              >
                <FileText className="h-4 w-4" />
                Requests
              </Link>

              <Link
                href="/requests/my-actions"
                className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium ${
                  pathname === '/requests/my-actions'
                    ? 'bg-gray-100 text-gray-900'
                    : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900'
                }`}
              >
                <Bell className="h-4 w-4" />
                My Actions
              </Link>

              <Link
                href="/analytics"
                className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium ${
                  pathname === '/analytics'
                    ? 'bg-gray-100 text-gray-900'
                    : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900'
                }`}
              >
                <BarChart3 className="h-4 w-4" />
                Analytics
              </Link>

              {isEngineering && (
                <Link
                  href="/engineering"
                  className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium ${
                    pathname?.startsWith('/engineering')
                      ? 'bg-gray-100 text-gray-900'
                      : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900'
                  }`}
                >
                  <Wrench className="h-4 w-4" />
                  Engineering
                </Link>
              )}

              {isAdmin && (
                <Link
                  href="/admin"
                  className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium ${
                    pathname?.startsWith('/admin')
                      ? 'bg-gray-100 text-gray-900'
                      : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900'
                  }`}
                >
                  <Settings className="h-4 w-4" />
                  Admin Panel
                </Link>
              )}
            </div>
          </div>

          {/* Right side - User info and logout */}
          <div className="flex items-center gap-4">
            {/* Notification Bell */}
            {user && <NotificationBell userId={user.id} />}

            <div className="text-right">
              <p className="text-sm font-medium text-gray-900">{user?.fullName || user?.firstName || 'User'}</p>
              <p className="text-xs text-gray-500">
                {userRole ? userRole.charAt(0).toUpperCase() + userRole.slice(1) : 'User'} • {user?.primaryEmailAddress?.emailAddress}
              </p>
            </div>

            {/* Clerk UserButton with logout */}
            <UserButton
              afterSignOutUrl="/sign-in"
              appearance={{
                elements: {
                  avatarBox: 'h-10 w-10',
                },
              }}
            />
          </div>
        </div>
      </div>
    </nav>
  )
}
