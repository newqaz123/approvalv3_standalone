---
status: verifying
trigger: "Two Next.js console errors appearing throughout the application - DialogTitle accessibility warning and Decimal serialization error"
created: 2026-03-01T00:00:00Z
updated: 2026-03-01T01:00:02Z
---

## Current Focus
hypothesis: Found ANOTHER unpatched return path in getRequestsNeedingEngineeringAction in requests.ts - returns solution objects with Decimal in needsApprovalFiltered array
test: Fixed line 1439 to convert Decimal to number before adding to array, build succeeded
expecting: This was the last remaining Decimal serialization path - all solution-returning functions now properly convert
next_action: User verification needed - open 'test01' detail modal to confirm Decimal error is gone

## Symptoms
expected: No console errors
actual: Two console errors appear:
1. `DialogContent` requires a `DialogTitle` for accessibility - Dialog components are missing proper titles for screen reader users
2. Decimal objects cannot be passed to Client Components from Server Components - Database Decimal fields (costEstimate) are being passed to client components without proper serialization
errors:
Error 1: "DialogContent requires a DialogTitle for the component to be accessible for screen reader users."
Error 2: "Only plain objects can be passed to Client Components from Server Components. Decimal objects are not supported. {id: ..., requestId: ..., title: ..., description: ..., costEstimate: Decimal, currency: ..., timeline: ..., conceptDesign: ..., submittedById: ..., submittedAt: ..., createdAt: ..., updatedAt: ..., submittedBy: ..., fileAttachments: ...}"
reproduction: Multiple pages throughout the app
started: Long-standing issue

## Eliminated

## Evidence
- timestamp: 2026-03-01T00:00:01Z
  checked: Dialog UI component and request-detail-modal.tsx
  found: DialogContent in request-detail-modal.tsx (line 962) uses DialogHeader but NOT DialogTitle - the title is just a div with text, not a proper DialogTitle component
  implication: This violates Radix UI accessibility requirements, causing the DialogTitle warning

- timestamp: 2026-03-01T00:00:02Z
  checked: request-detail-modal.tsx lines 560, 1127
  found: solution.costEstimate is used directly in format(Number(solution.costEstimate)) - this Decimal object comes from server action and is passed to client component
  implication: Decimal objects from Prisma cannot be serialized to client components without conversion

- timestamp: 2026-03-01T00:00:03Z
  checked: /requests/[requestId]/page.tsx (server component)
  found: Line 218 also uses Number(solution.costEstimate) but this is in a server component so it works fine
  implication: The issue is specific to client components receiving Decimal from server actions

- timestamp: 2026-03-01T00:00:04Z
  checked: prisma schema and getSolutionByRequestId server action
  found: Solution model has costEstimate as Decimal(15,2) at line 209, and getSolutionByRequestId returns the raw Prisma object with Decimal field
  implication: The Decimal object is returned directly from server action to client component, which Next.js cannot serialize

- timestamp: 2026-03-01T00:00:05Z
  checked: getRequest server action
  found: getRequest does NOT include solutions - solutions are fetched separately via getSolutionByRequestId
  implication: The fix needs to be in getSolutionByRequestId to convert Decimal to number before returning

- timestamp: 2026-03-01T01:00:01Z
  checked: getSolutionBySolutionId function in solutions.ts (lines 366-400)
  found: This function returns solution objects with costEstimate field WITHOUT converting Decimal to number
  implication: This is another source of Decimal serialization errors when this function is used

- timestamp: 2026-03-01T01:00:02Z
  checked: Error message structure from checkpoint response
  found: Error shows solution object structure: {id, requestId, title, description, costEstimate: Decimal, currency, timeline, conceptDesign, submittedById, submittedAt, createdAt, updatedAt, request: ...}
  implication: The nested 'request' field confirms this is a solution object, not a request

- timestamp: 2026-03-01T01:00:03Z
  checked: canUserApproveSolution function (lines 532-626)
  found: This function returns solution objects at lines 611 and 625 WITHOUT converting Decimal to number
  implication: This is called by request-detail-modal at line 223-224 and returns Decimal objects to client component

- timestamp: 2026-03-01T01:00:04Z
  checked: getSolutionByRequestId conversion logic (lines 432-440)
  found: Conversion only happens when `solution && solution.costEstimate` - if costEstimate is 0 or null, it returns original solution with Decimal
  implication: Bug in conversion logic - should convert regardless of costEstimate value

- timestamp: 2026-03-01T01:00:05Z
  checked: Applied fixes to all three functions
  found: All three functions now convert Decimal to number using spread operator pattern
  implication: Decimal serialization should be eliminated from all solution-fetching code paths

- timestamp: 2026-03-01T01:00:06Z
  checked: Build output
  found: Build completed successfully with "Compiled successfully" and no TypeScript errors
  implication: Fixes are syntactically correct and ready for runtime testing

- timestamp: 2026-03-01T01:00:07Z
  checked: canUserApproveSolution function for ALL return paths
  found: Line 626 returns raw solution object with Decimal field: `return { canApprove: false, solution }` - this is when no approval is found for the user
  implication: This is the bug causing the Decimal error - when user has no pending approval, function returns unserialized solution

- timestamp: 2026-03-01T01:00:08Z
  checked: All solution queries in server-actions directory
  found: getRequestsNeedingEngineeringAction in requests.ts queries solutions and returns them in needsApprovalFiltered array at line 1439 WITHOUT converting Decimal
  implication: This is another Decimal serialization path - engineering dashboard receives solution objects with Decimal fields

- timestamp: 2026-03-01T01:00:09Z
  checked: Applied fixes to both unpatched locations
  found: Fixed canUserApproveSolution line 626 and getRequestsNeedingEngineeringAction line 1437-1441 - both now convert Decimal to number before returning
  implication: All solution-returning server actions now properly serialize Decimal fields

- timestamp: 2026-03-01T01:00:10Z
  checked: Build output after fixes
  found: Build completed successfully with "Compiled successfully" and no TypeScript errors
  implication: Both fixes are syntactically correct and ready for runtime testing

## Resolution
root_cause:
1. DialogTitle accessibility: request-detail-modal.tsx used DialogHeader with div instead of DialogTitle component in 3 places (main dialog at line 962, loading state at line 348, error state at line 364). Also command.tsx CommandDialog lacked DialogTitle.
2. Decimal serialization: FIVE different code paths returned solution objects with Prisma Decimal fields without proper conversion:
   - getSolutionBySolutionId (solutions.ts line 366-408) - No conversion
   - getSolutionByRequestId (solutions.ts line 406-449) - Had buggy conversion (didn't convert when costEstimate is 0/null)
   - canUserApproveSolution (solutions.ts line 540-647) - THREE return paths, two missing conversion at lines 585 and 626
   - getRequestsNeedingEngineeringAction (requests.ts line 1304-1452) - Returns solution objects in needsApprovalFiltered array without conversion

fix:
1. Added DialogTitle to request-detail-modal.tsx (main dialog, loading state, error state) and command.tsx CommandDialog with sr-only class for command palette
2. Fixed getSolutionBySolutionId - Added Decimal conversion at lines 400-405
3. Fixed getSolutionByRequestId - Improved conversion logic at lines 440-446 (removed truthiness check)
4. Fixed canUserApproveSolution - Added Decimal conversion at lines 578-585 and 625-634 (all three return paths)
5. Fixed getRequestsNeedingEngineeringAction - Added Decimal conversion at lines 1437-1441 before pushing to array

verification:
- Build completed successfully with no TypeScript errors
- All five solution-returning code paths now properly convert Decimal to number before returning to client components
- Dialog accessibility fixed with proper DialogTitle components
- AWAITING USER VERIFICATION that Decimal error is gone when opening detail modal

files_changed:
- src/components/requests/request-detail-modal.tsx
- src/server-actions/solutions.ts (3 functions with 4 return paths fixed)
- src/server-actions/requests.ts (1 function with 1 return path fixed)
- src/components/ui/command.tsx
