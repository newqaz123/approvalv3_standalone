# Clerk AI Prompts for ApprovalAppV2

This project uses Clerk for authentication. Follow these guidelines when working with Clerk features.

## Current Setup
- Framework: Next.js 15 with App Router
- Clerk SDK: `@clerk/nextjs@^6.9.0`
- Middleware: `src/middleware.ts` using `clerkMiddleware()`
- Database: PostgreSQL with Prisma (Neon)

## Critical Rules

### ALWAYS DO:
1. Use `clerkMiddleware()` from `@clerk/nextjs/server` in middleware
2. Import Clerk features from `@clerk/nextjs` or `@clerk/nextjs/server`
3. Use async/await with `auth()` methods
4. Check existing middleware patterns before adding new routes

### NEVER DO:
1. Use old `authMiddleware()` - it's deprecated
2. Reference `_app.tsx` or pages router patterns
3. Use deprecated environment variable patterns
4. Import from deprecated APIs

## Project-Specific Patterns

### Protected Routes
Current route protection in `src/middleware.ts`:
- `/dashboard/*` - Authenticated users only
- `/admin/*` - Admin role only (currently bypassed for testing)

### User Metadata
Users have role metadata stored in Clerk JWT:
```typescript
const { sessionClaims } = await auth()
const role = sessionClaims?.metadata?.role // 'admin' | 'user'
```

### Environment Variables
```bash
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
```

## Useful Clerk Components
- `<SignedIn>` - Show content for authenticated users
- `<SignedOut>` - Show content for guests
- `<SignInButton>` / `<SignUpButton>` - Auth buttons
- `<UserButton>` - User menu avatar
- `auth()` - Server-side auth in Route Handlers

## For More Information
- Clerk Docs: https://clerk.com/docs/nextjs
- MCP Server: Connected (use for code snippets)
