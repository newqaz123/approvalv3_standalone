# Phase 08: Complete Admin User & Department Management - Research

**Researched:** 2026-02-13
**Domain:** Identity Management & Database Synchronization
**Confidence:** HIGH

## Summary

This phase implements the "Edit" functionality for Users and Departments. The critical complexity lies in the **User Edit** workflow, which requires a dual-write strategy to sync Clerk (Auth) and Prisma (App Data).

The standard approach for this application is **Clerk First, then Prisma**. This ensures authentication data is always authoritative. We will use the Clerk Backend SDK to manage user metadata and email addresses, leveraging the ability to force-verify emails for admin-initiated updates.

**Primary recommendation:** Use Server Actions for all mutations, implementing a "Compensation" pattern (manual rollback) for dual-write failures.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@clerk/nextjs` | ^6.9.0 | Auth & User Management | Existing project standard. Backend SDK allows admin overrides. |
| `@prisma/client` | ^6.1.0 | Database Access | Existing ORM. |
| `zod` | ^4.3.6 | Validation | Schema validation for form inputs. |
| `react-hook-form` | ^7.71.1 | Form State | Standard for form handling. |

## Architecture Patterns

### User Edit Workflow (Dual-Write)
We must treat Clerk as the source of truth for identity (Email, Name, Role) and Prisma as the source of truth for relationships (Department).

**Step-by-Step Transaction:**
1.  **Validate Input:** Zod schema check.
2.  **Clerk Update (Identity):**
    *   Update `firstName`, `lastName`, `publicMetadata.role`.
    *   **If Email Changed:**
        *   Create new email: `createEmailAddress({ userId, email, verified: true, primary: true })`.
        *   *Note: This automatically sets it as primary and verified.*
        *   Delete old email (optional but recommended for cleanliness).
3.  **Prisma Update (App Data):**
    *   Update `name`, `email`, `role`, `departmentId`.
4.  **Error Handling:**
    *   If Clerk fails: Stop, return error.
    *   If Prisma fails: **Compensate** by reverting Clerk changes (set back old name/role/email).

### Code Example: Clerk User Update
```typescript
// Source: Clerk Backend SDK Docs (Verified)
import { clerkClient } from '@clerk/nextjs/server'

export async function updateUserAction(formData: UserUpdateSchema) {
  const client = await clerkClient()
  
  // 1. Update Basic Info
  await client.users.updateUser(formData.id, {
    firstName: formData.firstName,
    lastName: formData.lastName,
    publicMetadata: { role: formData.role }
  })

  // 2. Handle Email Change (if needed)
  if (formData.email !== currentEmail) {
    const newEmail = await client.emailAddresses.createEmailAddress({
      userId: formData.id,
      emailAddress: formData.email,
      verified: true, // Admin override
      primary: true   // Set as primary immediately
    })
    
    // Optional: Delete old email
    // await client.emailAddresses.deleteEmailAddress(oldEmailId)
  }
}
```

### Department Update Pattern
Standard Prisma `update`.
-   **Constraint:** `name` must be unique.
-   **Relation:** `User.departmentId` references `Department.id`, so renaming a department is safe and propagates automatically.

```typescript
await prisma.department.update({
  where: { id: departmentId },
  data: { name: newName, type: newType }
})
```

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Email Verification | Custom token flow | `verified: true` in Clerk SDK | Admins are trusted; skip user loop. |
| Form Validation | Custom regex | `zod` schemas | Consistent, type-safe validation. |
| API Clients | `fetch('/api/...')` | Server Actions | Type safety, simpler mental model. |

## Common Pitfalls

### Pitfall 1: Email Uniqueness Race Condition
**What goes wrong:** Admin changes user A's email to one that already exists in Clerk.
**Why it happens:** Clerk enforces uniqueness globally.
**How to avoid:** Catch the specific Clerk error (400/422) and return a friendly "Email already taken" message. Do not proceed to Prisma update.

### Pitfall 2: Prisma-Clerk Desync
**What goes wrong:** Clerk updates, Prisma fails (e.g., DB down), creating a "ghost" state where Auth has new data but App has old.
**How to avoid:** Implement the `catch` block to revert Clerk changes. If revert fails, log a CRITICAL error for manual intervention.

### Pitfall 3: Inactive Users
**What goes wrong:** Editing a banned/inactive user might reactivate them if not careful.
**How to avoid:** Ensure the `update` logic doesn't implicitly toggle `isActive` or `banned` status unless explicitly requested.

## Open Questions

1.  **Old Email Cleanup:**
    *   **Recommendation:** When changing email, fetch the user's *current* email ID first. After successfully creating and setting the new primary, delete the old ID. This keeps the user profile clean.

## Sources

### Primary (HIGH confidence)
-   **Context7**: Verified `clerkClient.users.updateUser` and `createEmailAddress` signatures.
-   **Existing Code**: `src/app/api/clerk/webhook/route.ts` confirms the `await clerkClient()` pattern.

### Secondary (MEDIUM confidence)
-   **Prisma Docs**: Standard update behavior is well-understood.

## Metadata

**Confidence breakdown:**
-   Standard stack: HIGH - Project already uses these tools.
-   Architecture: HIGH - Dual-write pattern is established.
-   Pitfalls: HIGH - Standard distributed system issues.

**Research date:** 2026-02-13
