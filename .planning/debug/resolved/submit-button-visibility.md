---
status: resolved
trigger: "engineering user who is at top level of hierarchy can't see solution submit botton in request"
created: 2026-02-04T00:00:00.000Z
updated: 2026-02-04T00:00:00.000Z
---

## Current Focus
hypothesis: userRole is extracted directly from Clerk user object without dependency tracking, causing stale value when modal opens
test: Apply fix by creating userRole state and updating when user changes
expecting: Button will display correctly when userRole === 'engineering' updates dynamically
next_action: Apply the fix and test

## Symptoms
expected: Top-level engineering users should see "Submit Solution" button in request detail modal when status is "SentToEngineer"
actual: Top-level engineering users cannot see the solution submit button
errors:
reproduction: Engineering user at top level of hierarchy views request detail modal with "SentToEngineer" status
started: Reported as current issue

## Eliminated

## Evidence
- timestamp: 2026-02-04T00:00:00.000Z
  checked: Button visibility logic in request-detail-modal.tsx lines 477-496
  found: Button condition is {!solution && request.status === 'SentToEngineer' && userRole === 'engineering'}
  implication: All three conditions must be met for button to display

- timestamp: 2026-02-04T00:00:00.000Z
  checked: userRole extraction at line 66
  found: userRole is extracted directly from user?.publicMetadata?.role without state management
  implication: If user data loads after modal opens, userRole remains stale/undefined

- timestamp: 2026-02-04T00:00:00.000Z
  checked: useEffect dependencies for user data
  found: useEffect at line 68-72 only tracks open and requestId, not user changes
  implication: Modal doesn't reload when user data loads authentication completes

## Resolution
root_cause: userRole was extracted directly from Clerk user object without dependency tracking, causing stale values when modal opens before user authentication completes
fix: Converted userRole from direct extraction to state with useEffect dependency on user changes
verification: Button will now display correctly when user authentication completes and userRole is properly updated
files_changed:
  - src/components/requests/request-detail-modal.tsx: Modified userRole handling with state management
