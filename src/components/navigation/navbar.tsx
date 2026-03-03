'use client'

import { useSession, signOut } from 'next-auth/react'
import Link from 'next/link'
import { FileText, Settings, Bell, Wrench, BarChart3, LogOut, Lock } from 'lucide-react'
import { usePathname } from 'next/navigation'
import { NotificationBell } from '@/components/notifications/notification-bell'
import { useState, useRef, useEffect } from 'react'

export function Navbar() {
  const { data: session } = useSession()
  const user = session?.user
  const pathname = usePathname()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const userRole = user?.role || null
  const isAdmin = userRole === 'admin'
  const isEngineering = userRole === 'engineering'

  // Close menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

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
              <p className="text-sm font-medium text-gray-900">{user?.name || 'User'}</p>
              <p className="text-xs text-gray-500">
                {userRole ? userRole.charAt(0).toUpperCase() + userRole.slice(1).replace('_', ' ') : 'User'} • {user?.email}
              </p>
            </div>

            {/* User avatar with dropdown */}
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setMenuOpen(!menuOpen)}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-300 transition-colors"
                title="User menu"
              >
                {user?.name?.charAt(0)?.toUpperCase() || '?'}
              </button>

              {menuOpen && (
                <div className="absolute right-0 mt-2 w-48 rounded-md bg-white shadow-lg ring-1 ring-black ring-opacity-5 z-50">
                  <div className="py-1">
                    <Link
                      href="/change-password"
                      onClick={() => setMenuOpen(false)}
                      className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                    >
                      <Lock className="h-4 w-4" />
                      Change Password
                    </Link>
                    <button
                      onClick={() => {
                        setMenuOpen(false)
                        signOut({ callbackUrl: '/sign-in' })
                      }}
                      className="flex w-full items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 text-left"
                    >
                      <LogOut className="h-4 w-4" />
                      Sign Out
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </nav>
  )
}
