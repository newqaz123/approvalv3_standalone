import React from 'react'
import Link from 'next/link'

/**
 * Header tabs for /admin/organization. Each tab targets exactly one canvas:
 * the Organization tab (default, no panel param) shows the flowchart
 * workspace, panel=positions the position admin panel, panel=chains the
 * approval chains panel (including the per-unit View/Customize deep link,
 * which keeps its scope/phase query params). The header-* testids keep the
 * pre-tab navigation contract used by the e2e specs.
 */
const TABS = [
  { key: 'organization', label: 'Organization', href: '/admin/organization', testId: 'header-organization' },
  { key: 'positions', label: 'Positions', href: '/admin/organization?panel=positions', testId: 'header-positions' },
  { key: 'chains', label: 'Approval chains', href: '/admin/organization?panel=chains', testId: 'header-approval-chains' },
] as const

export type OrganizationTabKey = (typeof TABS)[number]['key']

export function OrganizationTabs({ active }: { active: OrganizationTabKey }) {
  return (
    <nav
      data-testid="organization-tabs"
      aria-label="Organization canvases"
      className="organization-tabs flex flex-wrap items-center gap-1 rounded-lg bg-muted p-1"
    >
      {TABS.map((tab) => {
        const isActive = tab.key === active
        return (
          <Link
            key={tab.key}
            href={tab.href}
            data-testid={tab.testId}
            aria-current={isActive ? 'page' : undefined}
            data-active={isActive ? 'true' : undefined}
            className={`inline-flex min-h-8 items-center rounded-md px-3 py-1 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 ${
              isActive
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
            }`}
          >
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}
