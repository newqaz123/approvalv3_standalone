# Phase 01: Foundation & Authentication - Research

**Researched:** 2026-01-30
**Domain:** Authentication, Role-Based Access Control, User & Department Management
**Confidence:** HIGH

## Summary

This phase establishes the security foundation for the Approval Flow System, implementing user authentication with email/password, role-based access control (RBAC) with three roles (Admin, General Department User, Engineering User), and admin capabilities for user/department management. The system must support ~30 internal users with persistent sessions, administrative user CRUD operations, and department management before any workflow features can be built.

**Primary recommendations:**
1. Use Clerk for authentication and user management (includes email/password, password reset, session management out of the box)
2. Implement RBAC using Clerk's `publicMetadata` to store role assignments
3. Use Prisma with PostgreSQL for user/department data models with role enums
4. Build admin UI using shadcn/ui components (DataTable, Forms, Dialogs)
5. Protect admin routes using Clerk middleware with role checks

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| **Clerk** | Latest | Authentication and user management | Modern auth solution with pre-built UI components; supports RBAC out of box; excellent Next.js App Router integration; faster to implement than Auth0 for 2025; handles user management, sessions, and permissions |
| **Next.js** | 16.1+ | Frontend framework | Industry standard for React apps in 2025; Server Components reduce client JS; built-in API routes eliminate need for separate backend server; excellent DX with TypeScript |
| **React** | 19.2+ | UI library | Most popular React ecosystem with massive community support; concurrent features improve app responsiveness; Server Components enable better performance patterns |
| **Prisma** | 6.19+ | ORM | Type-safe database access with auto-generated TypeScript types; excellent migration system; intuitive relation queries simplify complex workflow data; strong 2025 ecosystem support |
| **PostgreSQL** | 16+ | Primary database | Best-in-class relational database with JSONB support; perfect for complex workflow state and relationships; ACID compliance ensures data integrity for audit trails |
| **shadcn/ui** | 3.5+ | UI component library | Use for ALL UI components (buttons, forms, modals, cards); not a dependency but copy-paste components with full customization; built on Radix UI for accessibility; Tailwind-based for consistent styling |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| **React Hook Form** | 7.66+ | Form management | Use for ALL forms (user creation, department editing, password resets); performant with minimal re-renders; works with Zod for validation; superior to Formik for performance |
| **Zod** | 4.0+ | Schema validation | Use for ALL input validation (forms, API payloads); TypeScript-first with auto-inferred types; integrates seamlessly with React Hook Form; validates on both client and server with same schema |
| **TanStack Table** | Latest | Data table component | CRITICAL for admin user lists and department management; headless architecture gives full control over rendering; handles sorting, filtering, pagination out of box |
| **@hookform/resolvers** | Latest | Form validation integration | Bridges React Hook Form and Zod for type-safe form validation |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Clerk | Auth0 | If you need enterprise SSO with complex SAML requirements; Clerk is faster to implement and has better Next.js App Router integration for 2025 |
| Clerk | Custom auth with Next.js | If you need complete control over authentication flow; Clerk eliminates weeks of building and maintaining password reset, session management, email verification, and security features |
| PostgreSQL | MongoDB | ONLY if your workflow data is extremely unstructured and schema-less; MongoDB is inferior for complex relational queries required by approval hierarchies |
| Prisma | Drizzle ORM | If you need SQL-like control and maximum performance; Drizzle is more performant but Prisma has better DX and type safety; Drizzle requires more manual work |
| shadcn/ui | Chakra UI | If you need a more opinionated, component-focused library out of box; shadcn/ui preferred for customization and avoiding dependency bloat |

**Installation:**

```bash
# Authentication
npm install @clerk/nextjs

# Database
npm install prisma@latest @prisma/client
npx prisma init

# Forms and validation
npm install react-hook-form@latest
npm install @hookform/resolvers
npm install zod@latest

# UI components
npx shadcn@latest init

# Data tables
npm install @tanstack/react-table
```

## Architecture Patterns

### Recommended Project Structure

```
src/
├── app/
│   ├── (auth)/               # Authentication routes (public)
│   │   ├── sign-in/
│   │   ├── sign-up/
│   │   └── forgot-password/
│   ├── (dashboard)/          # Protected application routes
│   │   └── dashboard/
│   ├── (admin)/              # Admin-only routes
│   │   └── admin/
│   │       ├── users/
│   │       ├── departments/
│   │       └── layout.tsx
│   └── api/                  # API routes for Server Actions
├── components/
│   ├── admin/                # Admin-specific components
│   │   ├── user-table.tsx
│   │   ├── department-form.tsx
│   │   └── bulk-import-dialog.tsx
│   └── ui/                   # shadcn/ui components
├── lib/
│   ├── prisma.ts             # Prisma client singleton
│   ├── clerk.ts              # Clerk utilities
│   └── utils.ts              # Helper functions
├── middleware.ts             # Clerk middleware for route protection
└── server-actions/           # Server Actions for mutations
    ├── users.ts              # User CRUD operations
    └── departments.ts        # Department CRUD operations
```

### Pattern 1: Clerk Authentication with RBAC

**What:** Use Clerk to handle all authentication (sign-up, sign-in, password reset, sessions) and implement role-based access control using Clerk's `publicMetadata` feature to store user roles.

**When to use:** All user authentication and authorization for this application.

**Example:**

```typescript
// middleware.ts - Route protection with RBAC
import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'

const isAdminRoute = createRouteMatcher(['/admin(.*)'])
const isProtectedRoute = createRouteMatcher(['/dashboard(.*)'])

export default clerkMiddleware(async (auth, req) => {
  const { sessionClaims, redirectToSignIn } = await auth()

  // Protect admin routes - only users with 'admin' role can access
  if (isAdminRoute(req)) {
    if (sessionClaims?.metadata?.role !== 'admin') {
      return NextResponse.redirect(new URL('/dashboard', req.url))
    }
  }

  // Protect dashboard routes - must be authenticated
  if (isProtectedRoute(req)) {
    const { isAuthenticated } = await auth()
    if (!isAuthenticated) {
      return redirectToSignIn()
    }
  }
})

export const config = {
  matcher: [
    // Skip Next.js internals and all static files
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
}
```

**Source:** [Clerk RBAC Guide](https://clerk.com/docs/guides/secure/basic-rbac) (HIGH confidence - official Clerk documentation, updated January 2026)

### Pattern 2: User Role Assignment with Clerk Metadata

**What:** Store user roles (Admin, General Department User, Engineering User) in Clerk's `publicMetadata` field. This allows role checks to happen synchronously from the JWT token without database queries.

**When to use:** All role-based access control checks throughout the application.

**Example:**

```typescript
// Server Action for creating user with role assignment
'use server'

import { auth } from '@clerk/nextjs/server'
import { clerkClient } from '@clerk/nextjs/server'

export async function createUserWithRole(data: {
  email: string
  name: string
  role: 'admin' | 'general_dept' | 'engineering'
  department: string
}) {
  const { userId } = await auth()

  // Verify the creator is an admin
  const currentUser = await clerkClient.users.getUser(userId!!)
  if (currentUser.publicMetadata.role !== 'admin') {
    throw new Error('Unauthorized: Only admins can create users')
  }

  // Create user in Clerk with role in metadata
  const user = await clerkClient.users.createUser({
    emailAddress: [data.email],
    firstName: data.name.split(' ')[0],
    lastName: data.name.split(' ').slice(1).join(' '),
    publicMetadata: {
      role: data.role,
      department: data.department,
    },
  })

  // Send invitation email
  await clerkClient.users.verifyUserEmail(user.id)

  return user
}
```

**Source:** [Clerk User Metadata Guide](https://clerk.com/docs/guides/users/extending) (HIGH confidence - official Clerk documentation)

### Pattern 3: Prisma Schema for Users and Departments

**What:** Use Prisma with PostgreSQL to store user profile data, departments, and relationships. Clerk handles authentication while Prisma stores application-specific data.

**When to use:** All database models for user profiles, departments, and user-department relationships.

**Example:**

```prisma
// prisma/schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// User profile data (Clerk handles auth)
model User {
  id           String   @id // Clerk user ID
  email        String   @unique
  name         String
  departmentId String?
  department   Department? @relation(fields: [departmentId], references: [id])
  level        Int?     // User level/rank for approval hierarchy
  isActive     Boolean  @default(true)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  @@index([departmentId])
  @@index([isActive])
}

// Departments (12 total: 11 general + 1 engineering)
model Department {
  id          String   @id
  name        String   @unique
  type        DepartmentType
  users       User[]
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

enum DepartmentType {
  GENERAL      // General departments (QC, OSEC, PD1, PD2, PD3, WWT, Utility, BM, TTEC, ADMIN, Maintenance)
  ENGINEERING  // Engineering department
}
```

**Source:** [Prisma Models Documentation](https://www.prisma.io/docs/orm/prisma-schema/data-model/models) (HIGH confidence - official Prisma documentation)

### Pattern 4: Admin User Management with shadcn/ui DataTable

**What:** Use shadcn/ui's DataTable component (built on TanStack Table) to display and manage users with sorting, filtering, pagination, and column visibility toggles.

**When to use:** Admin user list view and department management views.

**Example:**

```typescript
// components/admin/user-table.tsx
"use client"

import { ColumnDef } from "@tanstack/react-table"
import { DataTable } from "@/components/ui/data-table"
import { Button } from "@/components/ui/button"

interface User {
  id: string
  name: string
  email: string
  department: string | null
  role: string
  isActive: boolean
}

const columns: ColumnDef<User>[] = [
  { accessorKey: "name", header: "Name" },
  { accessorKey: "email", header: "Email" },
  { accessorKey: "department", header: "Department" },
  { accessorKey: "role", header: "Role" },
  { accessorKey: "isActive", header: "Status" },
  {
    id: "actions",
    cell: ({ row }) => (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost">Actions</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onClick={() => onEdit(row.original)}>
            Edit
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onDeactivate(row.original)}>
            Deactivate
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    ),
  },
]

export function UserTable({ data }: { data: User[] }) {
  return <DataTable columns={columns} data={data} />
}
```

**Source:** [shadcn/ui DataTable Documentation](https://ui.shadcn.com/docs/components/data-table) (HIGH confidence - official shadcn/ui documentation)

### Pattern 5: Form Validation with Zod and React Hook Form

**What:** Use React Hook Form for form state management combined with Zod for schema validation to create type-safe, validated forms with real-time error messages.

**When to use:** All forms throughout the application (user creation, department editing, etc.).

**Example:**

```typescript
// components/admin/user-form.tsx
"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import * as z from "zod"
import { Form, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

const userFormSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Invalid email address"),
  department: z.string().min(1, "Department is required"),
  role: z.enum(["admin", "general_dept", "engineering"]),
})

type UserFormValues = z.infer<typeof userFormSchema>

export function UserForm() {
  const form = useForm<UserFormValues>({
    resolver: zodResolver(userFormSchema),
    defaultValues: {
      name: "",
      email: "",
      department: "",
      role: "general_dept",
    },
  })

  async function onSubmit(data: UserFormValues) {
    // Server Action to create user
    await createUserWithRole(data)
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Name</FormLabel>
              <Input {...field} />
              <FormMessage />
            </FormItem>
          )}
        />
        {/* Additional form fields */}
        <Button type="submit">Create User</Button>
      </form>
    </Form>
  )
}
```

**Source:** [shadcn/ui Form Documentation](https://ui.shadcn.com/docs/components/form) (HIGH confidence - official shadcn/ui documentation)

### Anti-Patterns to Avoid

- **Custom password reset implementation:** Building your own password reset flow is reinventing the wheel and security risk. Use Clerk's built-in password reset functionality which handles email sending, code verification, and secure password updates.
- **Storing passwords in database:** Never store passwords - Clerk handles password hashing and security. Store only the Clerk user ID reference.
- **Hard-coding role checks inline:** Avoid scattering `if (user.role === 'admin')` throughout components. Create reusable permission check functions and Clerk middleware for centralized access control.
- **Client-side only authorization:** Never rely solely on client-side checks for authorization. All Server Actions must verify user roles on the backend using Clerk's `auth()` function.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Password reset flow | Custom email sending, code verification, password update endpoints | Clerk's built-in password reset | Email deliverability, secure code generation, rate limiting, edge cases like expired tokens are all handled by Clerk |
| Session management | Custom JWT creation, cookie handling, session storage, refresh token rotation | Clerk sessions | Persistent sessions across browser refreshes, multiple concurrent sessions, secure token management all built-in |
| Form validation | Custom validation logic, error message handling | Zod + React Hook Form | Type-safe validation, real-time error feedback, consistent error handling across all forms |
| Data tables | Custom table rendering, sorting, filtering logic | TanStack Table + shadcn/ui DataTable | Handles sorting, filtering, pagination, column visibility out of box with excellent performance |
| Role-based access control | Custom role checking logic, permission systems | Clerk publicMetadata + middleware | Role data available synchronously from JWT, no database queries needed for permission checks |

**Key insight:** Authentication and user management are "solved problems" with mature solutions. Building custom implementations increases security risk, development time, and maintenance burden without providing unique value to users. Clerk's free tier handles up to 5,000 monthly active users - more than sufficient for ~30 internal users.

## Common Pitfalls

### Pitfall 1: Clerk Metadata Not Syncing with Database

**What goes wrong:**
User role stored in Clerk's `publicMetadata` but corresponding Prisma User record doesn't exist or has stale data. This causes inconsistencies where authentication succeeds but application queries fail.

**Why it happens:**
Creating Clerk user without creating corresponding Prisma User record, or updating Clerk metadata without updating Prisma records. Lack of transactional consistency between Clerk (external service) and local database.

**How to avoid:**
- Always create Prisma User record in the same Server Action that creates Clerk user
- Use Clerk webhooks to sync user data when changes happen outside your app (e.g., via Clerk Dashboard)
- Add validation checks that ensure Prisma user exists before allowing actions
- Consider using Clerk's `db` attribute to store reference ID linking both systems

**Warning signs:**
- "User not found" errors in database queries after successful authentication
- Admin panel shows different user data than Clerk Dashboard
- User can log in but gets errors when accessing features

### Pitfall 2: Admin Route Protection Bypassed via API Routes

**What goes wrong:**
Middleware protects UI routes but Server Actions or API routes forget to verify user roles. Users can't access `/admin/users` page but can call Server Actions directly via browser DevTools.

**Why it happens:**
Developers focus on protecting routes with middleware and forget that Server Actions are independently callable endpoints. React Server Actions seem "part of the page" but are actually separate HTTP endpoints.

**How to avoid:**
- Always call `await auth()` at the start of every Server Action
- Verify user role (admin check) before performing any admin operations
- Never rely solely on client-side checks or middleware for Server Actions
- Use TypeScript helper functions to encapsulate common auth checks

**Example:**

```typescript
// lib/auth.ts - Reusable auth checks
import { auth } from '@clerk/nextjs/server'
import { unauthorized } from 'next/navigation'

export async function requireAdmin() {
  const { sessionClaims, userId } = await auth()

  if (!userId || sessionClaims?.metadata?.role !== 'admin') {
    unauthorized()
  }

  return userId
}

// server-actions/users.ts - Use in Server Actions
'use server'

import { requireAdmin } from '@/lib/auth'

export async function deleteUser(userId: string) {
  const adminUserId = await requireAdmin() // Will throw 401 if not admin

  // Perform deletion...
}
```

**Warning signs:**
- Users report being able to perform actions they shouldn't
- Browser DevTools Network tab shows API calls succeeding without proper authentication
- Security audit reveals unprotected endpoints

### Pitfall 3: Inconsistent User Status (Active vs Inactive)

**What goes wrong:**
User marked as inactive in Prisma (`isActive: false`) but Clerk account still active. User can still authenticate but gets errors or sees inconsistent UI. Or user deleted from Clerk but Prisma record still exists.

**Why it happens:**
Deactivation flow only updates one system (Prisma or Clerk) but not both. Lack of synchronization when user status changes via different admin interfaces (Clerk Dashboard vs app admin panel).

**How to avoid:**
- Always update both Clerk and Prisma when changing user status
- For deactivation: Set Clerk user metadata `isActive: false` AND update Prisma `isActive` field
- Use Clerk webhooks to listen for user changes and sync to Prisma
- Add periodic sync job to catch inconsistencies
- Handle "inactive user" case at application level (show appropriate message)

**Example:**

```typescript
// server-actions/users.ts - Deactivate user in both systems
'use server'

import { clerkClient } from '@clerk/nextjs/server'
import { prisma } from '@/lib/prisma'

export async function deactivateUser(userId: string) {
  // Update Clerk
  await clerkClient.users.updateUser(userId, {
    publicMetadata: { isActive: false }
  })

  // Update Prisma
  await prisma.user.update({
    where: { id: userId },
    data: { isActive: false }
  })
}
```

**Warning signs:**
- Users report being able to log in despite being "deactivated"
- Inconsistent user counts between Clerk Dashboard and admin panel
- Application throws errors for authenticated users

### Pitfall 4: Bulk Import CSV Validation Errors Not User-Friendly

**What goes wrong:**
CSV bulk import shows generic "Import failed" error with no details about which rows failed and why. Admin can't fix 100-row CSV without trial and error.

**Why it happens:**
Validation happens in a loop but errors are aggregated poorly or generic error messages shown. Focus on "does it import" rather than "how easy is it to fix issues".

**How to avoid:**
- Validate entire CSV before importing any users
- Return detailed error report with row numbers and specific validation errors
- Use real-time validation in admin UI (show errors as user types)
- Support partial imports (import valid rows, report invalid ones)
- Provide CSV template with example data

**Example error format:**

```typescript
{
  success: false,
  errors: [
    { row: 3, field: "email", message: "Invalid email format" },
    { row: 7, field: "department", message: "Department 'XYZ' does not exist" },
    { row: 12, field: "email", message: "Email already exists" }
  ],
  validRows: 15,
  invalidRows: 3
}
```

**Warning signs:**
- Admins abandon bulk import after multiple failed attempts
- Support requests asking "why did my import fail?"
- Users entering data one-by-one despite bulk import feature existing

### Pitfall 5: Missing Real-Time Validation in Admin Forms

**What goes wrong:**
User submits form, waits for server response, gets "Email already exists" error. No feedback while typing. Frustrating for admin creating many users.

**Why it happens:**
Client-side validation only checks format, not uniqueness. Server-side validation only happens on submit. No debounced API calls to check uniqueness as user types.

**How to avoid:**
- Implement debounced uniqueness checks for email (and other unique fields)
- Show inline errors as user types (React Hook Form + Zod handles this)
- Use loading states to show validation is in progress
- Cache validation results to avoid redundant checks
- Clear errors when user fixes the issue

**Example:**

```typescript
// components/admin/user-form.tsx
const [emailAvailable, setEmailAvailable] = useState<boolean | null>(null)
const [checkingEmail, setCheckingEmail] = useState(false)

const checkEmailAvailability = debounce(async (email: string) => {
  if (!email || !z.string().email().safeParse(email).success) {
    setEmailAvailable(null)
    return
  }

  setCheckingEmail(true)
  try {
    const result = await checkEmailExists(email)
    setEmailAvailable(!result.exists)
  } catch {
    setEmailAvailable(null)
  }
  setCheckingEmail(false)
}, 500)

// In form field onChange
<Input
  {...field}
  onChange={(e) => {
    field.onChange(e)
    checkEmailAvailability(e.target.value)
  }}
/>

{checkingEmail && <p className="text-sm text-gray-500">Checking availability...</p>}
{emailAvailable === false && <p className="text-sm text-red-500">Email already exists</p>}
```

**Warning signs:**
- Users report "forms feel slow to respond"
- High rate of form submissions that fail validation
- Admin feedback includes "forms frustrating to use"

## Code Examples

Verified patterns from official sources:

### Clerk Setup with Next.js App Router

```typescript
// app/(auth)/sign-in/[[...sign-in]]/page.tsx
import { SignIn } from '@clerk/nextjs'

export default function Page() {
  return <SignIn />
}
```

**Source:** [Clerk Next.js Documentation](https://clerk.com/docs/references/nextjs) (HIGH confidence - official Clerk documentation)

### Server Action with Role Check

```typescript
// server-actions/users.ts
'use server'

import { auth } from '@clerk/nextjs/server'
import { unauthorized } from 'next/navigation'

export async function deleteUser(targetUserId: string) {
  // Get current user and verify role
  const { userId, sessionClaims } = await auth()

  if (!userId) {
    unauthorized()
  }

  if (sessionClaims?.metadata?.role !== 'admin') {
    unauthorized()
  }

  // Perform deletion...
}
```

**Source:** [Next.js Server Actions Documentation](https://nextjs.org/docs/app/building-your-application/data-fetching/server-actions-and-mutations) (HIGH confidence - official Next.js documentation v16.1.5)

### Prisma Query with Relations

```typescript
// Get users with their departments
const usersWithDepartments = await prisma.user.findMany({
  include: {
    department: true,
  },
  where: {
    isActive: true,
  },
  orderBy: {
    name: 'asc',
  },
})
```

**Source:** [Prisma Query Documentation](https://www.prisma.io/docs/orm/prisma-client/queries) (HIGH confidence - official Prisma documentation)

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Auth0 or custom auth | Clerk (Next.js-first) | 2025 | Faster implementation, better Next.js App Router integration, pre-built UI components |
| Class components + Redux | Functional components + hooks + Zustand | 2019-2020 | Simpler state management, better performance with React concurrency |
| Custom form handling | React Hook Form + Zod | 2021-2022 | Type-safe forms, better performance, real-time validation |
| Hard-coded role checks | Clerk metadata RBAC | 2024-2025 | Role data in JWT, no DB queries for permission checks, middleware-based protection |

**Deprecated/outdated:**
- **Passport.js authentication strategy:** Replaced by modern auth providers like Clerk that handle the full auth flow
- **Next.js Pages Router:** App Router (introduced 2023, stable 2024) is the current standard with Server Components and improved data fetching
- **Class-based React components:** Functional components with hooks have been standard since React 16.8 (2019)
- **Formik form library:** React Hook Form surpassed it in performance and popularity after 2021

## Open Questions

1. **Clerk webhooks setup for Prisma sync**
   - What we know: Clerk provides webhooks for user events (created, updated, deleted)
   - What's unclear: Exact webhook endpoint implementation, signature verification, error handling
   - Recommendation: Start without webhooks (sync on create/update in app), add webhooks in Phase 2 if needed for Clerk Dashboard changes

2. **Bulk import CSV file format**
   - What we know: Need to support CSV (and possibly Excel) bulk user import
   - What's unclear: Exact column format, required vs optional fields, how to handle password generation
   - Recommendation: Use standard CSV library (papaparse) and define simple format: `name, email, department, role`. Generate random passwords and email invitation links.

3. **Department-level role assignments**
   - What we know: Three roles (Admin, General Dept User, Engineering User)
   - What's unclear: Can a user be in multiple departments? How to handle "General Department User" - is it one role per department or users belong to specific departments?
   - Recommendation: From CONTEXT.md decisions, users belong to one department. Role is per-user, not per-department. Clarify in planning if "General Department User" means "any user in general department" or specific role type.

## Sources

### Primary (HIGH confidence)

- **/clerk/clerk-docs** - Clerk authentication, RBAC with publicMetadata, user management, password reset flows, bulk invitations, organization management
- **/vercel/next.js/v16.1.5** - Next.js App Router, middleware for route protection, Server Actions with auth checks
- **/prisma/docs** - Prisma schema design, user/department models, enums, relations, queries
- **/shadcn-ui/ui** - DataTable component with TanStack Table, Form components with React Hook Form and Zod, Dialog components

### Secondary (MEDIUM confidence)

- [Implement basic Role Based Access Control (RBAC) with Clerk](https://clerk.com/docs/guides/secure/basic-rbac) - Official Clerk RBAC guide (updated January 2026)
- [Authorization checks - Verifying user permissions with Clerk](https://clerk.com/docs/guides/secure/authorization-checks) - Clerk authorization patterns (updated January 2026)
- [Custom metadata for B2B authentication flows](https://clerk.com/docs/guides/organizations/metadata) - Using metadata for user properties (updated January 2026)
- [User metadata - User management](https://clerk.com/docs/guides/users/extending) - Extending user objects with custom data
- [How to Import CSV Files in Next.js](https://blog.csvbox.io/how-to-import-csv-files-in-a-next-js-app/) - CSV import patterns for Next.js (2025)
- [CSV Importer - Free React/Next.js Template](https://shadcn.io/template/sadmann7-csv-importer) - Pre-built CSV import component template
- [Building UX for Error Validation Strategy](https://medium.com/@olamishina/building-ux-for-error-validation-strategy-36142991017a) - Admin panel validation UX best practices
- [How to Create a Good Admin Panel: Design Tips & Best Practices](https://aspirity.com/blog/good-admin-panel-design) - Admin panel design guidelines

### Tertiary (LOW confidence)

- [15+ Free Next.js Admin Dashboard Templates for 2026](https://tailadmin.com/blog/free-nextjs-admin-dashboard) - Admin template references (use for design inspiration, not implementation)
- [21+ Best Next.js Admin Dashboard Templates - 2026](https://nextjstemplates.com/blog/admin-dashboard-templates) - More admin template options

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All sources are official documentation (Clerk, Next.js, Prisma, shadcn/ui) updated 2025-2026
- Architecture: HIGH - Patterns verified against official docs and current best practices
- Pitfalls: MEDIUM - Pitfalls based on common issues documented in web search results and general admin panel best practices; some pitfalls specific to this app's Clerk+Prisma architecture are theoretical and should be validated during implementation

**Research date:** 2026-01-30
**Valid until:** 2026-02-27 (30 days - authentication patterns are stable but Clerk releases updates frequently)
