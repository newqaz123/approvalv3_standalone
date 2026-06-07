'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { LayoutDashboard, FileText, Bell, BarChart3, WalletCards, Wrench } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useScrollDirection } from '@/hooks/use-scroll-direction'

interface Tab {
  name: string
  href: string
  icon: typeof LayoutDashboard
  badge?: boolean
}

const tabs: Tab[] = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { name: 'My Requests', href: '/requests', icon: FileText },
  { name: 'Pending Approvals', href: '/requests/my-actions', icon: Bell, badge: true },
  { name: 'Analytics', href: '/analytics', icon: BarChart3 },
  { name: 'Budget', href: '/budget-monitor', icon: WalletCards },
]

const engineeringTabs: Tab[] = [
  { name: 'Engineering', href: '/engineering', icon: Wrench },
  { name: 'My Requests', href: '/requests', icon: FileText },
  { name: 'Pending Approvals', href: '/requests/my-actions', icon: Bell, badge: true },
  { name: 'Analytics', href: '/analytics', icon: BarChart3 },
  { name: 'Budget', href: '/budget-monitor', icon: WalletCards },
]

/**
 * Mobile top tab bar navigation with smart scroll behavior.
 * Visible only on mobile breakpoints (< md).
 * Auto-hides when scrolling down, reappears when scrolling up.
 */
export function MobileNav() {
  const pathname = usePathname()
  const { data: session } = useSession()
  const user = session?.user
  const isVisible = useScrollDirection()
  const [pendingCount, setPendingCount] = useState(0)
  const isEngineering = user?.role === 'engineering'
  const visibleTabs = isEngineering ? engineeringTabs : tabs

  // Fetch pending actions count for badge
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

    // Refresh every 30 seconds
    const interval = setInterval(fetchPendingCount, 30000)
    return () => {
      window.removeEventListener('approvalapp:request-data-changed', fetchPendingCount)
      clearInterval(interval)
    }
  }, [user?.id])

  // Get user first initial for profile icon
  const userInitial = user?.name?.[0] || user?.email?.[0] || 'U'

  return (
    <nav
      className={cn(
        'fixed top-0 left-0 right-0 z-50 bg-white border-b border-gray-200 transition-transform duration-300 md:hidden',
        isVisible ? 'translate-y-0' : '-translate-y-full'
      )}
    >
      <div className="flex items-center justify-between px-2 sm:px-4 h-16">
        {/* Left side - Tabs */}
        <div className="flex items-center gap-1 flex-1">
          {visibleTabs.map((tab) => {
            const isActive = pathname === tab.href
            const Icon = tab.icon

            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={cn(
                  'flex items-center gap-1.5 px-2.5 py-2 rounded-md min-h-[44px] min-w-[44px] transition-colors',
                  isActive
                    ? 'bg-gray-100 text-gray-900'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                )}
              >
                <Icon className="h-5 w-5 flex-shrink-0" />
                <span className="text-sm font-medium hidden sm:inline">{tab.name}</span>

                {/* Notification badge for Pending Approvals */}
                {tab.badge && pendingCount > 0 && (
                  <span className="ml-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-xs text-white font-semibold">
                    {pendingCount > 9 ? '9+' : pendingCount}
                  </span>
                )}
              </Link>
            )
          })}
        </div>

        {/* Right side - User profile icon */}
        <div className="flex items-center">
          <div className="h-9 w-9 rounded-full bg-blue-600 flex items-center justify-center text-white font-semibold text-sm">
            {userInitial}
          </div>
        </div>
      </div>
    </nav>
  )
}
