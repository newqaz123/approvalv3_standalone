---
phase: quick
plan: 002
type: execute
wave: 1
depends_on: []
files_modified:
  - src/server-actions/requests.ts
  - src/server-actions/dashboard.ts
autonomous: true

must_haves:
  truths:
    - "Users in custom approval chains can see requests from other departments on /requests page"
    - "Users in custom approval chains can see requests from other departments on /dashboard page"
    - "Existing department-scoped visibility still works for users NOT in any cross-department approval chain"
    - "Admin and engineering users still see all requests (no regression)"
  artifacts:
    - path: "src/server-actions/requests.ts"
      provides: "Updated getMyRequests visibility logic with OR clause for custom chain approvers"
    - path: "src/server-actions/dashboard.ts"
      provides: "Updated getDashboardRequests visibility logic with OR clause for custom chain approvers"
  key_links:
    - from: "src/server-actions/requests.ts"
      to: "prisma.request.findMany"
      via: "OR clause combining departmentId match with approval chain membership"
      pattern: "OR.*departmentId.*requiredApproverId"
---

<objective>
Fix request visibility for users added to custom approval chains from outside departments.

Problem: When a user from Department A is added to a custom approval chain (solution approval, final approval, or request approval) for a request originating from Department B, that user cannot see the request on the /requests page or /dashboard. The current query filters by `departmentId: currentUser.departmentId`, which excludes cross-department requests where the user is a required approver.

Fix: For general_dept users, expand the Prisma where clause to use an OR condition:
1. Request belongs to user's department (existing behavior), OR
2. User is a requiredApproverId in any RequestApproval for that request, OR
3. User is a requiredApproverId in any SolutionApproval for that request's solutions

This same fix must be applied in both `getMyRequests()` (requests.ts) and `getDashboardRequests()` (dashboard.ts) since they share the same visibility pattern.

Output: Updated server actions with cross-department visibility for custom chain approvers.
</objective>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@src/server-actions/requests.ts
@src/server-actions/dashboard.ts
@prisma/schema.prisma
</context>

<tasks>

<task type="auto">
  <name>Task 1: Update getMyRequests and getDashboardRequests visibility logic</name>
  <files>src/server-actions/requests.ts, src/server-actions/dashboard.ts</files>
  <action>
In both `getMyRequests()` (requests.ts, lines 156-160) and the equivalent in `getDashboardRequests()` (dashboard.ts, line 218-220), change the general_dept user where clause from:

```typescript
{ departmentId: currentUser.departmentId ?? undefined, isDeleted: false }
```

To an OR clause that includes requests where the user is a required approver in any custom chain:

```typescript
{
  isDeleted: false,
  OR: [
    // Requests from user's own department
    { departmentId: currentUser.departmentId ?? undefined },
    // Requests where user is a required approver in request approval chain
    {
      approvals: {
        some: {
          requiredApproverId: userId,
        },
      },
    },
    // Requests where user is a required approver in solution approval chain
    {
      solutions: {
        some: {
          approvals: {
            some: {
              requiredApproverId: userId,
            },
          },
        },
      },
    },
  ],
}
```

Important notes:
- Keep admin and engineering visibility unchanged (they already see all)
- The `userId` variable is already available in both functions from the `auth()` call
- Use Prisma nested relation filtering (`some`) which generates efficient SQL EXISTS subqueries
- Do NOT change the select/include clauses or any other part of the functions
- Apply the exact same pattern in both files since they share identical visibility logic
  </action>
  <verify>
1. Run `npx prisma validate` to confirm schema compatibility
2. Run `npx tsc --noEmit` to confirm no TypeScript errors
3. Run the dev server and test:
   - Log in as a general_dept user who is in a custom approval chain for a request from another department
   - Verify that request appears on /requests page
   - Verify that request appears on /dashboard page
   - Verify own-department requests still appear
   - Log in as admin - verify all requests still visible
   - Log in as engineering user - verify all requests still visible
  </verify>
  <done>
General department users who are required approvers in custom chains can see cross-department requests on both /requests and /dashboard pages, while existing department-scoped visibility is preserved for users not in any cross-department chains.
  </done>
</task>

<task type="auto">
  <name>Task 2: Update getMyActionItems to support custom chain approvers</name>
  <files>src/server-actions/requests.ts</files>
  <action>
The `getMyActionItems()` function (line 368) currently only queries RequestApproval by `requiredLevel: user.level`, which misses custom chain approvals that use `requiredApproverId` instead of `requiredLevel`.

Update the pendingApprovals query (line 388) to find approvals matching EITHER:
- `requiredLevel: user.level` (existing hierarchy-based), OR
- `requiredApproverId: userId` (custom chain)

Change from:
```typescript
const pendingApprovals = await prisma.requestApproval.findMany({
  where: {
    requiredLevel: user.level,
    status: 'pending',
    request: {
      status: 'ImprovementRequest',
      isDeleted: false,
    },
  },
```

To:
```typescript
const pendingApprovals = await prisma.requestApproval.findMany({
  where: {
    OR: [
      { requiredLevel: user.level },
      { requiredApproverId: userId },
    ],
    status: 'pending',
    request: {
      status: 'ImprovementRequest',
      isDeleted: false,
    },
  },
```

Also update the early return check (line 383) to allow users without a level but who may be custom chain approvers:
- Change from `if (!user || !user.level) { return [] }`
- To `if (!user) { return [] }` and then in the where clause, handle the case where `user.level` might be null by conditionally including the level check.

Actually, safer approach: keep the function working for users with no level by making the OR conditional:

```typescript
const levelCondition = user.level ? { requiredLevel: user.level } : null
const approverCondition = { requiredApproverId: userId }
const orConditions = [approverCondition]
if (levelCondition) orConditions.push(levelCondition)

const pendingApprovals = await prisma.requestApproval.findMany({
  where: {
    OR: orConditions,
    status: 'pending',
    ...
  },
```

This ensures users without a level can still see their custom chain action items.
  </action>
  <verify>
1. Run `npx tsc --noEmit` to confirm no TypeScript errors
2. Navigate to /requests/my-actions as a user who is a requiredApproverId in a custom request approval chain from another department
3. Verify the request appears in the action items list
4. Verify existing hierarchy-based action items still appear correctly
  </verify>
  <done>
The My Action Items page shows pending approvals for both hierarchy-based (requiredLevel) and custom chain (requiredApproverId) request approvals, including cross-department requests.
  </done>
</task>

</tasks>

<verification>
1. `npx tsc --noEmit` passes with no errors
2. General dept user in a custom approval chain sees cross-department requests on /requests
3. General dept user in a custom approval chain sees cross-department requests on /dashboard
4. General dept user in a custom approval chain sees cross-department action items on /requests/my-actions
5. Users NOT in any cross-department chain still see only their department's requests (no data leak)
6. Admin users still see all requests
7. Engineering users still see all requests
</verification>

<success_criteria>
- Cross-department custom chain approvers can see and act on requests from other departments
- No visibility regression for existing users
- No TypeScript compilation errors
</success_criteria>

<output>
After completion, create `.planning/quick/002-submit-solution-custom-hierarchy-for-out/002-SUMMARY.md`
</output>
