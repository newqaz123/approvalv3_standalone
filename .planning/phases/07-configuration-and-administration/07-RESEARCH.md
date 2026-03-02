# Phase 07: Configuration & Administration - Research

**Researched:** 2026-02-08
**Domain:** System Administration, Workflow Configuration, Data Lifecycle
**Confidence:** HIGH

## Summary

This phase empowers admins to manage the fundamental structures of the application: users, departments, and approval hierarchies. The critical complexity lies in the **Drag-and-Drop Hierarchy Builder**, which must provide an intuitive interface for mapping users to approval levels while maintaining the underlying "Global Level" data model.

Additionally, this phase implements the data lifecycle policy (Archival & Hard Deletion) using scheduled tasks.

**Primary recommendation:** Use `@dnd-kit` for the hierarchy builder and implement a "Global Level, Local Names" pattern where `User.level` is shared across departments but level *names* (e.g., "Manager") are defined per department.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@dnd-kit/core` | ^6.1.0 | Drag & Drop Primitives | Modern, headless, accessible, small bundle size. |
| `@dnd-kit/sortable` | ^8.0.0 | Sortable Lists | Perfect for reordering levels and moving users between levels. |
| `cron` (or Vercel Cron) | N/A | Scheduled Tasks | Standard for background jobs like archival. |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `shadcn/ui` | Existing | UI Components | Use `Card`, `Table`, `Dialog` for admin views. |
| `TanStack Table` | Existing | Data Tables | For the complex User Management table. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@dnd-kit` | `react-beautiful-dnd` | `rbd` is in maintenance mode and doesn't support React 18 strict mode well. |
| `Vercel Cron` | `node-cron` | `node-cron` requires a constantly running server; Vercel Cron works with serverless functions. |

## Architecture Patterns

### 1. The "Global Level" Data Model
Based on the decision that "Level is global," the schema should reflect that Users hold their level, while Departments define what those levels *mean*.

*   **User:** Stores `level` (Int) and `departmentId` (Home Dept).
*   **Department:** Stores `levelNames` (JSON) mapping ints to strings (e.g., `{1: "Lead", 2: "Manager"}`).
*   **Association:** Users are associated with a Department's hierarchy via:
    1.  Being a member (`User.departmentId`)
    2.  **OR** Being an explicit approver (New `DepartmentApprover` relation)

**Schema Additions:**
```prisma
model Department {
  // ... existing fields
  levelNames  Json?  // { "1": "Team Lead", "2": "Manager" }
  approvers   DepartmentApprover[]
}

model DepartmentApprover {
  id           String     @id @default(cuid())
  departmentId String
  userId       String
  department   Department @relation(fields: [departmentId], references: [id])
  user         User       @relation(fields: [userId], references: [id])
  @@unique([departmentId, userId])
}

model User {
  // ... existing fields
  approverFor DepartmentApprover[]
}
```

### 2. Drag-and-Drop Hierarchy Builder
**Structure:**
*   **Container:** `DndContext` wrapping the editor.
*   **Sidebar (Source):** A "User Pool" (draggable items).
    *   Searchable list of all active users.
    *   Filterable by Department.
*   **Main Area (Target):** Vertical list of `SortableContext` (Levels).
    *   Each Level is a `Droppable` container.
    *   Users inside levels are `Sortable` items.
    *   Levels themselves can be reordered (Sortable).

**Logic:**
*   **On Drag End:**
    *   If dropped in same level: Reorder (visual only, unless we store rank within level).
    *   If dropped in new level: Update local state `user.level = newLevel`.
*   **On Save:**
    *   Send bulk update to API.
    *   API updates `User.level` for all affected users.
    *   **Warning:** Alert admin that changing a user's level here affects them in *all* departments.

### 3. Archival Pipeline
**Strategy:** Soft Delete first, then Hard Delete.

*   **State 1: Active** (`isDeleted: false`)
*   **State 2: Archived** (`isDeleted: true`, `deletedAt: [date]`)
    *   Trigger: Request is `Completed` or `Cancelled` for > 365 days.
    *   Action: Scheduled job sets `isDeleted=true`.
    *   View: Hidden from standard queries `where: { isDeleted: false }`.
*   **State 3: Hard Deleted** (Row removed)
    *   Trigger: `isDeleted: true` AND `deletedAt` > 90 days ago.
    *   Action: Scheduled job runs `deleteMany`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| **Drag Interactions** | Native HTML5 DnD | `@dnd-kit` | HTML5 API is clunky, inconsistent, and hard to make accessible. |
| **Cron Scheduling** | `setInterval` in app | Vercel Cron / Ext Cron | Serverless functions spin down; in-app intervals aren't reliable. |
| **Complex Tables** | Custom `<table>` loops | `TanStack Table` | Sorting, filtering, and pagination are complex to get right manually. |

## Common Pitfalls

### 1. Global Level Side Effects
**Pitfall:** Admin changes Bob to "Director" (L3) in the Engineering hierarchy, not realizing Bob is also in the Sales hierarchy. Bob suddenly becomes L3 in Sales.
**Prevention:**
*   UI must clearly label "Global Level" on the user card.
*   "Save" confirmation should list side effects: "This will also change Bob's level in [Other Depts]".

### 2. Orphaned Approvers
**Pitfall:** A user is deleted/deactivated but remains in `DepartmentApprover`.
**Prevention:**
*   Cascading deletes (if hard delete).
*   For soft delete/deactivation: Logic in Hierarchy Builder to filter out inactive users or show them as "Inactive".

### 3. Self-Approval Loopholes
**Pitfall:** Configuring a hierarchy where a user is their own approver (e.g., Requestor is L1, Approver is L1).
**Prevention:**
*   Phase 3 (Approval Engine) should already handle this, but Hierarchy Builder can add validation warnings: "Warning: Bob is in this level and may request approvals."

## Code Examples

### dnd-kit Sortable Item (User Card)
```tsx
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

export function SortableUserCard({ user }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id: user.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <UserCard user={user} />
    </div>
  );
}
```

### Cron API Handler (Next.js)
```typescript
// app/api/cron/archive/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(request: Request) {
  // 1. Verify Auth (e.g., Bearer token from Vercel Cron)
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  // 2. Archive Old Requests (> 365 days)
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  
  const archived = await prisma.request.updateMany({
    where: {
      status: { in: ['Completed', 'Cancelled'] },
      updatedAt: { lt: oneYearAgo },
      isDeleted: false
    },
    data: { isDeleted: true, deletedAt: new Date(), deletedBy: 'SYSTEM' }
  });

  // 3. Hard Delete Archived (> 90 days in archive)
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  const deleted = await prisma.request.deleteMany({
    where: {
      isDeleted: true,
      deletedAt: { lt: ninetyDaysAgo }
    }
  });

  return NextResponse.json({ archived: archived.count, deleted: deleted.count });
}
```

## Open Questions

1.  **Level Names:** Are they purely cosmetic?
    *   *Assumption:* Yes. The logic relies on `User.level` (Int). The UI displays `Department.levelNames[User.level]`.
2.  **User Pool:** When building a hierarchy, do we show *all* users or just *unassigned* users?
    *   *Recommendation:* Show all users. If a user is dragged in who is already assigned a level, it updates their level. If they are in the *current* hierarchy, dragging them moves them.

## Sources

### Primary (HIGH confidence)
*   `@dnd-kit/core` Documentation - Validated features and accessibility.
*   Prisma Schema - Analyzed existing `User` and `Department` models.
*   CONTEXT.md - Confirmed "Level is global" decision.

### Secondary (MEDIUM confidence)
*   Vercel Cron patterns - Standard Next.js background job pattern.
