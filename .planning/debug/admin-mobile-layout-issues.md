---
status: diagnosed
trigger: "Mobile layout issues in admin dashboard - empty space, overlapping nav, small text, redundant navigation"
created: 2026-02-16T10:30:00Z
updated: 2026-02-16T10:40:00Z
---

## Current Focus
hypothesis: Root causes identified: (1) Admin pages use `container mx-auto` instead of layout's padding, causing horizontal overflow; (2) Main content has `pt-8` which doesn't account for fixed mobile nav height (64px); (3) Text uses `text-sm` throughout cards; (4) Both mobile and desktop nav render simultaneously on small screens
test: Verified responsive breakpoints are correct (md:hidden in tables), identified specific CSS classes causing issues
expecting: Root cause is in page wrapper and layout structure, not in table components themselves
next_action: Document all root causes and specific fixes needed

## Symptoms
expected: Admin tables (Users, Departments, Templates) display as cards on mobile with no empty space, top bar does not overlap content, text is readable, no redundant navigation
actual: Large empty space on right side (desktop layout visible), top navigation bar overlaps content, small text that's hard to read, redundant navigation elements (multiple nav bars)
errors: None reported
reproduction: Open admin dashboard on iPhone 13 or mobile viewport
started: Not specified (assumed existing issue)

## Eliminated

## Evidence

- timestamp: 2026-02-16T10:30:00Z
  checked: Layout structure in src/app/(dashboard)/layout.tsx
  found:
    - MobileNav uses `md:hidden` (line 62) - CORRECT
    - Desktop Navbar wrapped in `hidden md:block` (lines 23-25) - CORRECT
    - Main content uses `pt-8` padding on mobile (line 28) - TOO SMALL for fixed nav (64px)
  implication: Top nav overlap is caused by insufficient top padding, not duplicate nav rendering

- timestamp: 2026-02-16T10:31:00Z
  checked: Admin table components (user-table.tsx, department-table.tsx, template-table.tsx)
  found:
    - All three have correct mobile card view: `<div className="md:hidden space-y-3">` (lines 194, 162, 208)
    - All three have correct desktop table view: `<div className="hidden md:block">` (lines 264, 216, 275)
    - Responsive breakpoints implemented correctly
  implication: Table components are NOT the problem - issue is in page wrapper or layout

- timestamp: 2026-02-16T10:32:00Z
  checked: Admin page wrappers (users/page.tsx, departments/page.tsx, templates/page.tsx)
  found:
    - All use `<div className="container mx-auto py-6">` wrapper (lines 32, 28, 35)
    - `container` class in Tailwind defaults to responsive widths with horizontal margins
    - No `px-4` or horizontal padding on mobile
    - Main layout already has `px-4 sm:px-6 lg:px-8` (layout.tsx line 28)
  implication: Double container issue - `container mx-auto` conflicts with layout's max-width and padding, causing horizontal overflow

- timestamp: 2026-02-16T10:33:00Z
  checked: AdminCard component mobile styling
  found:
    - Title uses `text-gray-900` but no explicit size (line 83) - inherits default
    - Details use `text-sm` (line 145) - TOO SMALL for mobile
    - Labels use `text-gray-500` (line 151) - low contrast
    - Card padding is `p-4` (line 171) - adequate
  implication: Small text issue caused by `text-sm` class throughout AdminCard component

- timestamp: 2026-02-16T10:34:00Z
  checked: MobileNav positioning
  found:
    - Uses `fixed top-0 left-0 right-0 z-50` (line 60-62) - fixed to top of viewport
    - Height is `h-16` (64px) (line 66)
    - Main content uses `pt-8` (32px) - INSUFFICIENT
  implication: Content starts 32px from top, nav is 64px tall, causing 32px overlap

## Resolution
root_cause:
  **Issue 1 - Horizontal overflow/empty space on right side**:
  - File: `/src/app/admin/users/page.tsx` (line 32), `/src/app/admin/departments/page.tsx` (line 28), `/src/app/admin/templates/page.tsx` (line 35)
  - Cause: All admin pages use `<div className="container mx-auto py-6">` wrapper
  - Why this breaks: The dashboard layout already applies `max-w-7xl mx-auto px-4 sm:px-6 lg:px-8` (layout.tsx:28), then the admin pages add another `container mx-auto` with its own horizontal margins, creating a double-container effect that causes horizontal overflow and empty space on the right
  - Impact: Content doesn't fill available width on mobile, shows empty space on right side

  **Issue 2 - Top navigation bar overlaps content**:
  - File: `/src/app/(dashboard)/layout.tsx` (line 28)
  - Cause: Main content element has `className="mx-auto max-w-7xl px-4 pt-8 pb-8 md:py-8 sm:px-6 lg:px-8"`
  - Why this breaks: On mobile, `pt-8` applies 32px top padding, but the fixed MobileNav is 64px tall (`h-16`), causing a 32px overlap where content is hidden behind the navigation bar
  - Impact: Page titles and content are partially obscured by the fixed top navigation

  **Issue 3 - Small text that's hard to read**:
  - File: `/src/components/mobile/admin-card.tsx` (line 145)
  - Cause: All detail rows in AdminCard use `text-sm` class (14px font size)
  - Why this breaks: On mobile devices, especially small screens like iPhone 13, 14px text is below the recommended 16px minimum for readable mobile content
  - Impact: Users must strain to read card details, poor accessibility

  **Issue 4 - Redundant navigation elements**:
  - After investigation: NO actual redundant navigation found
  - MobileNav correctly uses `md:hidden` (mobile-nav.tsx:62)
  - Desktop Navbar correctly uses `hidden md:block` (layout.tsx:23)
  - Likely user perception issue: Seeing both the top MobileNav tab bar AND page headers/titles creates visual clutter that feels like "multiple nav bars"
  - The "Dashboard", "My Requests", "Pending Approvals" tabs in MobileNav may feel redundant when also seeing page titles like "Users", "Departments", "Templates"

fix:
  **Fix 1 - Remove container wrapper from admin pages**:
  - Files: `/src/app/admin/users/page.tsx`, `/src/app/admin/departments/page.tsx`, `/src/app/admin/templates/page.tsx`
  - Change: Replace `<div className="container mx-auto py-6">` with `<div className="space-y-4">`
  - Remove the outer container div entirely, let the layout handle spacing

  **Fix 2 - Add mobile-specific top padding to layout**:
  - File: `/src/app/(dashboard)/layout.tsx` (line 28)
  - Change: Update `pt-8` to `pt-20 md:pt-8` (80px on mobile accounts for 64px nav + 16px breathing room)
  - This ensures content clears the fixed mobile navigation bar

  **Fix 3 - Increase mobile text size in AdminCard**:
  - File: `/src/components/mobile/admin-card.tsx` (line 145)
  - Change: Update `text-sm` to `text-base` for detail rows
  - Also consider: Update line 83 title to use `text-lg` for better hierarchy

  **Fix 4 - Not a code fix, but design consideration**:
  - Consider if MobileNav tabs are needed on admin pages (they don't navigate to admin sections)
  - Could hide MobileNav on admin routes since admin has its own navigation pattern

verification: []
files_changed: []
