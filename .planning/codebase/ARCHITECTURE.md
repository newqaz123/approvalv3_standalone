# Architecture

**Analysis Date:** 2026-03-06

## Pattern Overview

**Overall:** Next.js 15 App Router with Server Actions and Client Components

**Key Characteristics:**
- Hybrid Server/Client architecture using Next.js App Router
- Server Actions for mutations and data fetching
- Client Components for interactivity with React hooks
- Prisma ORM for database access
- Role-based access control (RBAC) with NextAuth.js v5
- Modal-based UI patterns for complex workflows

## Layers

**Presentation Layer (Client Components):**
- Purpose: Interactive UI components with user interactions
- Location: `src/components/`
- Contains: Modal components, forms, tables, charts, navigation
- Depends on: Server Actions for mutations, API routes for queries
- Used by: App Router pages and layouts

**Server Actions Layer:**
- Purpose: Server-side mutations and data operations
- Location: `src/server-actions/`
- Contains: CRUD operations for requests, solutions, approvals, users, departments, hierarchy, notifications, analytics
- Depends on: Prisma client, auth utilities
- Used by: Client components via direct imports

**API Routes Layer:**
- Purpose: RESTful endpoints for client-side data fetching
- Location: `src/app/api/`
- Contains: User lookups, department info, file operations, auth callbacks, cron jobs
- Depends on: Prisma client, auth configuration
- Used by: Client components via fetch()

**Data Access Layer:**
- Purpose: Database abstraction and caching
- Location: `src/lib/prisma.ts`, `src/lib/cache/`
- Contains: Prisma client singleton, user cache wrapper
- Depends on: Prisma Client
- Used by: Server Actions and API routes

**Authentication & Authorization Layer:**
- Purpose: Session management and route protection
- Location: `src/lib/auth-config.ts`, `src/middleware.ts`
- Contains: NextAuth configuration, middleware route guards, permission checks
- Depends on: NextAuth.js, Prisma
- Used by: Middleware, layouts, server components

**Business Logic Layer:**
- Purpose: Domain-specific transformations and validations
- Location: `src/lib/modal-data-adapters.ts`, `src/lib/permission-checks.ts`, `src/lib/schemas/`
- Contains: Data transformers, permission utilities, Zod validation schemas
- Depends on: Domain types, date-fns
- Used by: Server Actions and components

## Data Flow

**Request Creation Flow:**

1. User submits form in `src/components/requests/request-form.tsx`
2. Form data validated with Zod schema
3. `createRequest()` server action called
4. Prisma transaction creates request + activity log
5. Approval chain generated based on user's department level
6. Notifications created for first-level approvers
7. `revalidatePath()` called to refresh dashboard cache
8. Client redirects or updates UI via `onActionComplete` callback

**Approval Flow:**

1. Approver opens request via `RequestModalRouter` component
2. Modal fetches request data + checks permissions via `canUserApprove()`
3. Approval action calls `approveRequest()` server action
4. Server action updates approval status, creates activity log
5. If all levels approved, request status transitions to next stage
6. Notifications sent to next-level approvers or requesters
7. `revalidatePath()` refreshes affected pages
8. Modal closes or updates to show new state

**Modal Router Pattern:**

1. User clicks request → `RequestModalRouter` opens with `requestId`
2. Router fetches request data, user permissions, department info
3. `getModalTypeForStatus()` determines which modal variant to render
4. Appropriate modal component renders (SubmitterModal, ApproverModal, SolutionModal, etc.)
5. User actions trigger server actions with callbacks
6. Modal refreshes data or closes on completion

**State Management:**

- Server state: Managed by Next.js server components and revalidation
- Client state: React useState/useEffect in components with fetch() calls
- Session state: NextAuth.js session provider with useSession() hook
- No global state management library (Redux/Zustand) - component-level state only

## Key Abstractions

**Request Approval Chain:**
- Purpose: Hierarchical approval workflow based on user levels
- Examples: `src/server-actions/approvals.ts`, `src/server-actions/hierarchy.ts`
- Pattern: Dynamic chain creation filtered by department approvers at each level

**Modal Variant System:**
- Purpose: Display different UI based on request status and user role
- Examples: `src/components/requests/request-modal-router.tsx`, `src/lib/permission-checks.ts`
- Pattern: Single router component that conditionally renders status-specific modal components

**Data Adapters:**
- Purpose: Transform Prisma models to UI-friendly shapes
- Examples: `src/lib/modal-data-adapters.ts`
- Pattern: Pure functions that map DB schemas to modal prop interfaces

**Activity Logging:**
- Purpose: Append-only audit trail for all state changes
- Examples: All server actions in `src/server-actions/`
- Pattern: Prisma transactions that write primary entity + activity log atomically

## Entry Points

**Root Layout:**
- Location: `src/app/layout.tsx`
- Triggers: All pages
- Responsibilities: SessionProvider wrapper, global CSS, Toaster notifications

**Homepage:**
- Location: `src/app/page.tsx`
- Triggers: Root URL `/`
- Responsibilities: Landing page, redirects authenticated users to role-based dashboard

**Middleware:**
- Location: `src/middleware.ts`
- Triggers: All route requests
- Responsibilities: Route protection, role-based redirects, auth check

**Dashboard Layout:**
- Location: `src/app/(dashboard)/layout.tsx`
- Triggers: All dashboard routes
- Responsibilities: Authentication check, Navbar/MobileNav rendering

**Admin Layout:**
- Location: `src/app/(admin)/layout.tsx`
- Triggers: All admin routes
- Responsibilities: Admin role verification, enhanced layout

## Error Handling

**Strategy:** Try-catch in server actions with error response objects

**Patterns:**
- Server actions return `{ success: boolean, error?: string, data?: any }`
- Zod validation returns `{ success: boolean, errors?: fieldErrors }`
- Components check `result.success` and display errors via toast notifications
- API routes return appropriate HTTP status codes (401, 500, etc.)

**Example from `src/server-actions/requests.ts`:**
```typescript
try {
  const request = await prisma.requests.create({...})
  return { success: true, data: request }
} catch (error) {
  console.error('Failed to create request:', error)
  return { success: false, error: 'Failed to create request' }
}
```

## Cross-Cutting Concerns

**Logging:** Console.error in server actions, structured activity logs in database

**Validation:** Zod schemas in `src/lib/schemas/` for input validation

**Authentication:** NextAuth.js v5 with Credentials provider, session-based auth

**Authorization:** Role-based checks in middleware + permission-checks utilities for UI

**File Storage:** Local filesystem in `public/uploads/` with metadata in database

**Notifications:** Database-driven notification system with in-app bell indicator

**Caching:** React cache() for user lookups, Next.js revalidatePath for cache invalidation

---

*Architecture analysis: 2026-03-06*
