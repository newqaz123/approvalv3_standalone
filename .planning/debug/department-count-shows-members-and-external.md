# Debug: Department User Count Shows Members + External Approvers

**Status:** RESOLVED

**Issue:** `/admin/departments` page showed "Users: 0" for departments that had external approvers (users assigned via `DepartmentApprover` table).

## Root Cause

The `getDepartments()` function only counted users whose `departmentId` matched the department. It did NOT count external approvers who can approve requests for that department.

Example: userpd1 (PD1 Level 3) is assigned as an external approver for PD2 at Level 1, but PD2 showed "Users: 0".

## Fix Applied

1. **Server Action** (`src/server-actions/departments.ts`):
   - Modified `getDepartments()` to include `departmentApprovers` count
   - Returns `_count.approvers = members + externalApprovers`

2. **Component** (`src/components/admin/department-table.tsx`):
   - Changed column header from "Users" to "Members / Approvers"
   - Shows format: "2 / 3" (2 members, 3 total approvers)
   - Total approvers highlighted in green when > members

## Files Changed

- `src/server-actions/departments.ts` - Updated `getDepartments()`
- `src/components/admin/department-table.tsx` - Updated display format

## Verification

Run the check script to see current state:
```bash
npx tsx scripts/check-dept-approvers.ts
```

Expected output for PD2 should show at least 1 external approver (userpd1).
