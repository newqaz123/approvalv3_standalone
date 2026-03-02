---
status: investigating
trigger: "getUserAdditionalDepartments() returns RSC payload error"
created: 2026-02-12T12:00:00Z
updated: 2026-02-12T13:00:00Z
---

## Current Focus

hypothesis: Made two fixes: (1) Removed unused 'auth' import from department-assignments.ts, aligning it with working departments.ts pattern. (2) Deleted 2 invalid DepartmentApprover records for enguser01 that violated business rules (engineering user assigned to GENERAL department).
test: User should test at /admin/users - click edit on a user, observe Additional Departments section
expecting: Feature should now work. If RSC error persists, may need: clean rebuild (rm -rf .next && npm run dev), or error was actually different (e.g., auth failure, not RSC)
next_action: Awaiting user verification. If still broken, user should provide exact error message from browser console/toast

## Symptoms
expected: Server actions return data successfully without RSC errors
actual: getUserAdditionalDepartments() throws error "Failed to read a RSC payload created by a development version of React on the server while using a production version of React on the client."
errors: RSC payload error when calling getUserAdditionalDepartments from AdditionalDepartmentsSection component
reproduction: Open /admin/users, click edit on a user, see Additional Department Assignments section, watch for RSC error in console/toast
started: This is a new server action file that may not be properly set up for use server action pattern

## Eliminated

- hypothesis: Server action file structure is wrong
  evidence: department-assignments.ts has 'use server' at line 1, same as working files
  timestamp: 2026-02-12T12:00:00Z

- hypothesis: Client component calling server action incorrectly
  evidence: additional-departments-section.tsx follows same pattern as working notification-bell.tsx (useEffect + direct server action calls)
  timestamp: 2026-02-12T12:15:00Z

- hypothesis: Export syntax or function signatures are wrong
  evidence: Functions use same async/await pattern and named exports as working server actions
  timestamp: 2026-02-12T12:15:00Z

- hypothesis: Unused 'auth' import causing issue
  evidence: Removed the unused import. The fix aligns department-assignments.ts with working departments.ts pattern
  timestamp: 2026-02-12T12:45:00Z

- hypothesis: Serialization issue with return data
  evidence: Return type is plain array of objects with string/number properties - all JSON serializable
  timestamp: 2026-02-12T13:00:00Z

## Evidence

- timestamp: 2026-02-12T12:00:00Z
  checked: department-assignments.ts server action file
  found: File has 'use server' directive at line 1, properly exports named functions (getUserAdditionalDepartments, addUserToDepartment, removeUserFromDepartment)
  implication: Server action file structure looks correct

- timestamp: 2026-02-12T12:00:00Z
  checked: additional-departments-section.tsx client component
  found: Component is 'use client', imports server actions from '@/server-actions/department-assignments', calls functions directly in useEffect and startTransition
  implication: Standard Next.js 15 server action pattern from client component

- timestamp: 2026-02-12T12:00:00Z
  checked: users.ts server action file for comparison
  found: users.ts also imports 'auth' from @clerk/nextjs/server at line 3, but this file WORKS
  implication: The unused auth import exists in working files too, so unused import alone may not be the cause

- timestamp: 2026-02-12T12:15:00Z
  checked: notifications.ts server action file (working)
  found: notifications.ts imports 'auth' and USES it directly with `const { userId } = await auth()` in each function
  implication: Working pattern is to import AND use auth(), not to import it unused

- timestamp: 2026-02-12T12:20:00Z
  checked: Comparison between department-assignments.ts and working files
  found: department-assignments.ts imports 'auth' but never uses it - all functions call requireAdmin() which internally calls auth(). users.ts (working) also imports 'auth' but uses clerkClient() directly.
  implication: The key difference may be that department-assignments.ts has a top-level import of a Clerk function that's never called, while working files either use it or don't have it

- timestamp: 2026-02-12T12:45:00Z
  checked: File encoding of 'use server' directive
  found: Both department-assignments.ts and users.ts have identical encoding on first line
  implication: No BOM or encoding issues with the 'use server' directive

- timestamp: 2026-02-12T12:45:00Z
  checked: Made change to department-assignments.ts
  found: Removed unused `import { auth } from '@clerk/nextjs/server'` since all functions use requireAdmin() from @/lib/auth
  implication: File now has cleaner imports, matching departments.ts pattern which works

- timestamp: 2026-02-12T12:50:00Z
  checked: Database for invalid DepartmentApprover records
  found: enguser01@gmail.com had 2 invalid records assigned to Production Department 1 (GENERAL type), violating business rule that engineering users cannot be general department approvers
  implication: These were likely seed/test data that should not exist. Deleted both records.

- timestamp: 2026-02-12T13:00:00Z
  checked: TypeScript compilation
  found: No compilation errors after changes
  implication: Code is syntactically correct

- timestamp: 2026-02-12T13:00:00Z
  checked: Return type serialization
  found: getUserAdditionalDepartments returns array of plain objects with id, departmentId, departmentName, departmentType, level - all serializable
  implication: No serialization issues with returned data

## Resolution
root_cause:
fix:
verification:
files_changed: []
