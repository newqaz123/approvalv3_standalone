# Coding Conventions

**Analysis Date:** 2026-03-06

## Naming Patterns

**Files:**
- **Components:** kebab-case for multi-word: `request-form.tsx`, `approver-modal.tsx`, `status-badge.tsx`
- **Server Actions:** kebab-case: `requests.ts`, `users.ts`, `approvals.ts`
- **Utilities:** kebab-case: `utils.ts`, `permission-checks.ts`, `modal-data-adapters.ts`
- **Pages:** Route-based naming in `app/` directory follows Next.js 13+ app router conventions
- **Test Files:** kebab-case with `.spec.ts` suffix: `modal-system.spec.ts`

**Functions:**
- **camelCase** for all functions: `createRequest()`, `getUserById()`, `canUserApproveAtLevel()`
- **Async functions** follow same pattern with `async` keyword: `async function getUsers()`
- **Event handlers:** prefix with `handle`: `handleSubmit()`, `handleTemplateChange()`, `handleFileSelect()`

**Variables:**
- **camelCase** for all variables: `userName`, `requestId`, `isLoading`
- **Constants:** SCREAMING_SNAKE_CASE for enums/config: `MAX_FILE_DESCRIPTION_LENGTH`, `TEST_USERS`
- **Boolean prefixes:** `is/has/can` for clarity: `canApprove`, `hasRejection`, `isAdmin`

**Types/Interfaces:**
- **PascalCase** for types and interfaces: `UserWithDepartment`, `CreateRequestInput`, `RequestFormValues`
- **Type unions:** lowercase with pipe separators: `'admin' | 'general_dept' | 'engineering'`
- **Enum-like types:** string literals in unions: `status: 'pending' | 'approved' | 'rejected'`

## Code Style

**Formatting:**
- **Tool:** ESLint with Next.js preset (`next/core-web-vitals`)
- **Config:** `.eslintrc.json` extends `next/core-web-vitals`
- **No Prettier config detected** - using ESLint's built-in formatting
- **No Biome** - not using Biome formatter

**Linting:**
- **Framework:** ESLint v9
- **Config:** Next.js preset with TypeScript rules
- **Run command:** `npm run lint`
- **Key rules:** TypeScript strict mode enabled, Next.js specific rules

**TypeScript Configuration:**
- **Target:** ES2017
- **Module resolution:** `bundler`
- **Strict mode:** Enabled
- **Path aliases:** `@/*` maps to `./src/*`

## Import Organization

**Order:**
1. React imports (if needed): `import { useState } from 'react'`
2. Third-party packages: `import { format } from 'date-fns'`
3. UI component imports: `import { Button } from '@/components/ui/button'`
4. Local component imports: `import { RequestForm } from '@/components/requests/request-form'`
5. Server actions: `import { createRequest } from '@/server-actions/requests'`
6. Utility functions: `import { cn } from '@/lib/utils'`
7. Types (if not in separate file): `import type { Metadata } from "next"`

**Path Aliases:**
- `@/*` - maps to `src/*` root
- Examples: `@/components/ui/button`, `@/lib/utils`, `@/server-actions/requests`

**Import Style:**
- Named imports preferred: `import { Button } from '@/components/ui/button'`
- Type imports use `import type`: `import type { User } from '@/types'`
- Server actions marked with `'use server'` directive at top of file

## Error Handling

**Patterns:**

**Server Actions:**
- Return standardized error objects:
  ```typescript
  return {
    success: false,
    error: 'Error message',
    errors?: { field: ['error1'] } // For validation errors
  }
  ```
- Throw errors for critical failures: `throw new Error('User not found')`
- Use Zod for input validation with descriptive error messages

**Client Components:**
- Try-catch blocks for async operations
- Error state in component state: `const [error, setError] = useState<string | null>(null)`
- Display error messages to users with appropriate styling
- Console logging for debugging (not user-facing)

**API Routes:**
- Return appropriate HTTP status codes
- JSON error responses: `{ error: 'message' }`
- Try-catch for database operations

**Validation:**
- **Zod schemas** for all user inputs
- Schema-first validation in server actions
- Return validation errors mapped to form fields
- Example from `requests.ts`:
  ```typescript
  const createRequestSchema = z.object({
    title: z.string().min(1, 'Title is required').max(200, 'Title too long'),
    description: z.string().min(1, 'Description is required')
  })
  ```

## Logging

**Framework:** Console (no external logging service detected)

**Patterns:**
- **Console.log** for debugging and development
- **Console.log** for important admin actions: `console.log('User created:', email)`
- **No structured logging** detected - using plain console statements
- Error logging includes context: user, action, timestamp

**When to Log:**
- User creation: `console.log('User created: ${email}')`
- Important state changes
- Error conditions (in addition to throwing)
- Debug information in development

**Comments in code:**
- Some TODO comments present (check for technical debt)
- JSDoc comments for complex functions in server actions
- Inline comments for business logic explanation

## Comments

**When to Comment:**
- **Above functions** describing purpose and parameters
- **Complex business logic** explanation
- **Permission check rationale**
- **Audit logging explanations**

**JSDoc/TSDoc:**
- **Used sparingly** in server actions
- **Function-level documentation** for public APIs:
  ```typescript
  /**
   * Get all users with their department information
   */
  export async function getUsers() { ... }
  ```
- **Parameter documentation** in complex functions
- **Return type documentation** for interfaces

**Inline Comments:**
- Used to explain **why** something is done, not **what**
- **Section separators** in long functions
- **Business logic explanations** (e.g., approval hierarchy logic)
- **Audit trail explanations**

## Function Design

**Size:**
- **No strict size limit** enforced
- **Server actions:** Typically 50-200 lines
- **Components:** Can be large (e.g., `approver-modal.tsx` ~800 lines)
- **Utility functions:** Small and focused (5-20 lines)
- **Complex components** split into sub-components when possible

**Parameters:**
- **Object parameters** for multiple related values: `input: CreateRequestInput`
- **Destructuring** in component props: `({ mode, open, data, onApprove }: Props)`
- **Optional parameters** marked with `?`: `onApprove?: (comment: string) => void`
- **Default values** in component props: `canApprove = false`

**Return Values:**
- **Server actions:** Standardized response objects:
  ```typescript
  return {
    success: boolean,
    data?: T,
    error?: string,
    errors?: Record<string, string[]>
  }
  ```
- **Utility functions:** Direct return values or primitives
- **Components:** JSX (React elements)
- **Type guards:** Boolean returns: `canUserApproveAtLevel(): boolean`

## Module Design

**Exports:**
- **Named exports** preferred for functions: `export async function createRequest()`
- **Default exports** for pages and main components: `export default function Page()`
- **Type exports** for interfaces: `export type { UserRole }`
- **Constant exports** for configs: `export { TEST_USERS }`

**Barrel Files:**
- **UI components** not using barrel files - direct imports from component directories
- **Server actions** imported directly from action files
- **Utility functions** imported directly from `lib/` files
- **No detected barrel index files** (e.g., `components/index.ts`)

**File Organization:**
- **Co-located** files with their usage (components in feature folders)
- **Shared components** in `components/ui/` for reusable UI primitives
- **Feature components** in `components/{feature}/` (e.g., `components/requests/`)
- **Server actions** in `server-actions/` directory
- **Utilities** in `lib/` directory

**Directives:**
- **'use client'** at top of client components (using hooks, event handlers)
- **'use server'** at top of server action files
- Directives placed **before imports**

---

*Convention analysis: 2026-03-06*
