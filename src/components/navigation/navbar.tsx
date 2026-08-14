'use client'

import { useSession, signOut } from 'next-auth/react'
import Link from 'next/link'
import { FileText, Settings, Bell, Wrench, BarChart3, LogOut, Lock, LayoutDashboard, WalletCards, User, GitBranch } from 'lucide-react'
import { usePathname } from 'next/navigation'
import { NotificationBell } from '@/components/notifications/notification-bell'
import { AUTHENTICATED_SHELL_CLASS } from '@/lib/authenticated-shell'
import { cn } from '@/lib/utils'
import { useState, useRef, useEffect } from 'react'

const NAV_LINK_BASE =
  'flex items-center gap-2 min-h-[44px] rounded-md px-2.5 text-sm font-medium transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2'

function navLinkClass(isActive: boolean) {
  return cn(
    NAV_LINK_BASE,
    isActive
      ? 'bg-blue-50 text-blue-700'
      : 'text-slate-700 hover:bg-slate-100 hover:text-slate-950'
  )
}

export function Navbar() {
  const { data: session } = useSession()
  const user = session?.user
  const pathname = usePathname()
  const [menuOpen, setMenuOpen] = useState(false)
  const [pendingCount, setPendingCount] = useState(0)
  const [departmentName, setDepartmentName] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const userRole = user?.role || null
  const isAdmin = userRole === 'admin'
  const isEngineering = userRole === 'engineering'
  const isRequestsActive = pathname === '/requests'
  const isMyActionsActive = pathname === '/requests/my-actions'
  const isAnalyticsActive = pathname === '/analytics'
  const isBudgetMonitorActive = pathname === '/budget-monitor'
  const isDashboardActive = pathname === '/dashboard'
  const isEngineeringActive = Boolean(pathname?.startsWith('/engineering'))
  const isAdminActive = Boolean(pathname?.startsWith('/admin'))

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

  useEffect(() => {
    if (!user?.id) {
      setPendingCount(0)
      return
    }

    async function fetchPendingCount() {
      try {
        const response = await fetch('/api/actions/pending-count')
        if (response.ok) {
          const data = await response.json()
          setPendingCount(data.count || 0)
        }
      } catch (error) {
        console.error('Failed to fetch pending count:', error)
      }
    }

    fetchPendingCount()

    window.addEventListener('approvalapp:request-data-changed', fetchPendingCount)

    const interval = setInterval(fetchPendingCount, 30000)
    return () => {
      window.removeEventListener('approvalapp:request-data-changed', fetchPendingCount)
      clearInterval(interval)
    }
  }, [user?.id])

  // Department name for the secondary user line. Read-only lookup keyed to the
  // signed-in user, mirroring the pending-count fetch pattern above.
  useEffect(() => {
    if (!user?.id) {
      setDepartmentName(null)
      return
    }

    async function fetchDepartmentName() {
      try {
        const response = await fetch('/api/user/department')
        if (response.ok) {
          const data = await response.json()
          setDepartmentName(data?.name ?? null)
        }
      } catch (error) {
        console.error('Failed to fetch user department:', error)
      }
    }

    fetchDepartmentName()
  }, [user?.id])

  // Sign out always redirects to the relative /sign-in route so the browser
  // stays on the configured trusted origin — no absolute environment URL is
  // baked into client code. Errors are logged without inventing a fallback
  // origin.
  const handleSignOut = async () => {
    setMenuOpen(false)
    try {
      await signOut({ callbackUrl: '/sign-in' })
    } catch (error) {
      console.error('Sign out failed:', error)
    }
  }

  return (
    <nav className="border-b bg-white">
      <div data-auth-shell className={AUTHENTICATED_SHELL_CLASS}>
        <div className="flex h-16 items-center justify-between">
          {/* Left side - Logo and main nav */}
          <div className="flex min-w-0 items-center gap-3 xl:gap-5">
            <Link href="/requests" className="shrink-0 whitespace-nowrap text-xl font-bold text-gray-900">
              Approval System
            </Link>

            <div className="flex min-w-0 items-center gap-3 xl:gap-5">
              <Link
                href="/requests"
                aria-current={isRequestsActive ? 'page' : undefined}
                className={navLinkClass(isRequestsActive)}
              >
                <FileText className="h-4 w-4" />
                Requests
              </Link>

              <Link
                href="/requests/my-actions"
                aria-current={isMyActionsActive ? 'page' : undefined}
                className={navLinkClass(isMyActionsActive)}
              >
                <Bell className="h-4 w-4" />
                My Actions
                {pendingCount > 0 && (
                  <span
                    className="ml-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[11px] font-semibold leading-none text-white"
                    aria-label={`${pendingCount} pending actions`}
                  >
                    {pendingCount > 9 ? '9+' : pendingCount}
                  </span>
                )}
              </Link>

              <Link
                href="/analytics"
                aria-current={isAnalyticsActive ? 'page' : undefined}
                className={navLinkClass(isAnalyticsActive)}
              >
                <BarChart3 className="h-4 w-4" />
                Analytics
              </Link>

              <Link
                href="/budget-monitor"
                aria-current={isBudgetMonitorActive ? 'page' : undefined}
                className={navLinkClass(isBudgetMonitorActive)}
              >
                <WalletCards className="h-4 w-4" />
                Budget Monitor
              </Link>

              {!isEngineering && (
                <Link
                  href="/dashboard"
                  aria-current={isDashboardActive ? 'page' : undefined}
                  className={navLinkClass(isDashboardActive)}
                >
                  <LayoutDashboard className="h-4 w-4" />
                  Dashboard
                </Link>
              )}

              {isEngineering && (
                <Link
                  href="/engineering"
                  aria-current={isEngineeringActive ? 'page' : undefined}
                  className={navLinkClass(isEngineeringActive)}
                >
                  <Wrench className="h-4 w-4" />
                  Engineering
                </Link>
              )}

              {isAdmin && (
                <Link
                  href="/admin"
                  aria-current={isAdminActive ? 'page' : undefined}
                  className={navLinkClass(isAdminActive)}
                >
                  <Settings className="h-4 w-4" />
                  Admin Panel
                </Link>
              )}
            </div>
          </div>

          {/* Right side - User info and logout */}
          <div className="flex shrink-0 items-center gap-3 xl:gap-5">
            {/* Notification Bell */}
            {user && <NotificationBell userId={user.id} />}

            <div className="text-right">
              <p className="text-sm font-medium text-gray-900">{user?.name || 'User'}</p>
              <span data-user-secondary className="hidden 2xl:inline text-xs text-gray-500">
                {departmentName ? `${departmentName} • ` : ''}{user?.email}
              </span>
            </div>

            {/* User avatar with dropdown */}
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setMenuOpen(!menuOpen)}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-300 transition-colors"
                title="User menu"
                aria-label="Open user menu"
                aria-expanded={menuOpen}
              >
                {user?.name?.charAt(0)?.toUpperCase() || '?'}
              </button>

              {menuOpen && (
                <div className="absolute right-0 mt-2 w-56 rounded-md bg-white shadow-lg ring-1 ring-black ring-opacity-5 z-50">
                  <div className="py-1">
                    <Link
                      href="/profile"
                      onClick={() => setMenuOpen(false)}
                      className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                    >
                      <User className="h-4 w-4" />
                      Profile
                    </Link>
                    <Link
                      href="/approval-chain"
                      onClick={() => setMenuOpen(false)}
                      className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                    >
                      <GitBranch className="h-4 w-4" />
                      Approval Chain
                    </Link>
                    <Link
                      href="/change-password"
                      onClick={() => setMenuOpen(false)}
                      className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                    >
                      <Lock className="h-4 w-4" />
                      Change Password
                    </Link>
                    <button
                      onClick={handleSignOut}
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
