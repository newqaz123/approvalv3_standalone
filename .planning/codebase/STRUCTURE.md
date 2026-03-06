# Codebase Structure

**Analysis Date:** 2026-03-06

## Directory Layout

```
ApprovalAppV3_Standalone/
├── src/
│   ├── app/                    # Next.js App Router pages and API routes
│   │   ├── (auth)/             # Authentication route group
│   │   ├── (dashboard)/        # Dashboard route group
│   │   ├── (admin)/            # Admin route group
│   │   ├── admin/              # Admin pages
│   │   ├── api/                # API routes
│   │   ├── layout.tsx          # Root layout
│   │   └── page.tsx            # Homepage
│   ├── components/             # React components
│   │   ├── ui/                 # Base UI components (shadcn/ui)
│   │   ├── admin/              # Admin-specific components
│   │   ├── analytics/          # Analytics charts and filters
│   │   ├── approvals/          # Approval action components
│   │   ├── dashboard/          # Dashboard tables and tabs
│   │   ├── engineering/        # Engineering workflow components
│   │   ├── mobile/             # Mobile-specific components
│   │   ├── navigation/         # Navbar components
│   │   ├── notifications/      # Notification components
│   │   ├── reports/            # Report export components
│   │   ├── requests/           # Request modals and tables
│   │   └── solutions/          # Solution components
│   ├── hooks/                  # Custom React hooks
│   ├── lib/                    # Utility libraries
│   │   ├── cache/              # Cache utilities
│   │   └── schemas/            # Zod validation schemas
│   ├── server-actions/         # Server action functions
│   ├── types/                  # TypeScript type definitions
│   ├── middleware.ts           # NextAuth middleware
│   └── auth.ts                 # Auth export
├── prisma/                     # Prisma ORM
│   ├── schema.prisma           # Database schema
│   ├── migrations/             # Database migrations
│   └── seed.ts                 # Database seed script
├── public/                     # Static assets
│   └── uploads/                # User-uploaded files
├── tests/                      # Test files
│   ├── e2e/                    # Playwright E2E tests
│   └── integration/            # Integration tests
├── docs/                       # Documentation
├── scripts/                    # Utility scripts
├── .planning/                  # Planning documents
├── package.json                # Dependencies
├── tsconfig.json               # TypeScript config
├── next.config.ts              # Next.js config
├── tailwind.config.ts          # Tailwind CSS config
├── playwright.config.ts        # Playwright test config
└── docker-compose.yml          # Docker configuration
```

## Directory Purposes

**src/app/:**
- Purpose: Next.js App Router pages and API routes
- Contains: Page components, layouts, API route handlers
- Key files: `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/(dashboard)/layout.tsx`

**src/components/:**
- Purpose: Reusable React components organized by feature
- Contains: UI primitives, feature components, modals, tables
- Key files: `src/components/ui/` (shadcn/ui base), `src/components/requests/request-modal-router.tsx`

**src/server-actions/:**
- Purpose: Server-side mutations and data operations
- Contains: CRUD functions for all domain entities
- Key files: `src/server-actions/requests.ts`, `src/server-actions/solutions.ts`, `src/server-actions/approvals.ts`

**src/lib/:**
- Purpose: Shared utilities and helpers
- Contains: Auth configuration, Prisma client, data adapters, validation schemas
- Key files: `src/lib/auth-config.ts`, `src/lib/prisma.ts`, `src/lib/modal-data-adapters.ts`

**src/types/:**
- Purpose: TypeScript type definitions
- Contains: Domain types, analytics types
- Key files: `src/types/analytics.ts`

**src/hooks/:**
- Purpose: Custom React hooks
- Contains: Media query, scroll direction, interval hooks
- Key files: `src/hooks/use-media-query.tsx`, `src/hooks/use-scroll-direction.tsx`

**prisma/:**
- Purpose: Database schema and migrations
- Contains: Prisma schema, migration files, seed script
- Key files: `prisma/schema.prisma`, `prisma/migrations/`

**tests/:**
- Purpose: Test files
- Contains: E2E tests with Playwright
- Key files: `tests/e2e/`

## Key File Locations

**Entry Points:**
- `src/app/layout.tsx`: Root layout with SessionProvider
- `src/app/page.tsx`: Homepage with auth redirect
- `src/middleware.ts`: Route protection and role-based redirects

**Configuration:**
- `src/lib/auth-config.ts`: NextAuth configuration
- `src/lib/prisma.ts`: Prisma client singleton
- `tsconfig.json`: TypeScript config with path aliases
- `next.config.ts`: Next.js config with standalone output

**Core Logic:**
- `src/server-actions/requests.ts`: Request CRUD and workflow
- `src/server-actions/solutions.ts`: Solution submission and approval
- `src/server-actions/approvals.ts`: Approval chain logic
- `src/server-actions/users.ts`: User management
- `src/lib/modal-data-adapters.ts`: Data transformation for UI
- `src/lib/permission-checks.ts`: Authorization logic

**Testing:**
- `tests/e2e/`: Playwright end-to-end tests
- `playwright.config.ts`: Playwright configuration

## Naming Conventions

**Files:**
- Components: `kebab-case.tsx` (e.g., `request-modal-router.tsx`, `approval-progress.tsx`)
- Server actions: `kebab-case.ts` (e.g., `requests.ts`, `approvals.ts`)
- Utilities: `kebab-case.ts` (e.g., `modal-data-adapters.ts`, `permission-checks.ts`)
- Types: `kebab-case.ts` (e.g., `analytics.ts`)
- API routes: `route.ts` (Next.js convention)

**Directories:**
- Feature directories: `plural-noun` (e.g., `requests/`, `solutions/`, `approvals/`)
- Route groups: `(parenthesized)` (e.g., `(dashboard)/`, `(auth)/`, `(admin)/`)
- Utility directories: `lowercase` (e.g., `lib/`, `hooks/`, `types/`)

**Components:**
- Component exports: `PascalCase` (e.g., `RequestModalRouter`, `ApprovalProgress`)
- File names match component names for easy lookup

**Server Actions:**
- Function exports: `camelCase` (e.g., `createRequest`, `approveRequest`, `getUsers`)
- Input types: `PascalCase` with `Input` suffix (e.g., `CreateRequestInput`)

## Where to Add New Code

**New Feature:**
- Primary code: `src/app/(dashboard)/[feature-name]/page.tsx`
- Components: `src/components/[feature-name]/`
- Server actions: `src/server-actions/[feature-name].ts`
- Types: `src/types/[feature-name].ts`

**New Component/Module:**
- Implementation: `src/components/[category]/[component-name].tsx`
- UI primitives: `src/components/ui/[component-name].tsx`
- Feature components: `src/components/[feature]/[component-name].tsx`

**Utilities:**
- Shared helpers: `src/lib/[utility-name].ts`
- Validation schemas: `src/lib/schemas/[schema-name].ts`
- Data adapters: `src/lib/[entity]-adapters.ts`

**New API Route:**
- REST endpoint: `src/app/api/[resource]/route.ts`
- Dynamic routes: `src/app/api/[resource]/[id]/route.ts`

**New Server Actions:**
- Domain actions: `src/server-actions/[domain].ts`
- Follow pattern: export async functions with `'use server'` directive

## Special Directories

**prisma/migrations/:**
- Purpose: Database migration history
- Generated: Yes (by Prisma CLI)
- Committed: Yes

**public/uploads/:**
- Purpose: User-uploaded file storage
- Generated: Yes (by file upload actions)
- Committed: No (gitignored)

**.next/:**
- Purpose: Next.js build output
- Generated: Yes (by Next.js build)
- Committed: No (gitignored)

**node_modules/:**
- Purpose: NPM dependencies
- Generated: Yes (by npm install)
- Committed: No (gitignored)

**tests/e2e/:**
- Purpose: Playwright end-to-end tests
- Generated: No (written manually)
- Committed: Yes

**.planning/:**
- Purpose: Implementation planning documents
- Generated: No (written manually)
- Committed: Yes

---

*Structure analysis: 2026-03-06*
