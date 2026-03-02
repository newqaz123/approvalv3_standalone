---
phase: quick-004
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/components/engineering/engineer-pic-picker.tsx
  - src/components/engineering/needs-action-list.tsx
  - src/components/engineering/engineering-dashboard-tabs.tsx
autonomous: true

must_haves:
  truths:
    - "Engineering users can see a PIC assignment button on each request in the Needs Solution list"
    - "Clicking the PIC button opens a multi-select picker showing all engineering team members"
    - "Users can select multiple PICs and save the assignment"
    - "Assigned PICs are displayed on each request row in the Needs Solution table"
    - "Assignment calls the existing assignEngineers server action"
  artifacts:
    - path: "src/components/engineering/engineer-pic-picker.tsx"
      provides: "Multi-select PIC picker component"
      min_lines: 50
    - path: "src/components/engineering/needs-action-list.tsx"
      provides: "Updated needs action list with PIC assignment UI"
  key_links:
    - from: "src/components/engineering/engineer-pic-picker.tsx"
      to: "src/server-actions/requests.ts"
      via: "assignEngineers server action call"
      pattern: "assignEngineers"
---

<objective>
Add Person in Charge (PIC) assignment UI to the engineering dashboard so engineering users can assign multiple PICs to requests awaiting solution.

Purpose: The `assignEngineers` server action and `RequestEngineerAssignment` model already exist but no UI calls them. Engineering users need to assign PICs to track who is responsible for each request.

Output: A multi-select PIC picker component integrated into the "Requests Awaiting Solution" table on the engineering dashboard.
</objective>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@prisma/schema.prisma (RequestEngineerAssignment model at ~line 346)
@src/server-actions/requests.ts (assignEngineers at ~line 1327, getEngineeringUsers at ~line 1414)
@src/components/engineering/needs-action-list.tsx (table showing requests awaiting solution)
@src/components/engineering/engineering-dashboard-tabs.tsx (passes engineeringUsers prop)
@src/components/solutions/custom-approval-picker.tsx (reference pattern for multi-select user picker using Popover + Command)
</context>

<tasks>

<task type="auto">
  <name>Task 1: Create EngineerPicPicker component</name>
  <files>src/components/engineering/engineer-pic-picker.tsx</files>
  <action>
Create a new client component `EngineerPicPicker` that allows selecting multiple engineering users as PICs for a request.

Pattern: Follow the same UI pattern as `CustomApprovalPicker` (Popover + Command for search/select) but simplified -- no ordering needed (PICs are unordered, unlike approval chains).

Props:
- `requestId: string` - the request to assign PICs to
- `engineeringUsers: Array<{ id: string; name: string; email: string; level: number | null }>` - all available engineering users
- `initialAssignedIds: string[]` - currently assigned engineer IDs
- `currentUserId: string` - current user (do NOT filter out -- all engineering users can be PIC including self)

Behavior:
1. Show a button "Assign PIC" (or if PICs already assigned, show assigned names as badges)
2. Clicking opens a Popover with Command (searchable list) showing all engineering users
3. Users can toggle selection (click to add/remove) -- multi-select with checkmarks
4. Include a "Save" button inside the popover that calls `assignEngineers(requestId, selectedIds)` server action
5. Show loading state during save with toast feedback (success/error) using sonner
6. After successful save, update the local state to show new assignments
7. Allow clearing all PICs (empty array is valid)

UI details:
- Use shadcn/ui Popover, Command, CommandInput, CommandItem, Badge, Button
- Show checkmark next to selected users (like CustomApprovalPicker)
- Display assigned PICs as small badges below or beside the button when collapsed
- Keep it compact to fit in a table cell
  </action>
  <verify>File exists, imports compile correctly: `npx tsc --noEmit src/components/engineering/engineer-pic-picker.tsx` (or full build check)</verify>
  <done>EngineerPicPicker component created with multi-select, save functionality, and toast feedback</done>
</task>

<task type="auto">
  <name>Task 2: Integrate PIC picker into engineering dashboard</name>
  <files>
    src/components/engineering/needs-action-list.tsx
    src/components/engineering/engineering-dashboard-tabs.tsx
  </files>
  <action>
Wire the EngineerPicPicker into the existing engineering dashboard:

1. **Update NeedsActionListProps** in `needs-action-list.tsx`:
   - Add `engineeringUsers` prop: `Array<{ id: string; name: string; email: string; level: number | null }>`
   - Add `currentUserId` prop: `string`

2. **Replace the static "Assigned To" column** in the Requests Awaiting Solution table:
   - Currently shows `assignedEngineers.map(e => e.name).join(', ')` as static text
   - Replace with `<EngineerPicPicker>` component, passing:
     - `requestId={request.id}`
     - `engineeringUsers={engineeringUsers}`
     - `initialAssignedIds={assignedEngineers.map((e: any) => e.id)}`
     - `currentUserId={currentUserId}`

3. **Update EngineeringDashboardTabs** in `engineering-dashboard-tabs.tsx`:
   - Pass `engineeringUsers` prop through to `NeedsActionList`
   - Need to also pass `currentUserId` -- add it as a prop to EngineeringDashboardTabsProps

4. **Update engineering page** (`src/app/(dashboard)/engineering/page.tsx`):
   - Pass `userId` (current user ID) as `currentUserId` prop to `EngineeringDashboardTabs`

5. **Remove the static "Engineering Team" card** at the bottom of the needs-action tab (lines 58-85 in engineering-dashboard-tabs.tsx) -- that was a reference/debug section that's now replaced by the PIC picker functionality.
  </action>
  <verify>
Run `npx next build` to verify no type errors or build failures. Then manually verify:
1. Visit http://localhost:3000/engineering as an engineering user
2. See the "Assigned To" column now shows a clickable PIC picker
3. Click to open picker, select multiple users, save
4. Assigned PICs display correctly after save
  </verify>
  <done>
Engineering dashboard shows interactive PIC picker in the Requests Awaiting Solution table. Engineering users can select multiple PICs and save assignments. Assigned PICs display as badges. The static Engineering Team card is removed.
  </done>
</task>

</tasks>

<verification>
1. `npx next build` passes without errors
2. Engineering dashboard loads at /engineering
3. Requests Awaiting Solution table shows PIC picker in "Assigned To" column
4. Can open picker, search users, select multiple, save
5. Saved PICs persist (page refresh shows same assignments)
6. Toast notifications appear for success/error
</verification>

<success_criteria>
- All engineering users appear in the PIC picker for any request in SentToEngineer status
- Multiple PICs can be selected and saved per request
- Existing assignEngineers server action is called (no new server-side code needed)
- PIC assignments display correctly in the table after save
</success_criteria>

<output>
After completion, create `.planning/quick/004-cant-assign-engineer-pic-everyone-in-eng/004-SUMMARY.md`
</output>
