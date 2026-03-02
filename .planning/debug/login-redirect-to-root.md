---
status: investigating
trigger: "After login, users are redirected to root URL (http://localhost:3000) instead of their role-based dashboard (/dashboard, /engineering, or /admin)"
created: 2026-02-07T00:00:00Z
updated: 2026-02-07T00:00:00Z
---

## Current Focus
hypothesis: "Clerk Hosted Pages redirects users to root URL (/) after sign-in, not to /sign-in. The middleware only checks for /sign-in routes, so it never catches the post-login redirect."
test: "Added logging to middleware and added root URL redirect logic. User should test and observe console output to see if users land on root URL after login."
expecting: "Console logs will show that users hit root URL (/) with userId present, not /sign-in. The new root URL redirect logic should fix the issue."
next_action: "Wait for user to test with logging enabled"

## Symptoms
expected: "After login, users should be redirected to their role-based dashboard: engineering → /engineering, general_dept → /dashboard, admin → /admin"
actual: "Users land on root URL (http://localhost:3000) after login"
errors: "No errors visible in browser console or terminal"
reproduction: "User signs in using Clerk Hosted Page, then gets redirected to http://localhost:3000 instead of role-based dashboard"
started: "Issue appeared after implementing quick-012 (role-based redirect after login). Not sure if it ever worked correctly."

## Eliminated

## Evidence
- timestamp: 2026-02-07T00:00:00Z
  checked: "middleware.ts implementation"
  found: "Current implementation only redirects users when they visit /sign-in or /sign-up routes with userId. Route matcher: '/sign-in(.*)' and '/sign-up(.*)'"
  implication: "If Clerk Hosted Pages redirects to root URL (/) instead of /sign-in, the middleware will never execute the role-based redirect logic"

- timestamp: 2026-02-07T00:00:00Z
  checked: "Sign-in page implementation"
  found: "Using Clerk's SignIn component at /sign-in/[[...sign-in]]/page.tsx. This suggests embedded sign-in form, but user reports using Clerk Hosted Page"
  implication: "Clerk Hosted Pages has different redirect behavior than embedded sign-in forms"

- timestamp: 2026-02-07T00:00:00Z
  checked: "Recent commit 9c22f7b"
  found: "Added role-based redirect logic that only triggers on /sign-in route with userId. No handling for root URL redirect"
  implication: "The implementation assumes users land on /sign-in after login, which may not be true for Hosted Pages"

- timestamp: 2026-02-07T00:00:00Z
  checked: "Automated Playwright E2E tests"
  found: "General Dept (userpd1) correctly redirected to /dashboard. Admin (patawatnew@gmail.com) redirected to /dashboard instead of /admin. Engineering (enguser01) redirected to /dashboard instead of /engineering."
  implication: "Middleware IS executing and redirecting, but role detection is failing for admin and engineering users. All users are getting the default /dashboard redirect."

- timestamp: 2026-02-07T00:00:00Z
  checked: "Middleware implementation"
  found: "Middleware tried to query Prisma directly for role when Clerk metadata was missing. Got error: 'PrismaClientValidationError: In order to run Prisma Client on edge runtime...'"
  implication: "ROOT CAUSE: Middleware runs on Edge runtime which cannot access database directly. Clerk JWT metadata was not set for all users, so fallback to Prisma failed."

## Resolution
root_cause: "Middleware runs on Edge runtime and cannot query Prisma directly. Clerk JWT metadata was not properly synced for engineering and admin users. When middleware tried to fall back to Prisma database query, it failed because Edge runtime doesn't support direct database access."
fix: "1. Created /api/user/role endpoint that runs in Node.js runtime (not Edge) and can query Prisma. 2. Updated middleware to call this API endpoint with auth cookies when Clerk metadata is missing. 3. Ensured cookies are passed in fetch requests so API can authenticate the request. 4. All tests now pass - users are redirected to correct dashboard based on role."
verification: "All 4 Playwright E2E tests pass: Admin→/admin, Engineering→/engineering, General Dept→/dashboard"
files_changed: ["src/middleware.ts", "src/app/api/user/role/route.ts", "src/app/layout.tsx"]
