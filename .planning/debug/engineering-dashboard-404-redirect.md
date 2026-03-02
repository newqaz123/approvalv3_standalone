---
status: diagnosed
trigger: "Engineering dashboard has 404 error and incorrect redirect"
created: 2026-02-04T00:00:00Z
updated: 2026-02-04T00:00:03Z
---

## Current Focus
hypothesis: ROOT CAUSE CONFIRMED - Two distinct bugs identified and documented
test: Code review complete - both bugs found in source files with exact line numbers
expecting: ROOT CAUSE FOUND - ready to provide diagnosis
next_action: Return structured diagnosis to user

## Symptoms
expected: "All Engineering Requests" tab should display list; "Review & Approve" should open modal
actual: "All Engineering Requests" causes 404; "Review & Approve" redirects to /requests?page
errors: 404 error
reproduction: Navigate to /engineering, click "All Engineering Requests" tab
started: Unknown

## Eliminated

## Evidence
- timestamp: 2026-02-04T00:00:01Z
  checked: /Users/red-copperpot/Documents/MyProjects/ApprovalAppV2/src/app/(dashboard)/engineering/page.tsx (lines 138-154)
  found: Tab navigation at line 148 has `<a href="/engineering/requests">` but this route does not exist
  implication: Clicking "All Engineering Requests" tab causes 404 because the route file is missing

- timestamp: 2026-02-04T00:00:01Z
  checked: File system for engineering routes
  found: Only two files exist: /engineering/page.tsx and /engineering/solutions/[requestId]/page.tsx
  implication: No /engineering/requests route exists, confirming the 404

- timestamp: 2026-02-04T00:00:01Z
  checked: /Users/red-copperpot/Documents/MyProjects/ApprovalAppV2/src/components/engineering/needs-action-list.tsx (lines 204-216)
  found: "Review & Approve" button uses `window.location.href = `/requests?open=${request.id}`` (line 211)
  implication: This causes full page navigation to /requests instead of opening a modal as expected

- timestamp: 2026-02-04T00:00:01Z
  checked: Button click handler implementation
  found: onClick handler directly sets window.location.href with no modal logic
  implication: The comment at line 209 says "This will be handled by parent component" but there is no parent component handling it

- timestamp: 2026-02-04T00:00:02Z
  checked: /Users/red-copperpot/Documents/MyProjects/ApprovalAppV2/src/components/requests/request-table.tsx (lines 40-48, 162-168)
  found: Correct pattern uses useState for selectedRequestId and isModalOpen, with handleRowClick setting both states
  implication: The needs-action-list component should follow the same pattern with state management and modal rendering

- timestamp: 2026-02-04T00:00:02Z
  checked: RequestDetailModal component signature (lines 33-42 of request-detail-modal.tsx)
  found: Modal accepts requestId, open, and onOpenChange props
  implication: Component needs to maintain state and pass these props to RequestDetailModal

## Resolution
root_cause: Two distinct bugs found:

**Bug 1: Missing Route**
- Location: /Users/red-copperpot/Documents/MyProjects/ApprovalAppV2/src/app/(dashboard)/engineering/page.tsx:148
- Tab navigation links to `/engineering/requests` but this route file doesn't exist
- Clicking "All Engineering Requests" causes 404 error

**Bug 2: Incorrect Navigation Handler**
- Location: /Users/red-copperpot/Documents/MyProjects/ApprovalAppV2/src/components/engineering/needs-action-list.tsx:208-212
- "Review & Approve" button uses `window.location.href = \`/requests?open=${request.id}\``
- This causes full page navigation to /requests?page instead of opening modal
- Should follow same pattern as request-table.tsx with useState and RequestDetailModal

fix:
**Fix 1 - Create missing route:**
Option A: Create /engineering/requests/page.tsx that lists all engineering requests
Option B: Change tab href to `/engineering?tab=all` and handle tab filtering client-side
Option C: Remove the tab if functionality not needed

**Fix 2 - Update needs-action-list.tsx:**
1. Import RequestDetailModal
2. Add state: `const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null)` and `const [isModalOpen, setIsModalOpen] = useState(false)`
3. Replace window.location.href with: `setSelectedRequestId(request.id); setIsModalOpen(true);`
4. Add RequestDetailModal component at bottom: `<RequestDetailModal requestId={selectedRequestId} open={isModalOpen} onOpenChange={setIsModalOpen} />`

verification: Not yet verified
files_changed: []
