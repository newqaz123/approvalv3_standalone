---
phase: quick-012
plan: 012
type: execute
wave: 1
depends_on: []
files_modified:
  - src/middleware.ts
autonomous: true
user_setup: []

must_haves:
  truths:
    - "General department users are redirected to /dashboard after login"
    - "Engineering users are redirected to /engineering after login"
    - "Admin users are redirected to /admin after login"
    - "Users without a role default to /dashboard"
  artifacts:
    - path: "src/middleware.ts"
      provides: "Role-based redirect logic after sign-in"
      exports: ["middleware default export"]
  key_links:
    - from: "src/middleware.ts"
      to: "Clerk sessionClaims.metadata.role"
      via: "await auth() to get role from JWT"
      pattern: "sessionClaims.*metadata.*role"
---

<objective>
Implement role-based redirects after login so users are directed to their appropriate dashboard based on their role.

Purpose: Improve user experience by automatically directing users to their relevant dashboard after login instead of a generic landing page.
Output: Updated middleware that redirects users based on role after sign-in completion.
</objective>

<execution_context>
@./.claudette/get-shit-done/workflows/execute-plan.md
@./.claudette/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@src/middleware.ts
@src/lib/auth.ts
@prisma/schema.prisma

**Current state:**
- UserRole enum: admin, general_dept, engineering
- Clerk authentication stores role in publicMetadata
- Middleware currently protects /dashboard, /admin, /engineering routes
- No custom redirect after sign-in (uses Clerk default)

**Destination routes:**
- general_dept -> /dashboard
- engineering -> /engineering
- admin -> /admin
- unknown/default -> /dashboard
</context>

<tasks>

<task type="auto">
  <name>Add role-based redirect after sign-in to middleware</name>
  <files>src/middleware.ts</files>
  <action>
    1. Import createRouteMatcher from @clerk/nextjs/server (already imported)
    2. Add a route matcher for sign-in completion: `const isSignInRoute = createRouteMatcher(['/sign-in(.*)', '/sign-up(.*)'])`
    3. In middleware, add logic AFTER auth() that:
       - Checks if the user just completed sign-in by checking the URL path or query param
       - For authenticated users accessing sign-in page (which happens after login):
         - Get role from sessionClaims.metadata.role
         - Redirect based on role:
           - 'engineering' -> /engineering
           - 'admin' -> /admin
           - 'general_dept' or any other value -> /dashboard
    4. Use Clerk's pattern: check for ?redirect_url or detect when on sign-in route while authenticated
    5. DO NOT add redirects for users already on their target route (avoid infinite loops)

    **Implementation pattern:**
    ```typescript
    // After auth protection, before returning
    if (isSignInRoute(req) && userId) {
      const { sessionClaims } = await auth()
      const role = sessionClaims?.metadata?.role as string | undefined

      if (role === 'engineering') {
        return NextResponse.redirect(new URL('/engineering', req.url))
      } else if (role === 'admin') {
        return NextResponse.redirect(new URL('/admin', req.url))
      }
      // default to dashboard for general_dept and unknown
      return NextResponse.redirect(new URL('/dashboard', req.url))
    }
    ```

    NOTE: The sign-in route matcher should only redirect AFTER authentication is complete (userId exists), not for unauthenticated users visiting the sign-in page.
  </action>
  <verify>
    1. Sign in as engineering user -> redirected to /engineering
    2. Sign in as general_dept user -> redirected to /dashboard
    3. Sign in as admin user -> redirected to /admin
  </verify>
  <done>
    After login, each user type is automatically redirected to their appropriate dashboard based on role:
    - Engineering users -> /engineering
    - General dept users -> /dashboard
    - Admin users -> /admin
  </done>
</task>

</tasks>

<verification>
1. Test login flow for each role type:
   - Create/use test account with engineering role -> login -> lands on /engineering
   - Create/use test account with general_dept role -> login -> lands on /dashboard
   - Create/use test account with admin role -> login -> lands on /admin

2. Verify no redirect loops:
   - User already on /dashboard should stay there (not redirected)
   - User already on /engineering should stay there
   - User already on /admin should stay there

3. Verify unauth flow still works:
   - Unauthenticated user visiting /dashboard is redirected to sign-in
   - After sign-in, user is redirected to appropriate dashboard
</verification>

<success_criteria>
- [ ] Engineering users land on /engineering after login
- [ ] General dept users land on /dashboard after login
- [ ] Admin users land on /admin after login
- [ ] No infinite redirect loops occur
- [ ] Existing auth protection continues to work
</success_criteria>

<output>
After completion, create `.planning/quick/012-role-based-redirect-after-login/012-SUMMARY.md`
</output>
