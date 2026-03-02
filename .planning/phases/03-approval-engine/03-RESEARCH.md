# Phase 3: Approval Engine - Research

**Researched:** 2026-01-31
**Domain:** Drag-and-drop hierarchy management, approval workflow configuration, audit logging
**Confidence:** HIGH

## Summary

Phase 3.2 completes the approval engine by adding admin configuration tools (hierarchy visualization and user level management) and user cancellation capabilities. The core approval logic is already implemented in Phase 3.1, so this phase focuses on UI/UX for hierarchy management and request lifecycle controls.

**Key findings:**
- @dnd-kit is the established modern library for React drag-and-drop, offering modular architecture with sortable multi-column support (Trello-style)
- Hierarchy configuration changes should NOT affect in-flight requests (snapshot pattern from workflow versioning best practices)
- Request cancellation follows standard workflow cancellation patterns: permission-based, requires comments, irreversible state change
- Next.js 15 Server Actions with Zod validation is the established pattern for form handling and mutations

**Primary recommendation:** Use @dnd-kit/sortable for hierarchy visualization with multiple columns (levels), implement quick-edit pattern for user level changes without leaving hierarchy view, add hard validation blocking hierarchy changes when pending approvals exist.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @dnd-kit/core | Latest | Core drag-and-drop primitives | Lightweight (10kb), performant, accessible, modular architecture, no external dependencies |
| @dnd-kit/sortable | Latest | Sortable lists/columns | Built-in support for multi-container (Trello-style), keyboard accessibility, works with core hooks |
| @dnd-kit/utilities | Latest | Helper functions | arrayMove for reordering, collision detection algorithms |
| react-hook-form | 7.71.1 (current) | Form state management | Already in use, performant, excellent DX with Zod |
| Zod | 4.3.6 (current) | Schema validation | Already in use, type-safe, excellent error messages |
| shadcn/ui | Current | UI components | Already in use (Dialog, AlertDialog, Form components) |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @dnd-kit/modifiers | Latest | Drag constraints | If need to restrict drag axis or snap to grid |
| date-fns | 4.1.0 (current) | Date formatting | Already in use for audit trail timestamps |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| @dnd-kit | react-beautiful-dnd | react-beautiful-dnd is no longer maintained, @dnd-kit is the modern replacement |
| @dnd-kit | pragmatic-drag-and-drop | Newer but less ecosystem support, @dnd-kit has better React integration |
| Server Actions | API routes | Server Actions are simpler, reduce boilerplate, built-in Next.js 15 pattern |

**Installation:**
```bash
npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```

## Architecture Patterns

### Recommended Project Structure
```
src/
├── components/
│   ├── admin/
│   │   ├── hierarchy-view.tsx          # Main hierarchy visualization
│   │   ├── hierarchy-column.tsx        # Single level column
│   │   ├── hierarchy-user-card.tsx     # Draggable user card
│   │   └── user-level-quick-edit.tsx   # Inline level edit
│   └── requests/
│       └── cancel-request-dialog.tsx   # Cancellation confirmation
├── server-actions/
│   ├── hierarchy.ts                    # Hierarchy validation & changes
│   └── requests.ts                     # Add cancelRequest() action
└── lib/
    └── hierarchy-validation.ts         # Business rules for hierarchy changes
```

### Pattern 1: Multi-Column Sortable with @dnd-kit
**What:** Trello-style columns where users can be dragged between levels
**When to use:** Hierarchy visualization with user level management
**Example:**
```typescript
// Source: https://docs.dndkit.com/presets/sortable
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, arrayMove, verticalListSortingStrategy } from '@dnd-kit/sortable';

function HierarchyView() {
  const [levels, setLevels] = useState({
    1: ['user1', 'user2'],
    2: ['user3'],
    3: ['user4', 'user5']
  });

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 } // Prevents accidental drags
    })
  );

  function handleDragEnd(event) {
    const { active, over } = event;
    if (!over) return;

    // Move user between levels
    const sourceLevel = findLevel(active.id);
    const targetLevel = findLevel(over.id);

    // Update state and persist to server
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      {Object.entries(levels).map(([level, users]) => (
        <SortableContext key={level} items={users} strategy={verticalListSortingStrategy}>
          <LevelColumn level={level} users={users} />
        </SortableContext>
      ))}
    </DndContext>
  );
}
```

### Pattern 2: Hierarchy Change Validation (Hard Block)
**What:** Prevent hierarchy changes when pending approvals exist
**When to use:** Before allowing any user level updates
**Example:**
```typescript
// server-actions/hierarchy.ts
export async function validateHierarchyChange(departmentId: string) {
  const pendingApprovals = await prisma.requestApproval.count({
    where: {
      status: 'pending',
      request: {
        departmentId,
        status: 'ImprovementRequest', // Only count active approvals
      },
    },
  });

  if (pendingApprovals > 0) {
    throw new Error(
      `Cannot modify hierarchy - ${pendingApprovals} request(s) have pending approvals. ` +
      `Complete or cancel pending requests first.`
    );
  }

  return { allowed: true };
}
```

### Pattern 3: Request Cancellation with Audit Trail
**What:** User-initiated cancellation with required comment
**When to use:** Requester cancels before any approvals
**Example:**
```typescript
// server-actions/requests.ts
export async function cancelRequest(requestId: string, reason: string) {
  const { userId } = await auth();
  if (!userId) throw new Error('Unauthorized');

  const request = await prisma.request.findUnique({
    where: { id: requestId },
    select: { requesterId: true, status: true, approvals: true },
  });

  // Validation
  if (request.requesterId !== userId) {
    throw new Error('Only the requester can cancel their own request');
  }

  if (request.status !== 'ImprovementRequest') {
    throw new Error('Can only cancel requests in ImprovementRequest status');
  }

  const hasApprovals = request.approvals.some(a => a.status === 'approved');
  if (hasApprovals) {
    throw new Error('Cannot cancel - request has been approved');
  }

  // Update request and log activity
  await prisma.$transaction([
    prisma.request.update({
      where: { id: requestId },
      data: { status: 'Cancelled' },
    }),
    prisma.requestActivity.create({
      data: {
        requestId,
        userId,
        action: 'cancelled',
        fromStatus: 'ImprovementRequest',
        toStatus: 'Cancelled',
        comments: reason,
      },
    }),
  ]);

  revalidatePath('/requests');
  return { success: true };
}
```

### Pattern 4: Optimistic UI Updates with Server Validation
**What:** Update UI immediately, validate on server, rollback if error
**When to use:** Drag-and-drop level changes for better UX
**Example:**
```typescript
// components/admin/hierarchy-view.tsx
const [optimisticLevels, setOptimisticLevels] = useState(levels);

async function handleDragEnd(event) {
  const { active, over } = event;

  // 1. Optimistic update
  const newLevels = moveUserBetweenLevels(active.id, over.id);
  setOptimisticLevels(newLevels);

  try {
    // 2. Validate and persist
    await updateUserLevel(active.id, newLevel);
  } catch (error) {
    // 3. Rollback on error
    setOptimisticLevels(levels);
    toast.error(error.message);
  }
}
```

### Pattern 5: shadcn AlertDialog for Destructive Actions
**What:** Confirmation dialog for irreversible actions (cancellation)
**When to use:** Request cancellation, hierarchy changes affecting users
**Example:**
```typescript
// Source: https://ui.shadcn.com/docs/components/alert-dialog
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';

function CancelRequestDialog({ requestId, onConfirm }) {
  const [reason, setReason] = useState('');

  return (
    <AlertDialog>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Cancel Request?</AlertDialogTitle>
          <AlertDialogDescription>
            This action cannot be undone. Please provide a reason for cancellation.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason for cancellation (required)"
        />
        <AlertDialogFooter>
          <AlertDialogCancel>Keep Request</AlertDialogCancel>
          <AlertDialogAction
            disabled={!reason.trim()}
            onClick={() => onConfirm(reason)}
          >
            Cancel Request
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

### Anti-Patterns to Avoid
- **Using react-beautiful-dnd:** No longer maintained, use @dnd-kit instead
- **Allowing hierarchy changes during pending approvals:** Creates confusion about which hierarchy rules apply (snapshot at request creation vs current)
- **Soft validation warnings:** Hierarchy blocking MUST be hard error, not dismissible warning
- **Updating hierarchy without logging:** Every change needs audit trail for compliance
- **Direct database updates without validation:** Always validate through Server Actions with business rules

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Drag-and-drop | Custom mouse/touch handlers | @dnd-kit | Handles touch/mouse/keyboard, accessibility, collision detection, edge cases |
| Multi-column sorting | Custom array manipulation | @dnd-kit/sortable + arrayMove | Handles cross-container moves, maintains order, optimized performance |
| Form validation | Manual error state | react-hook-form + Zod | Type-safe, automatic error handling, field-level validation |
| Confirmation dialogs | Custom modal state | shadcn AlertDialog | Accessible, keyboard navigation, focus management |
| Audit trail | Manual logging | Prisma transaction + RequestActivity model | Atomic updates, consistent format, prevents orphaned logs |

**Key insight:** Drag-and-drop has significant complexity in touch events, keyboard accessibility, collision detection, and edge cases. @dnd-kit handles all of this with a modular API that's easier to maintain than custom implementations.

## Common Pitfalls

### Pitfall 1: Race Conditions in Hierarchy Updates
**What goes wrong:** Two admins update hierarchy simultaneously, one change overwrites the other
**Why it happens:** No optimistic locking or version checking
**How to avoid:**
- Use Prisma's `updatedAt` field for optimistic concurrency control
- Check `updatedAt` matches before update, reject if stale
- Show clear error: "Hierarchy was modified by another admin, please refresh"
**Warning signs:** Users report "my changes disappeared" or inconsistent hierarchy state

**Implementation:**
```typescript
// Add version check to user update
const user = await prisma.user.findUnique({
  where: { id },
  select: { updatedAt: true }
});

if (user.updatedAt > expectedUpdatedAt) {
  throw new Error('Hierarchy modified by another admin, please refresh');
}

await prisma.user.update({
  where: { id, updatedAt: expectedUpdatedAt }, // Atomic check
  data: { level: newLevel },
});
```

### Pitfall 2: Hierarchy Changes Affecting In-Flight Requests
**What goes wrong:** Admin changes hierarchy while requests are pending approval, causing confusion about which hierarchy applies
**Why it happens:** Not blocking hierarchy changes when pending approvals exist
**How to avoid:**
- Count pending approvals BEFORE allowing any hierarchy change
- Hard block with clear error message showing affected request count
- Don't allow override/force - admins must resolve requests first
**Warning signs:** Approvers can't find their pending approvals, requests stuck in "pending" forever

**Source:** [Workflow Versioning - Microsoft Entra ID](https://learn.microsoft.com/en-us/entra/id-governance/lifecycle-workflow-versioning) - "Changes to a workflow definition will not impact its ongoing executions"

### Pitfall 3: Forgetting Keyboard Accessibility in Drag-and-Drop
**What goes wrong:** Hierarchy management only works with mouse, keyboard users can't change levels
**Why it happens:** Not configuring keyboard sensors in @dnd-kit
**How to avoid:**
- Always include KeyboardSensor with coordinateGetter
- Test with Tab + Space + Arrow keys
- Provide alternative inline edit option (not just drag-and-drop)
**Warning signs:** Accessibility audits fail, keyboard users file complaints

**Implementation:**
```typescript
import { KeyboardSensor, sortableKeyboardCoordinates } from '@dnd-kit/sortable';

const sensors = useSensors(
  useSensor(PointerSensor),
  useSensor(KeyboardSensor, {
    coordinateGetter: sortableKeyboardCoordinates, // Arrow keys to move
  })
);
```

### Pitfall 4: Not Logging Hierarchy Changes
**What goes wrong:** Can't answer "who changed this user's level?" or "why are approvals broken?"
**Why it happens:** Only logging request activities, not admin actions
**How to avoid:**
- Create HierarchyChange model or use generic AdminActivity log
- Log: admin ID, user affected, old level, new level, timestamp
- Display change history in hierarchy view
**Warning signs:** Support tickets asking "who moved me?" with no audit trail

### Pitfall 5: Allowing Cancellation After Approvals
**What goes wrong:** Users cancel requests that have been partially approved, wasting approver time
**Why it happens:** Not checking approval status before allowing cancellation
**How to avoid:**
- Only allow cancellation if NO approvals have status 'approved'
- Check both request status AND approval records
- Clear error message: "Cannot cancel - already approved by [Name]"
**Warning signs:** Approvers complain about wasted effort on cancelled requests

### Pitfall 6: No Visual Feedback During Drag
**What goes wrong:** User drags user card but can't tell where it will drop
**Why it happens:** Not styling droppable zones or providing visual cues
**How to avoid:**
- Use `isOver` from useDroppable to highlight target column
- Style dragging item with opacity/shadow
- Show placeholder in target position
**Warning signs:** Users drag to wrong level frequently, ask "where will this go?"

**Implementation:**
```typescript
const { isOver, setNodeRef } = useDroppable({ id: levelId });

<div
  ref={setNodeRef}
  className={`${isOver ? 'bg-blue-50 border-blue-300' : 'bg-gray-50'} transition-colors`}
>
  {/* Level content */}
</div>
```

## Code Examples

Verified patterns from official sources:

### Multi-Container Sortable Setup
```typescript
// Source: https://docs.dndkit.com/presets/sortable
import React, { useState } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';

function HierarchyManager({ initialLevels }) {
  const [levels, setLevels] = useState(initialLevels);
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  function handleDragEnd(event) {
    const { active, over } = event;

    if (active.id !== over.id) {
      setLevels((levels) => {
        const oldIndex = levels.indexOf(active.id);
        const newIndex = levels.indexOf(over.id);

        return arrayMove(levels, oldIndex, newIndex);
      });
    }
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      {Object.entries(levels).map(([level, users]) => (
        <SortableContext
          key={level}
          items={users}
          strategy={verticalListSortingStrategy}
        >
          <LevelColumn level={level} users={users} />
        </SortableContext>
      ))}
    </DndContext>
  );
}
```

### Sortable Item (Draggable User Card)
```typescript
// Source: https://docs.dndkit.com/presets/sortable
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

function UserCard({ user }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: user.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <div className="p-4 bg-white border rounded shadow-sm">
        <p className="font-medium">{user.name}</p>
        <p className="text-sm text-gray-500">{user.email}</p>
      </div>
    </div>
  );
}
```

### Server Action with Prisma Transaction
```typescript
// Pattern: Atomic request cancellation with audit trail
'use server'
export async function cancelRequest(requestId: string, reason: string) {
  const { userId } = await auth();
  if (!userId) throw new Error('Unauthorized');

  // Validate ownership and status
  const request = await prisma.request.findUnique({
    where: { id: requestId },
    include: { approvals: { where: { status: 'approved' } } },
  });

  if (!request) throw new Error('Request not found');
  if (request.requesterId !== userId) {
    throw new Error('Only requester can cancel their own request');
  }
  if (request.approvals.length > 0) {
    throw new Error('Cannot cancel - request already approved');
  }

  // Atomic update with audit trail
  await prisma.$transaction([
    prisma.request.update({
      where: { id: requestId },
      data: { status: 'Cancelled' },
    }),
    prisma.requestActivity.create({
      data: {
        requestId,
        userId,
        action: 'cancelled',
        comments: reason,
        fromStatus: request.status,
        toStatus: 'Cancelled',
      },
    }),
  ]);

  revalidatePath('/requests');
  return { success: true };
}
```

### Form Validation with Zod and react-hook-form
```typescript
// Source: https://ui.shadcn.com/docs/forms/react-hook-form
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import * as z from 'zod';

const cancelSchema = z.object({
  reason: z.string()
    .min(10, 'Reason must be at least 10 characters')
    .max(500, 'Reason too long'),
});

function CancelRequestForm({ requestId }) {
  const form = useForm({
    resolver: zodResolver(cancelSchema),
    defaultValues: { reason: '' },
  });

  async function onSubmit(data) {
    try {
      await cancelRequest(requestId, data.reason);
      toast.success('Request cancelled');
    } catch (error) {
      form.setError('reason', { message: error.message });
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <FormField
          control={form.control}
          name="reason"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Cancellation Reason</FormLabel>
              <FormControl>
                <Textarea {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit">Cancel Request</Button>
      </form>
    </Form>
  );
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| react-beautiful-dnd | @dnd-kit | 2021-2022 | More modular, better performance, actively maintained |
| API routes for mutations | Next.js Server Actions | 2023-2024 | Less boilerplate, built-in validation, better DX |
| Custom drag handlers | @dnd-kit sensors | 2021+ | Keyboard accessibility built-in, touch support |
| Global form state | react-hook-form + Zod | 2020+ | Better performance, type safety, field-level validation |
| Workflow versioning (snapshots) | Hard blocking during changes | Best practice | Prevents confusion about which rules apply to in-flight requests |

**Deprecated/outdated:**
- **react-beautiful-dnd:** No longer maintained, replaced by @dnd-kit
- **Manual drag event handlers:** Use @dnd-kit sensors for accessibility and touch support
- **Soft warnings for hierarchy changes:** Should be hard blocks when approvals pending (from workflow versioning patterns)

## Open Questions

Things that couldn't be fully resolved:

1. **Multi-department user hierarchy display**
   - What we know: Some users belong to multiple departments (user can have only one departmentId in schema)
   - What's unclear: Current schema shows user.departmentId as single value, but context mentions "multi-department users"
   - Recommendation: Clarify if schema needs migration to many-to-many relationship, or if this is a future feature to defer

2. **Hierarchy change history retention**
   - What we know: Need basic audit trail of hierarchy changes
   - What's unclear: Retention period, storage location (separate model vs RequestActivity)
   - Recommendation: Start with RequestActivity model (action: 'hierarchy_changed'), add HierarchyChange model if needed for compliance

3. **Rollback mechanism for hierarchy changes**
   - What we know: No automatic rollback required (from context decisions)
   - What's unclear: UI for viewing past configurations to manually recreate
   - Recommendation: Show change history in hierarchy view, manual reconfiguration for now, defer rollback UI to future iteration

## Sources

### Primary (HIGH confidence)
- [dnd-kit Official Documentation](https://docs.dndkit.com) - Core library patterns, sortable examples
- [@dnd-kit Context7](https://docs.dndkit.com/introduction/getting-started) - Multi-container setup, keyboard accessibility
- [Next.js Server Actions Best Practices (2026)](https://medium.com/@lior_amsalem/nextjs-15-actions-best-practice-bf5cc023301e) - Organization, security patterns
- [shadcn/ui Dialog Documentation](https://ui.shadcn.com/docs/components/dialog) - Confirmation modal patterns
- [shadcn/ui AlertDialog Documentation](https://ui.shadcn.com/docs/components/alert-dialog) - Destructive action confirmations
- [React Hook Form with Zod (2026)](https://ui.shadcn.com/docs/forms/react-hook-form) - Form validation patterns

### Secondary (MEDIUM confidence)
- [Workflow Versioning - Microsoft Entra](https://learn.microsoft.com/en-us/entra/id-governance/lifecycle-workflow-versioning) - Verified official docs on workflow versioning
- [Concurrency Control in Prisma](https://gokulmahe.medium.com/concurrency-control-in-node-js-and-prisma-managing-simultaneous-updates-56b9f17859e5) - Optimistic locking patterns
- [Database Audit Trail Best Practices](https://vertabelo.com/blog/database-design-for-audit-logging/) - Audit logging architecture
- [Top 5 Drag-and-Drop Libraries for React (2026)](https://puckeditor.com/blog/top-5-drag-and-drop-libraries-for-react) - Ecosystem comparison

### Tertiary (LOW confidence)
- Community discussions on workflow cancellation patterns - General guidance only
- React hierarchy visualization patterns - No specific library recommendations verified

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - @dnd-kit official docs, Next.js Server Actions patterns verified
- Architecture: HIGH - Patterns verified with Context7 and official documentation
- Pitfalls: MEDIUM-HIGH - Race conditions and versioning from official docs, others from community best practices

**Research date:** 2026-01-31
**Valid until:** 60 days (2026-04-01) - Stack is stable, @dnd-kit API is mature
