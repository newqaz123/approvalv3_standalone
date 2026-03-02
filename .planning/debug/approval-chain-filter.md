---
status: diagnosed
trigger: "Custom approval chain picker only shows engineering users instead of ALL users in the system"
created: 2026-02-02T00:00:00Z
updated: 2026-02-02T00:00:00Z
---

## Current Focus
hypothesis: CONFIRMED - The page component queries only engineering department users before passing to CustomApprovalPicker
test: Trace data flow from page -> SolutionForm -> CustomApprovalPicker
expecting: Find department filter in page component
next_action: Verify there are no other affected components, document root cause

## Symptoms
expected: Component should show all users in the system except current user
actual: Component only shows engineering users
errors: None reported
reproduction: Open custom approval chain picker, observe filtered user list
started: Unknown (discovered during verification)

## Eliminated
- hypothesis: CustomApprovalPicker component filters users
  evidence: Component receives users as prop, only filters out current user and selected users (lines 47-49)
  timestamp: 2026-02-02T00:00:00Z

- hypothesis: SolutionForm component filters users
  evidence: Component receives engineeringUsers as prop, passes to CustomApprovalPicker unchanged (line 473)
  timestamp: 2026-02-02T00:00:00Z

## Evidence
- timestamp: 2026-02-02T00:00:00Z
  checked: src/components/solutions/custom-approval-picker.tsx
  found: Component receives users as prop, no role-based filtering
  implication: Filtering happens upstream

- timestamp: 2026-02-02T00:00:00Z
  checked: src/components/solutions/solution-form.tsx
  found: Receives engineeringUsers as prop (line 56), passes to CustomApprovalPicker (line 473)
  implication: Filtering happens at page level

- timestamp: 2026-02-02T00:00:00Z
  checked: src/app/(dashboard)/engineering/solutions/[requestId]/page.tsx
  found: Lines 63-85 query only engineering department users
  implication: ROOT CAUSE - Database query filters by department

## Resolution
root_cause: Page component filters user query to engineering department only (lines 73-85 in page.tsx)
fix: Replace department-filtered query with all-active-users query
verification: Not yet verified
files_changed:
- src/app/(dashboard)/engineering/solutions/[requestId]/page.tsx

## Detailed Findings

**Affected Component:**
- File: /Users/red-copperpot/Documents/MyProjects/ApprovalAppV2/src/app/(dashboard)/engineering/solutions/[requestId]/page.tsx
- Lines: 73-85

**Current Logic:**
```typescript
// Fetch engineering users for custom approval picker
const engineeringDept = await prisma.department.findFirst({
  where: { type: 'ENGINEERING' },
  select: { id: true },
})

const engineeringUsers = await prisma.user.findMany({
  where: {
    departmentId: engineeringDept.id,  // ← FILTER: Only engineering dept
    isActive: true,
  },
  select: {
    id: true,
    name: true,
    email: true,
    level: true,
  },
  orderBy: { level: 'desc' },
})
```

**Required Logic:**
```typescript
// Fetch all active users for custom approval picker
const allUsers = await prisma.user.findMany({
  where: {
    isActive: true,  // ← NO department filter
  },
  select: {
    id: true,
    name: true,
    email: true,
    level: true,
  },
  orderBy: [
    { name: 'asc' },  // Sort by name instead of level for all users
  ],
})
```

**Data Flow:**
1. page.tsx queries engineering users → 2. Passes to SolutionForm as engineeringUsers prop → 3. SolutionForm passes to CustomApprovalPicker as users prop → 4. CustomApprovalPicker displays filtered list

**Other Files Checked:**
- src/app/(dashboard)/engineering/page.tsx - Uses getEngineeringUsers() correctly (displays engineering team roster)
- src/components/solutions/custom-approval-picker.tsx - No filtering (passes through users prop)
- src/components/solutions/solution-form.tsx - No filtering (passes through prop)

**Recommended Fix:**
1. In page.tsx, remove lines 64-71 (engineering department lookup)
2. Replace lines 73-85 with all-users query
3. Rename variable from `engineeringUsers` to `allUsers`
4. Update prop name in SolutionForm component from `engineeringUsers` to `allUsers`
5. Update SolutionForm interface to accept `allUsers` instead of `engineeringUsers`
