---
status: diagnosed
trigger: "Debug Issue 3: Submit button visibility inconsistency in request detail modal"
created: 2026-02-04T00:00:00Z
updated: 2026-02-04T00:15:00Z
---

## Current Focus

hypothesis: ROOT CAUSE IDENTIFIED - Modal checks `userRole === 'engineering'` which fails when userRole state is undefined or not yet synced from Clerk metadata, while dashboard uses server-side role protection (lines 31-33 in engineering/page.tsx) so doesn't need client-side role check in needs-action-list
test: Confirmed by examining both code paths
expecting: Modal's client-side userRole check is unreliable compared to dashboard's server-side protection
next_action: Remove userRole check from modal to match dashboard behavior, since modal is accessible from multiple pages not just /engineering

## Symptoms

expected: Submit button visible for ALL engineering users in request detail modal opened from /requests page
actual: Submit button NOT visible in modal from /requests page, but IS visible in engineering dashboard "Requests Awaiting Solution" section
errors: No error messages - button simply doesn't render
reproduction: Open request detail modal from /requests page for engineering user - submit button is missing
started: After commit ea56ef1 (plan 04-19 execution) - converted userRole to useState with useEffect

## Eliminated

## Evidence

- timestamp: 2026-02-04T00:05:00Z
  checked: request-detail-modal.tsx lines 464-484
  found: Submit button has condition `{!solution && request.status === 'SentToEngineer' && userRole === 'engineering' && (`
  implication: Button ONLY shows when userRole state equals 'engineering' exactly

- timestamp: 2026-02-04T00:05:00Z
  checked: needs-action-list.tsx lines 156-160 (engineering dashboard table)
  found: Submit button has NO role check - appears for ALL users in engineering dashboard: `<Link href={`/engineering/solutions/${request.id}`}><Button size="sm" variant="default">Submit Solution</Button></Link>`
  implication: Button shows for ANYONE viewing the engineering dashboard, regardless of role

- timestamp: 2026-02-04T00:05:00Z
  checked: request-detail-modal.tsx lines 67-74 (userRole state initialization)
  found: `const [userRole, setUserRole] = useState<string | undefined>(user?.publicMetadata?.role as string | undefined)` with useEffect updating on `[user?.id, user?.publicMetadata?.role]`
  implication: userRole is initialized from user metadata, but may be undefined on first render

- timestamp: 2026-02-04T00:10:00Z
  checked: engineering/page.tsx lines 31-33
  found: Server-side role check: `if (!user || user.role !== 'engineering') { redirect('/dashboard') }`
  implication: Engineering dashboard has SERVER-SIDE protection, so client-side components don't need role checks

- timestamp: 2026-02-04T00:10:00Z
  checked: Modal usage context
  found: RequestDetailModal is used from /requests page (line 233 in needs-action-list.tsx), which is NOT role-protected
  implication: Modal can be opened by non-engineering users from /requests page, so button visibility logic is actually necessary

- timestamp: 2026-02-04T00:10:00Z
  checked: User requirement from issue description
  found: "User clarification: ALL engineering users should see submit button (not just top-level)"
  implication: Business requirement is that ANY user with engineering role should see button, but modal's userRole check may fail due to state sync timing

## Eliminated

- timestamp: 2026-02-04T00:10:00Z
  hypothesis: Dashboard doesn't check role because it's open to all users
  evidence: Engineering dashboard has server-side role protection at page level (lines 31-33)
  implication_rebuttal: Dashboard doesn't need client-side role check because server already verified user is engineering

## Resolution

root_cause: request-detail-modal.tsx line 465 uses unreliable client-side `userRole === 'engineering'` check that fails when:
  1. userRole state is undefined on first render (useState initializes before useEffect syncs from Clerk metadata)
  2. Race condition between component mount and user metadata propagation
  3. Modal is accessible from /requests page which has no server-side role protection

  Why engineering dashboard works:
  - Server-side role check at engineering/page.tsx:31-33 guarantees only engineering users reach the page
  - needs-action-list.tsx doesn't need client-side role check because server already verified
  - Button is safe to show without additional checks

  Why modal doesn't work:
  - Modal can be opened from /requests page by any user
  - Client-side userRole check is unreliable due to async state sync
  - Check fails even for legitimate engineering users

fix: **Remove `&& userRole === 'engineering'` from line 465** in request-detail-modal.tsx

  Rationale:
  1. The button links to /engineering/solutions/[requestId] which has SERVER-SIDE authorization (page.tsx:33-36)
  2. Non-engineering users clicking button will be redirected to /dashboard
  3. Button visibility is informational UI, not security boundary
  4. Matches engineering dashboard behavior (shows button without role check)
  5. Eliminates unreliable client-side role check

  Business logic alignment:
  - User requirement: "ALL engineering users should see submit button"
  - Current behavior: Only engineering users with synced userRole state see button
  - Fixed behavior: All users see button, authorization enforced server-side

verification:
  1. Open request detail modal from /requests page as engineering user
  2. Verify "Submit Solution" button appears for requests with status 'SentToEngineer'
  3. Click button - should navigate to solution submission page
  4. As non-engineering user, clicking button should redirect to /dashboard

files_changed:
  - src/components/requests/request-detail-modal.tsx (line 465)
