# Phase 4: Engineering Solutions - Research

**Researched:** 2026-02-02
**Domain:** Multi-stage approval workflows with custom approval chains, solution submission with cost estimates, and file attachments
**Confidence:** HIGH

## Summary

Phase 4 implements engineering solution submission with a three-stage approval process: Department → Engineering → Final Department approval. Engineering users submit solutions with cost estimates, timeline projections, and file attachments. The system must support both default hierarchical approvals (reusing Phase 3 patterns) and custom sequential approval chains where submitters select specific approvers in order.

The technical foundation already exists: Next.js 15 with Server Actions, React Hook Form with Zod validation, Prisma for transactions, and local file storage. This phase extends the existing approval system with custom approval chain logic, multi-field forms with numeric validation, and enhanced routing capabilities.

Key challenges include: (1) validation for positive numeric cost estimates, (2) building a custom approval chain selector with unique sequential approvers, (3) managing three-stage workflow state transitions with rejection loops back to engineering, and (4) implementing notification patterns for solution-ready events.

**Primary recommendation:** Extend existing approval patterns rather than creating parallel systems. Use Prisma transactions for atomic custom chain creation, React Hook Form's built-in numeric validation with Zod's `.positive()` and `.min()` constraints, and shadcn/ui combobox patterns for user selection.

## Standard Stack

The established libraries/tools for this domain:

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React Hook Form | v7.71.1 | Form state management | Already in use, excellent multi-step support, minimal re-renders |
| Zod | v4.3.6 | Schema validation | Already in use, TypeScript-first, supports `.positive()` for numeric validation |
| Prisma | v6.1.0 | Database ORM with transactions | Already in use, type-safe, supports nested creates and `$transaction` |
| Next.js Server Actions | v15.1.4 | Server-side form handling | Built-in, no API routes needed, works without JavaScript |
| shadcn/ui | (components) | UI component library | Already in use, combobox for user search, AlertDialog for confirmations |
| date-fns | v4.1.0 | Date formatting | Already in use for activity timestamps |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| lucide-react | v0.563.0 | Icon library | Bell icon for notifications, check/x for status indicators |
| sonner | v2.0.7 | Toast notifications | User feedback after submission, validation errors |
| @tanstack/react-table | v8.21.3 | Table components | Engineering dashboard with filters |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Custom multi-select | shadcn-multi-select-component | Community component adds dependency, but provides battle-tested user picker with search |
| Inline form | Multi-step wizard with state | More complex for this use case - preview step is simpler |
| Separate API routes | Server Actions | Server Actions already work, no need for additional routes |

**Installation:**
```bash
# All dependencies already installed in package.json
# No new packages needed for core functionality

# Optional: If using community multi-select
npm install shadcn-multi-select-component
```

## Architecture Patterns

### Recommended Project Structure

```
src/
├── server-actions/
│   ├── solutions.ts         # New: solution submission, routing, approval
│   ├── approvals.ts          # Extended: custom chain support
│   └── notifications.ts      # New: in-app + email notifications
├── components/
│   ├── solutions/
│   │   ├── solution-form.tsx           # Main form with preview step
│   │   ├── custom-approval-picker.tsx  # Sequential approver selector
│   │   ├── solution-preview.tsx        # Pre-submission review
│   │   └── solution-detail.tsx         # Read-only view for requesters
│   ├── notifications/
│   │   ├── notification-bell.tsx       # Bell icon with badge
│   │   └── notification-list.tsx       # Dropdown notification feed
│   └── requests/
│       └── request-detail-modal.tsx    # Extended: show solution when available
└── app/
    └── engineering/
        ├── page.tsx                     # Dashboard with filters
        └── solutions/[id]/page.tsx      # Solution submission page
```

### Pattern 1: Custom Approval Chain Creation

**What:** Allow submitters to specify sequential approvers, replacing default hierarchy
**When to use:** Engineering solutions need specific review path OR final department approval needs custom routing

**Example:**
```typescript
// Source: Prisma docs + application context
// Custom approval chain with sequential ordering
interface CustomApprovalChain {
  approverIds: string[]  // Sequential order matters
}

async function createCustomApprovalChain(
  requestId: string,
  solutionId: string,
  customChain: CustomApprovalChain,
  submitterId: string
) {
  // Validate: unique approvers only, auto-skip submitter if in chain
  const uniqueApprovers = [...new Set(customChain.approverIds)]
  const filteredApprovers = uniqueApprovers.filter(id => id !== submitterId)

  // Create approvals in transaction for atomicity
  await prisma.$transaction(async (tx) => {
    const approvals = filteredApprovers.map((approverId, index) => ({
      solutionId,           // Or requestId depending on stage
      requiredApproverId: approverId,  // Specific person, not level
      order: index + 1,
      status: 'pending' as const,
      isCustomChain: true,  // Flag to distinguish from hierarchy-based
    }))

    await tx.solutionApproval.createMany({ data: approvals })

    // Log activity
    await tx.requestActivity.create({
      data: {
        requestId,
        userId: submitterId,
        action: 'custom_approval_chain_created',
        comments: `Custom chain: ${filteredApprovers.length} approvers`,
      }
    })
  })
}
```

### Pattern 2: Multi-Field Form with Numeric Validation

**What:** Form with cost estimate (required positive number), timeline (optional text), and file attachments
**When to use:** Solution submission, any form requiring validated numeric + text + files

**Example:**
```typescript
// Source: React Hook Form + Zod documentation
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'

const solutionFormSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(5000),
  costEstimate: z
    .number({ invalid_type_error: 'Cost must be a number' })
    .positive('Cost must be greater than 0')
    .min(0.01, 'Cost must be at least 0.01'),
  currency: z.enum(['THB']).default('THB'),
  timeline: z.string().max(200).optional(),
  conceptDesign: z.string().max(2000).optional(),
  useCustomApprovals: z.boolean().default(false),
  customApproverIds: z.array(z.string()).optional(),
})

type SolutionFormValues = z.infer<typeof solutionFormSchema>

function SolutionForm() {
  const form = useForm<SolutionFormValues>({
    resolver: zodResolver(solutionFormSchema),
    defaultValues: {
      title: '',
      description: '',
      costEstimate: undefined, // Start empty, force user input
      currency: 'THB',
      timeline: '',
      conceptDesign: '',
      useCustomApprovals: false,
      customApproverIds: [],
    },
  })

  const [showPreview, setShowPreview] = useState(false)

  const onSubmit = async (data: SolutionFormValues) => {
    if (!showPreview) {
      setShowPreview(true) // Show preview first
      return
    }

    // Actually submit
    await submitSolution(data)
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)}>
      {!showPreview ? (
        <>
          {/* Form fields */}
          <input
            type="number"
            step="0.01"
            {...form.register('costEstimate', { valueAsNumber: true })}
          />
          {form.formState.errors.costEstimate && (
            <span>{form.formState.errors.costEstimate.message}</span>
          )}
        </>
      ) : (
        <SolutionPreview data={form.getValues()} onEdit={() => setShowPreview(false)} />
      )}
    </form>
  )
}
```

### Pattern 3: Three-Stage Workflow State Machine

**What:** State transitions with rejection loops and conditional routing
**When to use:** Multi-stage workflows where rejections route back to specific stages

**Example:**
```typescript
// Source: Application requirements + Prisma transaction patterns
type RequestStatus =
  | 'ImprovementRequest'      // Stage 1: Department approval
  | 'SentToEngineer'          // Stage 2: Engineering work + approval
  | 'SendBackToRequester'     // Stage 3: Final department approval
  | 'Completed'               // Terminal state
  | 'Cancelled'               // Terminal state

interface WorkflowTransition {
  from: RequestStatus
  to: RequestStatus
  trigger: 'all_approvals_complete' | 'solution_submitted' | 'rejection'
  condition?: (request: any) => boolean
}

const transitions: WorkflowTransition[] = [
  {
    from: 'ImprovementRequest',
    to: 'SentToEngineer',
    trigger: 'all_approvals_complete',
  },
  {
    from: 'SentToEngineer',
    to: 'SendBackToRequester',
    trigger: 'all_approvals_complete', // Engineering solution approved
  },
  {
    from: 'SentToEngineer',
    to: 'SentToEngineer',
    trigger: 'rejection', // Engineering approver rejects
  },
  {
    from: 'SendBackToRequester',
    to: 'Completed',
    trigger: 'all_approvals_complete', // Final approval
  },
  {
    from: 'SendBackToRequester',
    to: 'SentToEngineer',
    trigger: 'rejection', // Department rejects solution, back to engineering
  },
]

async function transitionRequestStatus(
  requestId: string,
  trigger: string,
) {
  await prisma.$transaction(async (tx) => {
    const request = await tx.request.findUnique({
      where: { id: requestId },
      select: { status: true, requesterId: true },
    })

    if (!request) throw new Error('Request not found')

    const transition = transitions.find(
      t => t.from === request.status && t.trigger === trigger
    )

    if (!transition) {
      throw new Error(`Invalid transition from ${request.status} with ${trigger}`)
    }

    await tx.request.update({
      where: { id: requestId },
      data: { status: transition.to },
    })

    await tx.requestActivity.create({
      data: {
        requestId,
        userId: request.requesterId,
        action: 'status_changed',
        fromStatus: request.status,
        toStatus: transition.to,
      },
    })
  })
}
```

### Pattern 4: Notification System with Unread Badge

**What:** Bell icon with numeric badge showing unread count, dropdown with notification list
**When to use:** Any system requiring in-app notifications for workflow events

**Example:**
```typescript
// Source: Next.js real-time notification patterns (2026)
// Component structure
function NotificationBell() {
  const [notifications, setNotifications] = useState([])
  const [isOpen, setIsOpen] = useState(false)
  const unreadCount = notifications.filter(n => !n.isRead).length

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-xs text-white">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80">
        <NotificationList notifications={notifications} />
      </PopoverContent>
    </Popover>
  )
}

// Server action to mark as read
async function markNotificationAsRead(notificationId: string) {
  const { userId } = await auth()
  if (!userId) throw new Error('Unauthorized')

  await prisma.notification.update({
    where: { id: notificationId, userId }, // Ownership check
    data: { isRead: true, readAt: new Date() },
  })

  revalidatePath('/') // Refresh notification count
}
```

### Anti-Patterns to Avoid

- **Storing approval chain as JSON:** Use proper relational structure with order field, not JSON array. Allows querying, joining, and maintains referential integrity.
- **Allowing empty custom approval chains:** Validate that custom chains have at least one approver after filtering out submitter.
- **No preview step for destructive submissions:** Solution submission triggers workflow - always show preview with all data before final submission.
- **Duplicate approvers in custom chain:** Validate uniqueness - same person shouldn't appear twice in approval sequence.
- **Not checking custom chain membership:** If submitter appears in custom chain, auto-skip them (don't block submission).

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| User search/selection | Custom autocomplete | shadcn/ui Combobox or shadcn-multi-select-component | Keyboard navigation, accessibility, proper focus management already solved |
| Currency formatting | String manipulation | Intl.NumberFormat API | Handles localization, decimal places, currency symbols correctly |
| Notification badge | Custom positioned div | Badge component with absolute positioning pattern | Proper z-index, responsive sizing, accessibility |
| Form progress indicator | Custom stepper | Simple state + conditional rendering | Multi-step wizards are overkill for preview-then-submit pattern |
| Decimal validation | Regex parsing | Zod's number() with valueAsNumber | Type coercion, NaN handling, Infinity edge cases handled |

**Key insight:** The codebase already has proven patterns for approvals, file uploads, and workflows. Extend, don't rebuild. Custom approval chains are the only net-new pattern, and they reuse the existing approval model structure.

## Common Pitfalls

### Pitfall 1: Decimal Input Precision Loss

**What goes wrong:** User enters "1500.50" but JavaScript stores as 1500.5 or loses precision in Prisma Decimal type
**Why it happens:** HTML number inputs and JavaScript floats have precision issues, Prisma Decimal requires proper handling
**How to avoid:**
- Use `step="0.01"` on number inputs for currency
- Use `valueAsNumber: true` in React Hook Form register
- Store as Prisma `Decimal(15, 2)` for currency (already in schema: `engineeringCostEstimate Decimal @db.Decimal(15, 2)`)
- Validate with Zod `.min(0.01)` to prevent zero/negative costs
**Warning signs:** Cost showing as "1500.5" instead of "1500.50", or NaN errors on submission

### Pitfall 2: Custom Chain Circular References

**What goes wrong:** Submitter selects themselves in custom approval chain, creating instant approval or infinite loop
**Why it happens:** No validation preventing self-selection in user picker
**How to avoid:**
- Filter out current user from custom approver selector
- If user somehow ends up in chain (saved earlier, role changed), auto-skip them during approval processing
- Validate uniqueness: `[...new Set(approverIds)]`
**Warning signs:** Approvals instantly completing, or "You cannot approve your own submission" errors

### Pitfall 3: Status Transition Race Conditions

**What goes wrong:** Two approvers approve simultaneously, status changes twice, or approval chain gets corrupted
**Why it happens:** No locking mechanism, multiple async operations modifying same request
**How to avoid:**
- Use Prisma transactions for all approval operations
- Check approval status is still 'pending' inside transaction before updating
- Use `where: { id, status: 'pending' }` for atomic updates
- Existing code already uses this pattern: `approvals.ts:242-245`
**Warning signs:** Duplicate status change activity logs, approvals in wrong state, or "approval not found" errors

### Pitfall 4: File Upload Without Solution Record

**What goes wrong:** User uploads files but closes browser before solution submission, orphaned files in storage
**Why it happens:** Same pattern as request creation - files uploaded before metadata saved
**How to avoid:**
- Use same three-step pattern from request creation (already proven in `request-form.tsx`):
  1. Create solution record first (gets ID)
  2. Upload files with solution ID
  3. Confirm file metadata to database
- Files are already tied to requestId, solution files should be additional relation
**Warning signs:** Files in `/uploads/` with no corresponding database records

### Pitfall 5: Notification Spam from Multi-Approver Levels

**What goes wrong:** If 5 people are Level 3 approvers, all 5 get notifications even though only one needs to approve (any-one logic)
**Why it happens:** Misunderstanding of notification vs. approval requirements
**How to avoid:**
- **For default hierarchies:** DO send notifications to all eligible approvers at current level (any-one can approve) - this is correct behavior, already implemented in `approvals.ts:337-371`
- **For custom chains:** Only notify the NEXT specific approver in sequence, not all
- Different notification strategies for different approval types
**Warning signs:** Users complaining about too many notifications for requests they didn't approve

## Code Examples

Verified patterns from official sources:

### Custom Approval Chain Model Extension

```typescript
// Add to prisma/schema.prisma
model SolutionApproval {
  id            String         @id @default(cuid())
  requestId     String
  request       Request        @relation(fields: [requestId], references: [id], onDelete: Cascade)

  // Support both level-based (Phase 3) and custom chains
  requiredLevel     Int?           // Null for custom chains
  requiredApproverId String?        // Specific user for custom chains
  requiredApprover   User?          @relation("CustomApprover", fields: [requiredApproverId], references: [id])

  approverId    String?        // Who actually approved
  approver      User?          @relation("SolutionApprover", fields: [approverId], references: [id])

  order         Int            // Sequential order (1, 2, 3...)
  status        ApprovalStatus @default(pending)
  comments      String?        @db.Text

  isCustomChain Boolean        @default(false)  // Flag for custom vs hierarchy

  approvedAt    DateTime?
  createdAt     DateTime       @default(now())

  @@index([requestId])
  @@index([status])
  @@index([order])
}
```

### Solution Submission Server Action

```typescript
// src/server-actions/solutions.ts
'use server'

import { auth } from '@clerk/nextjs/server'
import prisma from '@/lib/prisma'
import { z } from 'zod'

const submitSolutionSchema = z.object({
  requestId: z.string().cuid(),
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(5000),
  costEstimate: z.number().positive().min(0.01),
  currency: z.enum(['THB']),
  timeline: z.string().max(200).optional(),
  conceptDesign: z.string().max(2000).optional(),
  useCustomApprovals: z.boolean(),
  customApproverIds: z.array(z.string()).optional(),
})

export async function submitSolution(
  input: z.infer<typeof submitSolutionSchema>
) {
  const { userId } = await auth()
  if (!userId) throw new Error('Unauthorized')

  // Validate user is engineering
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, departmentId: true, level: true },
  })

  if (user?.role !== 'engineering') {
    throw new Error('Only engineering users can submit solutions')
  }

  // Validate request exists and is in SentToEngineer status
  const request = await prisma.request.findUnique({
    where: { id: input.requestId },
    select: { status: true, departmentId: true },
  })

  if (!request || request.status !== 'SentToEngineer') {
    throw new Error('Request not found or not ready for solution')
  }

  // Transaction for atomicity
  await prisma.$transaction(async (tx) => {
    // Update request with solution data
    await tx.request.update({
      where: { id: input.requestId },
      data: {
        engineeringSolution: input.description,
        engineeringCostEstimate: input.costEstimate,
        status: 'DesignCostEstimationApproval', // New status for engineering approval
      },
    })

    // Create approval chain
    if (input.useCustomApprovals && input.customApproverIds?.length) {
      // Custom chain
      await createCustomApprovalChain(
        tx,
        input.requestId,
        input.customApproverIds,
        userId
      )
    } else {
      // Default engineering hierarchy
      await createHierarchyApprovalChain(
        tx,
        input.requestId,
        user.departmentId!,
        user.level || 1
      )
    }

    // Log activity
    await tx.requestActivity.create({
      data: {
        requestId: input.requestId,
        userId,
        action: 'solution_submitted',
        comments: `Solution submitted with cost estimate: ${input.costEstimate} ${input.currency}`,
      },
    })
  })

  revalidatePath('/requests')
  return { success: true }
}

async function createCustomApprovalChain(
  tx: any,
  requestId: string,
  approverIds: string[],
  submitterId: string
) {
  // Validate unique and filter out submitter
  const unique = [...new Set(approverIds)]
  const filtered = unique.filter(id => id !== submitterId)

  if (filtered.length === 0) {
    throw new Error('Custom approval chain must have at least one approver')
  }

  const approvals = filtered.map((approverId, index) => ({
    requestId,
    requiredApproverId: approverId,
    order: index + 1,
    status: 'pending' as const,
    isCustomChain: true,
  }))

  await tx.solutionApproval.createMany({ data: approvals })
}
```

### User Picker Component

```typescript
// src/components/solutions/custom-approval-picker.tsx
'use client'

import { useState, useEffect } from 'react'
import { Check, ChevronsUpDown, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
} from '@/components/ui/command'
import { Badge } from '@/components/ui/badge'

interface User {
  id: string
  name: string
  email: string
  level: number | null
}

interface CustomApprovalPickerProps {
  users: User[]
  selectedIds: string[]
  onChange: (ids: string[]) => void
  currentUserId: string // To filter out
}

export function CustomApprovalPicker({
  users,
  selectedIds,
  onChange,
  currentUserId,
}: CustomApprovalPickerProps) {
  const [open, setOpen] = useState(false)

  // Filter out current user
  const availableUsers = users.filter(u => u.id !== currentUserId)

  const selectedUsers = selectedIds
    .map(id => availableUsers.find(u => u.id === id))
    .filter(Boolean) as User[]

  const addApprover = (userId: string) => {
    if (!selectedIds.includes(userId)) {
      onChange([...selectedIds, userId])
    }
    setOpen(false)
  }

  const removeApprover = (userId: string) => {
    onChange(selectedIds.filter(id => id !== userId))
  }

  const moveUp = (index: number) => {
    if (index === 0) return
    const newOrder = [...selectedIds]
    ;[newOrder[index], newOrder[index - 1]] = [newOrder[index - 1], newOrder[index]]
    onChange(newOrder)
  }

  const moveDown = (index: number) => {
    if (index === selectedIds.length - 1) return
    const newOrder = [...selectedIds]
    ;[newOrder[index], newOrder[index + 1]] = [newOrder[index + 1], newOrder[index]]
    onChange(newOrder)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium">Custom Approval Chain</label>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm">
              <ChevronsUpDown className="mr-2 h-4 w-4" />
              Add Approver
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[300px] p-0">
            <Command>
              <CommandInput placeholder="Search users..." />
              <CommandEmpty>No users found.</CommandEmpty>
              <CommandGroup>
                {availableUsers.map((user) => (
                  <CommandItem
                    key={user.id}
                    onSelect={() => addApprover(user.id)}
                    disabled={selectedIds.includes(user.id)}
                  >
                    <Check
                      className={cn(
                        'mr-2 h-4 w-4',
                        selectedIds.includes(user.id)
                          ? 'opacity-100'
                          : 'opacity-0'
                      )}
                    />
                    <div className="flex-1">
                      <div className="font-medium">{user.name}</div>
                      <div className="text-xs text-gray-500">{user.email}</div>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </Command>
          </PopoverContent>
        </Popover>
      </div>

      {selectedUsers.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm text-gray-600">
            Approvals will proceed in this order:
          </p>
          {selectedUsers.map((user, index) => (
            <div
              key={user.id}
              className="flex items-center gap-2 rounded-lg border bg-white p-3"
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-100 text-sm font-medium text-blue-700">
                {index + 1}
              </span>
              <div className="flex-1">
                <div className="font-medium">{user.name}</div>
                <div className="text-xs text-gray-500">{user.email}</div>
              </div>
              <div className="flex gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => moveUp(index)}
                  disabled={index === 0}
                >
                  ↑
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => moveDown(index)}
                  disabled={index === selectedUsers.length - 1}
                >
                  ↓
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => removeApprover(user.id)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| useFormState hook | useActionState hook | Next.js 15 (2024) | More ergonomic API for server action state |
| API routes for forms | Server Actions | Next.js 13+ (2023) | Eliminates boilerplate, works without JS |
| JSON fields for chains | Relational approval models | Best practice (ongoing) | Queryable, type-safe, proper foreign keys |
| Client-side validation only | Server + client validation | Always required | Security, data integrity |
| Polling for notifications | Server-sent events / WebSockets | Modern real-time (2020+) | Better UX, less server load |

**Deprecated/outdated:**
- `useFormState` hook: Replaced by `useActionState` in React 19/Next.js 15 - existing code may still use old hook, update during this phase
- Storing approval chains as JSON arrays: Use relational structure with `order` field for sequential processing
- Alert() for validation errors: Use toast notifications (sonner) or inline form errors

## Open Questions

Things that couldn't be fully resolved:

1. **Email notification timing for final approval**
   - What we know: Context specifies "Email notifications sent to approvers when they have a solution to approve in FinalApproval"
   - What's unclear: Should emails be sent immediately when entering FinalApproval, or only when each approver's turn comes (if sequential)? Default hierarchy is any-one-per-level, so all should be notified.
   - Recommendation: Send emails to all eligible approvers at current level when status changes to FinalApproval (matches Phase 3 pattern). For custom chains, only email the next approver in sequence.

2. **Solution attachment storage location**
   - What we know: Request files go to `public/uploads/{requestId}/`, context says "solution documents (survey, design, cost estimates) with file attachments"
   - What's unclear: Should solution files go in same folder as request files, or separate folder like `{requestId}/solutions/`?
   - Recommendation: Same folder for simplicity - file metadata already has `requestId` for association. If separation needed later, add `fileType` enum to distinguish.

3. **Person in Charge persistence**
   - What we know: "Person in Charge selector (multi-select, anyone in engineering)" is "Informational only - doesn't restrict who can submit solution"
   - What's unclear: Where is this stored? New field on Request model? Separate junction table? Just for UI filter?
   - Recommendation: Add `assignedEngineers: User[]` relation to Request (many-to-many via join table) for queryability. Allows filtering "My Assigned" requests and shows in list columns.

4. **Auto-approval for top-level engineering submitters**
   - What we know: "If submitter is top-level in engineering, solution bypasses approval and goes directly to requester"
   - What's unclear: Should this create an auto-approved approval record for audit trail, or skip approvals entirely?
   - Recommendation: Create auto-approved approval record (like Phase 3 pattern in `approvals.ts:43-50`) for complete audit trail. Status changes directly to SendBackToRequester.

## Sources

### Primary (HIGH confidence)

- [/react-hook-form/react-hook-form](https://context7.com/react-hook-form/react-hook-form/llms.txt) - Multi-step forms, numeric validation, Zod integration patterns
- [/colinhacks/zod](https://context7.com/colinhacks/zod/llms.txt) - Number validation with `.positive()`, `.min()`, string constraints, schema composition
- [/prisma/docs](https://github.com/prisma/docs) - Transaction patterns, nested creates, atomic operations
- Existing codebase (`src/server-actions/approvals.ts`, `src/components/requests/request-form.tsx`) - Proven approval and file upload patterns

### Secondary (MEDIUM confidence)

- [Next.js Server Actions: Complete Guide (2026)](https://dev.to/marufrahmanlive/nextjs-server-actions-complete-guide-with-examples-for-2026-2do0) - Server Actions best practices for 2026
- [The Only Guide You Need for Next.js Forms (2025)](https://www.deepintodev.com/blog/form-handling-in-nextjs) - Server Actions with Zod validation
- [Building In-App Notifications in Next.js](https://getstream.io/blog/in-app-notifications-nextjs/) - Bell icon, badge patterns, notification feed UI
- [Real-time Notifications with Supabase and Next.js](https://makerkit.dev/blog/tutorials/real-time-notifications-supabase-nextjs) - Notification popover patterns with unread counter
- [shadcn-multi-select-component](https://github.com/sersavan/shadcn-multi-select-component) - Community component for user selection with search

### Tertiary (LOW confidence)

- [Sequential approval workflows guide](https://www.myshyft.com/blog/parallel-vs-sequential-approvals/) - General workflow concepts (not Prisma-specific)
- [Currency Input with React Hook Form and Zod](https://arthurpedroti.com.br/currency-input-or-any-input-with-mask-integration-with-react-hook-form-and-zod/) - Currency formatting patterns

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All libraries already in use, versions confirmed in package.json
- Architecture: HIGH - Patterns verified in Context7 docs and existing codebase
- Pitfalls: HIGH - Common issues documented in official guides and community discussions
- Code examples: HIGH - Sourced from official documentation and proven codebase patterns

**Research date:** 2026-02-02
**Valid until:** 2026-03-02 (30 days - stable stack, but Next.js/React ecosystem moves fast)
