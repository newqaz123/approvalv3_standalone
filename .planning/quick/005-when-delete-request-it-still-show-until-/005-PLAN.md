---
phase: quick
plan: 005
type: execute
wave: 1
depends_on: []
files_modified:
  - src/components/requests/request-detail-modal.tsx
  - src/components/dashboard/dashboard-table.tsx
  - src/components/requests/request-table.tsx
autonomous: true

must_haves:
  truths:
    - "After deleting a request via modal, the table immediately removes the deleted row without manual page refresh"
    - "After approving/rejecting a request via modal and closing it, the table data refreshes to show updated status"
    - "After cancelling a request via modal and closing it, the table data refreshes to show Cancelled status"
    - "After any action in the modal (submit solution, mark complete, initiate final approval), closing the modal refreshes the table"
  artifacts:
    - path: "src/components/requests/request-detail-modal.tsx"
      provides: "onActionComplete callback prop, called after any successful action"
    - path: "src/components/dashboard/dashboard-table.tsx"
      provides: "Passes onActionComplete to RequestDetailModal, triggers immediate data refresh"
    - path: "src/components/requests/request-table.tsx"
      provides: "Accepts onDataRefresh prop, re-fetches data when triggered"
  key_links:
    - from: "request-detail-modal.tsx"
      to: "dashboard-table.tsx"
      via: "onActionComplete callback"
      pattern: "onActionComplete\\?\\(\\)"
    - from: "dashboard-table.tsx"
      to: "DashboardTabs refreshAllData"
      via: "onModalClose callback triggers refresh"
      pattern: "onModalClose"
---

<objective>
Fix stale table data after modal actions (delete, approve, reject, cancel, etc.)

Purpose: Currently when a user performs any action in the RequestDetailModal (delete, approve, reject, cancel, submit solution, mark complete) and closes the modal, the parent table still shows the old data until manual page refresh. The table should immediately reflect changes.

Output: All table views (dashboard tabs, request list page) refresh their data when the modal closes after an action was performed.
</objective>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@src/components/requests/request-detail-modal.tsx
@src/components/dashboard/dashboard-table.tsx
@src/components/dashboard/dashboard-tabs.tsx
@src/components/requests/request-table.tsx
@src/components/requests/requests-list-with-filters.tsx
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add onActionComplete callback to RequestDetailModal and wire all action handlers</name>
  <files>src/components/requests/request-detail-modal.tsx</files>
  <action>
    1. Add `onActionComplete?: () => void` prop to `RequestDetailModalProps` interface.
    2. Track whether any action was performed during the modal session using a ref: `const actionPerformedRef = useRef(false)`.
    3. In the `onOpenChange` handler wrapper, when the modal is closing (`open === false`) AND `actionPerformedRef.current === true`, call `onActionComplete?.()` and reset the ref.
    4. Set `actionPerformedRef.current = true` in all success paths:
       - After `loadRequest()` succeeds in `handleApproveSolution` (line ~251)
       - After `loadRequest()` succeeds in `handleRejectSolution` (line ~268)
       - In the `onCancelled` callback of CancelRequestDialog (line ~408-410) - keep `onOpenChange(false)` AND set actionPerformed
       - In the `onDelete` callback of DeleteRequestDialog (line ~432-434) - keep `onOpenChange(false)` AND set actionPerformed
       - In the `onResubmitted` callback of ResubmitRequestDialog (line ~388-390) - set actionPerformed
       - The `onSuccess={loadRequest}` callbacks for ApprovalActions, InitiateFinalApprovalButton, FinalApprovalActions, and MarkCompleteButton - wrap these to also set actionPerformed: `onSuccess={() => { actionPerformedRef.current = true; loadRequest(); }}`
    5. Create a wrapper for onOpenChange that checks the ref:
       ```typescript
       const handleOpenChange = (open: boolean) => {
         if (!open && actionPerformedRef.current) {
           onActionComplete?.()
           actionPerformedRef.current = false
         }
         onOpenChange(open)
       }
       ```
    6. Use `handleOpenChange` in all three Dialog components (loading, not-found, main) instead of `onOpenChange` directly.
  </action>
  <verify>TypeScript compiles without errors: `npx tsc --noEmit --pretty 2>&1 | head -30`</verify>
  <done>RequestDetailModal accepts onActionComplete prop and calls it when modal closes after any action was performed</done>
</task>

<task type="auto">
  <name>Task 2: Wire onActionComplete in DashboardTable and RequestTable to trigger immediate data refresh</name>
  <files>
    src/components/dashboard/dashboard-table.tsx
    src/components/requests/request-table.tsx
  </files>
  <action>
    **DashboardTable (src/components/dashboard/dashboard-table.tsx):**
    1. Add `onActionComplete` prop to the RequestDetailModal instance (line ~270-275).
    2. When `onActionComplete` fires, re-fetch data using `dataFetchingFunction` if available, then call `onModalClose?.()` to notify DashboardTabs:
       ```typescript
       const handleActionComplete = async () => {
         if (dataFetchingFunction) {
           try {
             const freshData = await dataFetchingFunction()
             setData(freshData)
           } catch (error) {
             console.error('Failed to refresh after action:', error)
           }
         }
       }
       ```
    3. Pass `onActionComplete={handleActionComplete}` to `RequestDetailModal`.
    4. In `handleModalChange`, when closing (`!open`), also call `onModalClose?.()` as before (existing behavior preserved).

    **RequestTable (src/components/requests/request-table.tsx):**
    1. Add `onDataRefresh?: () => void` prop to `RequestTableProps`.
    2. Pass `onActionComplete={onDataRefresh}` to the `RequestDetailModal` instance.
    3. In `requests-list-with-filters.tsx`, pass an `onDataRefresh` callback to `RequestTable` that re-fetches using the current filters (reuse the existing fetch logic from `handleFilterChange`):
       ```typescript
       const refreshData = async () => {
         setIsLoading(true)
         try {
           const response = await fetch('/api/requests?' + new URLSearchParams(
             Object.entries(filters).reduce((acc, [key, value]) => {
               if (value) acc[key] = value
               return acc
             }, {} as Record<string, string>)
           ))
           if (response.ok) {
             const data = await response.json()
             setRequests(data)
           }
         } catch (error) {
           console.error('Failed to refresh requests:', error)
         } finally {
           setIsLoading(false)
         }
       }
       ```
    4. Pass `<RequestTable initialData={requests} onDataRefresh={refreshData} />`.
  </action>
  <verify>
    1. TypeScript compiles: `npx tsc --noEmit --pretty 2>&1 | head -30`
    2. Dev server runs: verify no runtime errors in browser console
  </verify>
  <done>
    - Dashboard tables immediately refresh data when modal closes after any action (approve, reject, delete, cancel, etc.)
    - Request list page (/requests) also refreshes after modal actions
    - No manual page refresh needed to see updated data
  </done>
</task>

</tasks>

<verification>
1. `npx tsc --noEmit` passes with no errors
2. Manual test: Open a request in dashboard, approve it, close modal - table shows updated status immediately
3. Manual test: Delete a request from modal - row disappears from table immediately after modal closes
4. Manual test: Cancel a request from modal - status updates to Cancelled in table immediately
</verification>

<success_criteria>
- All table views (dashboard tabs, /requests page) refresh their data when the RequestDetailModal closes after any action
- Deleted requests disappear from the table without manual page refresh
- Status changes (approve, reject, cancel) reflected immediately in the table
- No regressions: existing auto-refresh (30-second interval) and interaction blocking still work
</success_criteria>

<output>
After completion, create `.planning/quick/005-when-delete-request-it-still-show-until-/005-SUMMARY.md`
</output>
