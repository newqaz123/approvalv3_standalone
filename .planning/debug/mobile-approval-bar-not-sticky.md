---
status: diagnosed
trigger: "On mobile, when viewing request details in the bottom sheet drawer, the Approve/Reject buttons stay in the desktop layout position instead of appearing in a sticky bottom bar."
created: 2026-02-16T10:30:00Z
updated: 2026-02-16T10:30:00Z
---

## Current Focus
hypothesis: The MobileApprovalActions component is rendered inside the scrollable content area instead of in the RequestDrawerFooter, causing it to scroll with content instead of being sticky
test: Check the location of MobileApprovalActions rendering in RequestContent component
expecting: Find that MobileApprovalActions is wrapped in RequestDrawerFooter but placed inside scrollable area
next_action: Verify exact positioning and structure of approval actions rendering

## Symptoms
expected: Approval actions (Approve/Reject buttons) should be in a sticky bar at the bottom of the mobile drawer
actual: Approve/Reject buttons stay in desktop layout position instead of appearing in sticky bottom bar
errors: None
reproduction: View request details in mobile bottom sheet drawer
started: Not specified (assumed existing issue)

## Eliminated

## Evidence
- timestamp: 2026-02-16T10:30:00Z
  checked: RequestDrawer component structure
  found: RequestDrawer has scrollable content area at lines 61-63, and RequestDrawerFooter component exists at lines 71-91 for sticky bars
  implication: The infrastructure for sticky footer exists, but may not be used correctly

- timestamp: 2026-02-16T10:30:00Z
  checked: MobileApprovalActions component implementation
  found: Component renders correctly with flex gap-3 layout (lines 107-138)
  implication: The component itself is properly implemented

- timestamp: 2026-02-16T10:30:00Z
  checked: RequestDetailModal conditional rendering for approval actions (lines 477-507)
  found: MobileApprovalActions IS wrapped in RequestDrawerFooter (line 482), BUT this is INSIDE the RequestContent component which is rendered inside the scrollable area (line 889)
  implication: ROOT CAUSE IDENTIFIED - RequestDrawerFooter is inside the scrollable content area, so it cannot be sticky. The sticky bottom-0 CSS on RequestDrawerFooter has no effect because its parent (the scrollable div) scrolls away

- timestamp: 2026-02-16T10:30:00Z
  checked: RequestDrawer structure and how it renders children
  found: RequestDrawer renders ALL children inside the scrollable div (lines 61-63). There is NO provision for rendering sticky footer content outside the scrollable area
  implication: The RequestDrawer component needs structural changes to support sticky footers. Currently, it only has one children slot inside the scrollable area

## Resolution
root_cause: The RequestDrawer component only has one children slot which renders inside the scrollable content area (lines 61-63). The RequestDrawerFooter component with sticky positioning is rendered inside RequestContent, which is inside the scrollable area. CSS sticky positioning requires the element to be a direct child of the scrolling container, but more importantly, it cannot work when the entire content structure (including the "footer") is inside the scrollable div.

The issue is in the component structure:
1. RequestDrawer has a single children prop rendered inside scrollable div (line 62)
2. RequestDetailModal renders RequestContent which includes the RequestDrawerFooter
3. RequestContent is passed as children to RequestDrawer (line 889)
4. Therefore, the footer scrolls with content instead of being sticky

fix: The RequestDrawer component needs to accept a separate footer prop (or use a render prop pattern) to render content outside the scrollable area. The structure should be:
- Scrollable content area (flex-1, overflow-y-auto)
- Sticky footer area (flex-shrink-0, outside scrollable area)

Then RequestDetailModal needs to split RequestContent into content and footer portions, passing the footer separately to RequestDrawer.

files_changed:
- /Users/red-copperpot/Documents/MyProjects/ApprovalAppV2/src/components/mobile/request-drawer.tsx - Add footer prop support
- /Users/red-copperpot/Documents/MyProjects/ApprovalAppV2/src/components/requests/request-detail-modal.tsx - Separate footer content from main content
