---
phase: quick
plan: 014
type: execute
wave: 1
depends_on: []
files_modified:
  - src/server-actions/department-assignments.ts
  - src/components/admin/additional-departments-section.tsx
  - src/components/admin/edit-user-dialog.tsx
  - src/components/admin/user-table.tsx
  - src/server-actions/users.ts
  - src/app/admin/users/page.tsx
autonomous: true

must_haves:
  truths:
    - "Admin can see which additional departments a user is assigned to from the edit dialog"
    - "Admin can add a user to an additional department with a specific level"
    - "Admin can remove a user from an additional department"
    - "Engineering users cannot be added to general departments and vice versa"
    - "Admin users can be added to any department"
    - "User table shows a visual indicator when a user has additional department assignments"
  artifacts:
    - path: "src/server-actions/department-assignments.ts"
      provides: "Server actions for managing DepartmentApprover records"
      exports: ["getUserAdditionalDepartments", "addUserToDepartment", "removeUserFromDepartment"]
    - path: "src/components/admin/additional-departments-section.tsx"
      provides: "UI section for viewing/adding/removing additional departments"
      min_lines: 80
  key_links:
    - from: "src/components/admin/additional-departments-section.tsx"
      to: "src/server-actions/department-assignments.ts"
      via: "server action calls"
      pattern: "(getUserAdditionalDepartments|addUserToDepartment|removeUserFromDepartment)"
    - from: "src/components/admin/edit-user-dialog.tsx"
      to: "src/components/admin/additional-departments-section.tsx"
      via: "component import and render"
      pattern: "AdditionalDepartmentsSection"
    - from: "src/server-actions/department-assignments.ts"
      to: "prisma.departmentApprover"
      via: "database queries"
      pattern: "prisma\\.departmentApprover\\.(findMany|create|deleteMany)"
---

<objective>
Add multi-department assignment UI to the /admin/users page so admins can assign users as approvers in departments beyond their home department.

Purpose: Users can belong to one home department but may need to approve requests in other departments. This feature lets admins manage those cross-department DepartmentApprover assignments directly from the user management page, enforcing engineering/general separation rules.

Output: Server actions for CRUD on DepartmentApprover records, a new UI section in the Edit User dialog showing/managing additional departments, and a visual badge in the user table.
</objective>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@prisma/schema.prisma (DepartmentApprover model at line 357, User model at line 12, Department model at line 55)
@src/server-actions/users.ts (existing user CRUD, UserWithDepartment type at line 27)
@src/server-actions/hierarchy.ts (existing DepartmentApprover handling in updateHierarchy)
@src/components/admin/edit-user-dialog.tsx (dialog to extend with additional departments section)
@src/components/admin/user-form.tsx (existing form - do NOT modify, add section separately)
@src/components/admin/user-table.tsx (table to add additional depts badge column)
@src/app/admin/users/page.tsx (page that fetches users and departments)
@src/components/ui/badge.tsx (Badge component for department count indicator)
@src/components/ui/select.tsx (Select component for department/level dropdowns)
</context>

<tasks>

<task type="auto">
  <name>Task 1: Create server actions for additional department management</name>
  <files>src/server-actions/department-assignments.ts</files>
  <action>
Create a new server actions file `src/server-actions/department-assignments.ts` with three functions:

1. **`getUserAdditionalDepartments(userId: string)`**
   - Requires admin auth (use `requireAdmin` from `@/lib/auth`, same pattern as `src/server-actions/users.ts` line 42)
   - Query `prisma.departmentApprover.findMany({ where: { approverId: userId }, include: { department: { select: { id: true, name: true, type: true } } } })`
   - Return array of `{ id: string, departmentId: string, departmentName: string, departmentType: string, level: number }`

2. **`addUserToDepartment(userId: string, departmentId: string, level: number)`**
   - Requires admin auth
   - Fetch the user to get their `departmentId` (home dept) and `role`
   - Fetch the target department to get its `type` (GENERAL or ENGINEERING)
   - **Validation rules:**
     - If user's home department is ENG (role = 'engineering') AND target department type is GENERAL, throw Error: "Engineering users cannot be added to general departments"
     - If user's role is 'general_dept' AND target department type is ENGINEERING, throw Error: "General department users cannot be added to the engineering department"
     - If target departmentId equals user's home departmentId, throw Error: "Cannot add user to their home department as an additional approver"
     - Admin users (role = 'admin') bypass the engineering/general check but still cannot be added to their home dept
   - Check for existing DepartmentApprover with same approverId + departmentId (any level). If exists, throw Error: "User is already assigned to this department"
   - Create `prisma.departmentApprover.create({ data: { departmentId, approverId: userId, approverLevel: level } })`
   - Call `revalidatePath('/admin/users')` and `revalidatePath('/admin/hierarchy')`
   - Return the created record

3. **`removeUserFromDepartment(userId: string, departmentId: string)`**
   - Requires admin auth
   - Delete all DepartmentApprover records: `prisma.departmentApprover.deleteMany({ where: { approverId: userId, departmentId } })`
   - Call `revalidatePath('/admin/users')` and `revalidatePath('/admin/hierarchy')`
   - Return `{ success: true }`

Use `'use server'` directive at top. Import `auth` from `@clerk/nextjs/server`, `prisma` from `@/lib/prisma`, `requireAdmin` from `@/lib/auth`, `revalidatePath` from `next/cache`.
  </action>
  <verify>
Run `npx tsc --noEmit` to confirm no TypeScript errors. Grep the file for all three exported functions.
  </verify>
  <done>Three server actions exist with proper auth checks, validation logic enforcing eng/general separation, and CRUD operations on DepartmentApprover.</done>
</task>

<task type="auto">
  <name>Task 2: Create AdditionalDepartmentsSection component and integrate into EditUserDialog</name>
  <files>
    src/components/admin/additional-departments-section.tsx
    src/components/admin/edit-user-dialog.tsx
    src/components/admin/user-table.tsx
    src/server-actions/users.ts
    src/app/admin/users/page.tsx
  </files>
  <action>
**A. Create `src/components/admin/additional-departments-section.tsx`:**

A client component (`'use client'`) that receives props:
```typescript
interface AdditionalDepartmentsSectionProps {
  userId: string
  userRole: 'admin' | 'general_dept' | 'engineering'
  userHomeDepartmentId: string
  departments: Department[] // all departments
}
```

Component behavior:
- On mount, call `getUserAdditionalDepartments(userId)` to fetch current assignments. Store in state. Show a loading skeleton while fetching.
- Display current assignments as a list/table showing: department name, level, and a red "Remove" button (X icon or trash) for each.
- If no additional departments, show "No additional department assignments" in muted text.
- Below the list, show an "Add Department" row with:
  - A Select dropdown for department (filter out: the user's home department AND any departments already assigned). Also filter based on role rules: if user is `engineering`, only show ENGINEERING type departments; if user is `general_dept`, only show GENERAL type departments; if user is `admin`, show all departments.
  - A number Input for level (1-10)
  - An "Add" Button
- On Add click: call `addUserToDepartment`, handle errors with an inline error message (same red box pattern as user-form.tsx line 96-98), refresh the list on success.
- On Remove click: call `removeUserFromDepartment`, refresh the list on success.
- Use existing UI components: Select/SelectContent/SelectItem/SelectTrigger/SelectValue from `@/components/ui/select`, Input from `@/components/ui/input`, Button from `@/components/ui/button`, Badge from `@/components/ui/badge`.
- Style with a visual separator (a border-t or Separator) above the section with a label like "Additional Department Assignments".

**B. Update `src/components/admin/edit-user-dialog.tsx`:**

- Change DialogContent className from `"max-w-lg"` to `"max-w-lg max-h-[85vh] overflow-y-auto"` (the additional section adds height)
- Add `AdditionalDepartmentsSection` below the `<UserForm>` component, but only when editing (when `user.id` exists, which it always does in EditUserDialog).
- Pass `userId={user.id}`, `userRole={user.role}`, `userHomeDepartmentId={user.departmentId || ''}`, `departments={departments}`.
- Import `AdditionalDepartmentsSection` from `./additional-departments-section`.
- Add a visual separator (a `<div className="border-t pt-4 mt-4">` wrapper or use `<Separator />` from ui/separator) between UserForm and the additional section.

**C. Update `src/server-actions/users.ts`:**

- Update the `getUsers()` function (line 41-54) to include DepartmentApprover count. Change the query to:
  ```typescript
  const users = await prisma.user.findMany({
    include: {
      department: true,
      _count: {
        select: { departmentApproverRoles: true }
      }
    },
    orderBy: { name: 'asc' },
  })
  ```
- Update the `UserWithDepartment` type (line 27-36) to add `_count?: { departmentApproverRoles: number }` field.

**D. Update `src/components/admin/user-table.tsx`:**

- Add a new column after the "Department" column (after line 81) called "Additional Depts":
  ```typescript
  {
    id: 'additionalDepts',
    header: 'Additional Depts',
    cell: ({ row }) => {
      const count = (row.original as any)._count?.departmentApproverRoles || 0
      return count > 0 ? (
        <Badge variant="secondary">+{count} dept{count > 1 ? 's' : ''}</Badge>
      ) : (
        <span className="text-muted-foreground text-xs">-</span>
      )
    },
  }
  ```
- Import `Badge` from `@/components/ui/badge`.

**E. Update `src/app/admin/users/page.tsx`:**

No changes needed here -- the `getUsers()` server action already feeds the data, and the `_count` field will flow through the existing `data={users as any}` prop on line 25.
  </action>
  <verify>
Run `npx tsc --noEmit` to confirm no TypeScript errors. Run `npm run build` to confirm the page builds. Manually verify: open `/admin/users`, click edit on a user, confirm the "Additional Department Assignments" section appears below the form. Confirm the "Additional Depts" column appears in the user table.
  </verify>
  <done>
- Edit User dialog shows an "Additional Department Assignments" section with current assignments listed, add form with department/level, and remove buttons.
- Department dropdown in the add form correctly filters based on user role (eng users see only eng depts, general users see only general depts, admin sees all).
- User table shows "+N dept(s)" badge when a user has additional department assignments.
- Error messages display inline when validation rules are violated (eng-to-general, general-to-eng, duplicate, home dept).
  </done>
</task>

</tasks>

<verification>
1. `npx tsc --noEmit` passes with no errors
2. `npm run build` completes successfully
3. Navigate to `/admin/users` -- table shows "Additional Depts" column
4. Click edit pencil on a user -- "Additional Department Assignments" section visible below existing form
5. Add a general user to another general department -- succeeds, appears in list
6. Try adding a general user to ENG department -- error message shown
7. Try adding an ENG user to a general department -- error message shown
8. Remove a previously added additional department -- disappears from list
9. Badge count in user table updates after adding/removing
</verification>

<success_criteria>
- Three server actions (get/add/remove) work with proper auth and validation
- Edit User dialog shows additional departments section with add/remove functionality
- Engineering/general separation enforced on both server and client side (filtered dropdown + server validation)
- User table displays additional department count badge
- No TypeScript errors, build succeeds
</success_criteria>

<output>
After completion, create `.planning/quick/014-add-multi-department-assignment-ui/014-SUMMARY.md`
</output>
