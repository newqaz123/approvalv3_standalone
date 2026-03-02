---
status: diagnosed
trigger: "Mobile navigation tabs have broken routes - My Requests leads to 404, Dashboard goes to /requests instead of /dashboard"
created: 2025-02-16T00:00:00Z
updated: 2025-02-16T00:00:00Z
---

## Current Focus
hypothesis: Mobile navigation was configured before dashboard page was restructured
test: Compare mobile-nav.tsx routes against actual app directory structure
expecting: Find that /requests/my-requests doesn't exist (it's a tab in dashboard), and /requests is not the dashboard
next_action: Complete diagnosis and provide fix recommendations

## Symptoms
expected: Mobile navigation tabs should link to existing, correct pages
actual: "My Requests" tab → 404, "Dashboard" tab → wrong route (/requests instead of /dashboard)
errors: 404 pages on mobile navigation
reproduction: Click mobile nav tabs
started: Reported in UAT

## Eliminated

## Evidence

- timestamp: 2025-02-16T00:00:00Z
  checked: Mobile navigation configuration (mobile-nav.tsx:18-22)
  found: Tabs configured as: Dashboard → /requests, My Requests → /requests/my-requests, Pending Approvals → /requests/my-actions
  implication: Routes were configured based on old or incorrect understanding of app structure

- timestamp: 2025-02-16T00:00:00Z
  checked: Actual app directory structure (src/app/(dashboard)/)
  found: Existing pages are: /dashboard/page.tsx, /requests/page.tsx, /requests/my-actions/page.tsx, /requests/new/page.tsx
  implication: /requests/my-requests does NOT exist as a route (confirmed with ls -la)

- timestamp: 2025-02-16T00:00:00Z
  checked: /requests/page.tsx content
  found: This page shows "View and track improvement requests from your department" with RequestsListWithFilters component
  implication: This is NOT the dashboard - it's the general requests list page

- timestamp: 2025-02-16T00:00:00Z
  checked: /dashboard/page.tsx content
  found: Shows DashboardTabs component with three tabs: "pending", "my-requests", "all"
  implication: "My Requests" is a TAB within the dashboard, not a separate route

- timestamp: 2025-02-16T00:00:00Z
  checked: DashboardTabs component
  found: Has internal tabs for "Pending My Approval", "My Requests", and "All Requests" with defaultValue="pending"
  implication: The dashboard is a single page with tabbed interface, not three separate routes

## Resolution
root_cause: Mobile navigation routes were incorrectly configured. The app structure uses a tabbed dashboard interface at /dashboard, but mobile nav points to non-existent routes (/requests/my-requests) and wrong routes (/requests instead of /dashboard).

fix: Update mobile-nav.tsx tabs configuration to use correct routes:
- Dashboard tab: /dashboard (not /requests)
- My Requests tab: /dashboard (same as dashboard, user can switch to "my-requests" tab)
- Pending Approvals tab: /requests/my-actions (this is correct)

verification: Test mobile navigation clicks and verify all routes load without 404 errors
files_changed: []
root_cause:
fix:
verification:
files_changed: []
