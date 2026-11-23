'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { LayoutDashboard, FileText, Bell, BarChart3, WalletCards, Wrench, Settings } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useScrollDirection } from '@/hooks/use-scroll-direction'
import { UserMenu } from '@/components/navigation/user-menu'
import { useTranslations } from '@/lib/i18n/client'
import type { MessageKey } from '@/lib/i18n/messages'

interface Tab {
  label: MessageKey
  href: string
  icon: typeof LayoutDashboard
  badge?: boolean
  /** Active on nested routes too (e.g. /admin/users). */
  matchNested?: boolean
}

const tabs: Tab[] = [
  { label: 'nav.dashboard', href: '/dashboard', icon: LayoutDashboard },
  { label: 'nav.myRequests', href: '/requests', icon: FileText },
  { label: 'nav.pendingApprovals', href: '/requests/my-actions', icon: Bell, badge: true },
  { label: 'nav.analytics', href: '/analytics', icon: BarChart3 },
  { label: 'nav.budget', href: '/budget-monitor', icon: WalletCards },
]

const engineeringTabs: Tab[] = [
  { label: 'nav.engineering', href: '/engineering', icon: Wrench, matchNested: true },
  { label: 'nav.myRequests', href: '/requests', icon: FileText },
  { label: 'nav.pendingApprovals', href: '/requests/my-actions', icon: Bell, badge: true },
  { label: 'nav.analytics', href: '/analytics', icon: BarChart3 },
  { label: 'nav.budget', href: '/budget-monitor', icon: WalletCards },
]

// Admin is a flag on top of the user's unit, so this tab is appended to the
// unit tabs instead of replacing them.
const adminTab: Tab = { label: 'nav.admin', href: '/admin', icon: Settings, matchNested: true }

/**
 * Mobile top tab bar navigation with smart scroll behavior.
 * Visible only on mobile breakpoints (< lg).
 * Auto-hides when scrolling down unless it has focus or the menu is open.
 */
export function MobileNav() {
  const t = useTranslations()
  const pathname = usePathname()
  const { data: session } = useSession()
  const user = session?.user
  const isVisible = useScrollDirection()
  const [menuOpen, setMenuOpen] = useState(false)
  const [pendingCount, setPendingCount] = useState(0)
  // Engineering tab follows the unit "Can work on solutions" flag (from
  // /api/user/department), never the user role.
  const [canWorkOnSolutions, setCanWorkOnSolutions] = useState(false)
  const isEngineering = canWorkOnSolutions
  const isAdmin = user?.role === 'admin'
  const unitTabs = isEngineering ? engineeringTabs : tabs
  const visibleTabs = isAdmin ? [...unitTabs, adminTab] : unitTabs
  // Five labelled tabs fit from md; the extra Admin tab needs ~845px.
  const labelVisibleClass = isAdmin
    ? 'min-[880px]:not-sr-only min-[880px]:whitespace-nowrap'
    : 'md:not-sr-only md:whitespace-nowrap'

  useEffect(() => {
    if (!user?.id) {
      setCanWorkOnSolutions(false)
      return
    }

    async function fetchSolutionWorkEligibility() {
      try {
        const response = await fetch('/api/user/department')
        if (response.ok) {
          const data = await response.json()
          setCanWorkOnSolutions(data?.canWorkOnSolutions === true)
        }
      } catch (error) {
        console.error('Failed to fetch user unit:', error)
      }
    }

    fetchSolutionWorkEligibility()
  }, [user?.id])

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

  return (
    <nav
      aria-label={t('nav.main')}
      className={cn(
        'fixed top-0 left-0 right-0 z-50 bg-white border-b border-gray-200 transition-transform duration-300 lg:hidden',
        // translate-y-0 is still a transform and blocks iOS taps on the
        // overflowing dropdown. Drop the transform entirely while open.
        menuOpen ? 'transform-none' : isVisible ? 'translate-y-0' : '-translate-y-full focus-within:transform-none'
      )}
    >
      <div className="flex items-center justify-between px-2 sm:px-4 h-16">
        {/* Left side - Tabs */}
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {visibleTabs.map((tab) => {
            const isActive = tab.matchNested
              ? Boolean(pathname?.startsWith(tab.href))
              : pathname === tab.href
            const Icon = tab.icon

            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'flex shrink-0 items-center gap-1.5 px-2.5 py-2 rounded-md min-h-[44px] min-w-[44px] transition-colors',
                  isActive
                    ? 'bg-gray-100 text-gray-900'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                )}
              >
                <Icon className="h-5 w-5 flex-shrink-0" aria-hidden="true" />
                {/* Icon-only on narrow screens: sr-only keeps the label as the
                    link's accessible name (display:none would drop it). */}
                <span className={cn('text-sm font-medium sr-only', labelVisibleClass)}>{t(tab.label)}</span>

                {/* Notification badge for Pending Approvals */}
                {tab.badge && pendingCount > 0 && (
                  <span
                    className="ml-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-xs text-white font-semibold"
                    aria-label={t('nav.pendingActionCount', { count: pendingCount })}
                  >
                    {pendingCount > 9 ? '9+' : pendingCount}
                  </span>
                )}
              </Link>
            )
          })}
        </div>

        {/* Right side - User profile menu (tappable avatar) */}
        <div className="flex items-center">
          <UserMenu variant="mobile" onOpenChange={setMenuOpen} />
        </div>
      </div>
    </nav>
  )
}
