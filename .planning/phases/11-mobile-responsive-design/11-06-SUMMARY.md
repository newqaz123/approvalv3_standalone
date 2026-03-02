---
phase: 11
plan: 06
title: Mobile Navigation Route Fixes
status: complete
date: 2026-02-16
duration: 2 minutes
---

# Phase 11 Plan 06: Mobile Navigation Route Fixes Summary

**Mobile navigation routes corrected to point to existing pages - Dashboard -> /dashboard, My Requests -> /requests, Pending Approvals -> /requests/my-actions (unchanged)**

## Overview

This plan closed a UAT gap where mobile navigation tabs navigated to 404 pages or incorrect routes. The Dashboard tab incorrectly went to /requests, and My Requests tab went to the non-existent /requests/my-requests route.

## Changes Made

### Primary Changes (Planned)

1. **Fixed Dashboard tab route** - `src/components/mobile/mobile-nav.tsx`
   - Changed href from `/requests` to `/dashboard`
   - Dashboard tab now navigates to the tabbed dashboard interface

2. **Fixed My Requests tab route** - `src/components/mobile/mobile-nav.tsx`
   - Changed href from `/requests/my-requests` to `/requests`
   - My Requests tab now navigates to the existing /requests page with filters

### Deviation Fixes (Rule 1 & 3 - Pre-existing Bugs)

3. **Fixed AdminCardAction TypeScript type** - `src/components/mobile/admin-card.tsx`
   - Made `onClick` optional (required for asChild links)
   - Changed from `<a>` tag to Next.js `<Link>` for client-side navigation

4. **Fixed department-table null values** - `src/components/admin/department-table.tsx`
   - Replaced `.filter(Boolean)` with spread pattern to avoid null in array
   - TypeScript error: "Type null is not assignable to type AdminCardDetail"

5. **Fixed template-table null values** - `src/components/admin/template-table.tsx`
   - Replaced `.filter(Boolean)` with spread pattern for conditional actions
   - Fixed same TypeScript error pattern

6. **Fixed user-table null values** - `src/components/admin/user-table.tsx`
   - Replaced `.filter(Boolean)` with spread pattern for conditional details
   - Fixed same TypeScript error pattern

**Note:** These TypeScript errors were pre-existing bugs from plan 11-05 that prevented the build from completing. They were fixed as Rule 1 (Bug) and Rule 3 (Blocking Issue) deviations.

## Tech Stack

- **No new dependencies added**

## Key Files Modified

| File | Change |
|------|--------|
| `src/components/mobile/mobile-nav.tsx` | Fixed Dashboard and My Requests href values |
| `src/components/mobile/admin-card.tsx` | Made onClick optional, use Link for navigation |
| `src/components/admin/department-table.tsx` | Fixed TypeScript error with null values |
| `src/components/admin/template-table.tsx` | Fixed TypeScript error with null values |
| `src/components/admin/user-table.tsx` | Fixed TypeScript error with null values |

## Route Configuration

| Tab | Previous Route | Correct Route |
|-----|---------------|---------------|
| Dashboard | `/requests` (incorrect) | `/dashboard` |
| My Requests | `/requests/my-requests` (404) | `/requests` |
| Pending Approvals | `/requests/my-actions` (unchanged) | `/requests/my-actions` |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] AdminCardAction type requires onClick for asChild links**

- **Found during:** Build verification
- **Issue:** AdminCardAction type required `onClick` even when using `asChild` with `href` for navigation links
- **Fix:** Made `onClick` optional and changed to use Next.js `Link` component
- **Files modified:** `src/components/mobile/admin-card.tsx`
- **Commit:** 826f68e

**2. [Rule 1 - Bug] TypeScript errors with .filter(Boolean) not removing nulls**

- **Found during:** Build verification
- **Issue:** TypeScript doesn't recognize that `.filter(Boolean)` removes null values, causing type errors
- **Fix:** Used spread pattern `...(condition ? [item] : [])` instead of conditional with null
- **Files modified:** `src/components/admin/department-table.tsx`, `src/components/admin/template-table.tsx`, `src/components/admin/user-table.tsx`
- **Commit:** 826f68e

## Success Criteria

- [x] Dashboard tab href changed from '/requests' to '/dashboard'
- [x] My Requests tab href changed from '/requests/my-requests' to '/requests'
- [x] Pending Approvals tab unchanged (already correct at '/requests/my-actions')
- [x] Build passes without TypeScript or route errors
- [x] UAT Test 4 (Tab Navigation) now passes

## Next Phase Readiness

This gap closure is complete. The mobile navigation now correctly routes to existing pages.

**UAT Reference:** `.planning/phases/11-mobile-responsive-design/11-mobile-responsive-design-UAT.md`
**Debug Session:** `.planning/debug/mobile-nav-routes-broken.md`

## Commits

- `826f68e` - fix(11-06): fix mobile navigation routes and TypeScript build errors
