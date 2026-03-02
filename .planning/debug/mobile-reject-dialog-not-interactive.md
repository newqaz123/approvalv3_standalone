---
status: diagnosed
trigger: "On mobile, when tapping the Reject button in request details, a dialog appears but disappears immediately when touched. The dialog is not interactive/cannot be tapped."
created: 2026-02-16T10:30:00.000Z
updated: 2026-02-16T10:40:00.000Z
---

## Current Focus
hypothesis: The custom reject dialog (z-[100]) is rendered inside the drawer component (z-50). The Vaul drawer may be capturing touch events and closing when user taps the dialog, interpreting it as a "tap outside" gesture.
test: Analyzing z-index stacking context and touch event propagation
expecting: Dialog z-index should be higher than drawer and should receive touch events
next_action: Verify if dialog needs to be rendered outside drawer's Portal or use DialogPrimitive instead

## Symptoms
expected: When tapping Reject on mobile, a dialog should appear asking for rejection reason. The dialog should be interactive and allow text input.
actual: Dialog appears but disappears immediately when touched. The dialog is not interactive/cannot be tapped.
errors: None visible
reproduction: On mobile, tap Reject button in request details
started: Unknown (UAT discovered)

## Eliminated

## Evidence
- timestamp: 2026-02-16T10:35:00.000Z
  checked: src/components/mobile/mobile-approval-actions.tsx lines 141-197
  found: Custom reject dialog rendered with fixed positioning and z-[100]. Dialog is NOT using Radix DialogPrimitive, but custom div with backdrop onClick handler (line 146).
  implication: Dialog is rendered inside the drawer's React tree, not in a separate portal

- timestamp: 2026-02-16T10:35:00.000Z
  checked: src/components/mobile/request-drawer.tsx lines 30-45
  found: Drawer.Overlay and Drawer.Content both have z-50. Drawer uses Vaul library which has built-in dismissal behaviors.
  implication: Any touch outside Drawer.Content triggers drawer close. The custom dialog at z-[100] is still within the drawer's event capture scope.

- timestamp: 2026-02-16T10:35:00.000Z
  checked: Dialog component structure
  found: Radix DialogPrimitive.DialogContent uses DialogPortal (line 36) which renders dialog at document.body level, outside parent component tree
  implication: The mobile reject dialog should use DialogPrimitive instead of custom div to escape drawer's event capture

- timestamp: 2026-02-16T10:38:00.000Z
  checked: src/components/requests/cancel-request-dialog.tsx (working example)
  found: Uses AlertDialog from Radix UI (line 82) which properly portals content outside parent tree. AlertDialogContent (line 88) is not affected by parent's z-index context.
  implication: Confirms that using Radix Dialog/AlertDialog primitives would fix the mobile issue

- timestamp: 2026-02-16T10:38:00.000Z
  checked: Vaul drawer behavior documentation and implementation
  found: Vaul drawers capture pointer events and dismiss on click outside (line 33 overlay with onClick). Custom dialog div at z-[100] is visually above but still part of drawer's React component tree.
  implication: Touch events propagate to drawer overlay, triggering dismissal. Dialog needs to be in separate portal to receive events independently.

## Resolution
root_cause: The custom reject dialog in MobileApprovalActions (lines 141-197) is implemented as a regular div with z-[100], rendered within the RequestDrawer component's React tree. Although visually layered above the drawer (z-50), it remains within the drawer's event capture context. When users tap the dialog, the Vaul drawer's overlay receives the touch event and interprets it as a "click outside" gesture, closing the drawer and dismissing the dialog.

The fix is to replace the custom dialog implementation with Radix UI's AlertDialog component, which uses a Portal to render content at the document.body level, completely escaping the parent drawer's stacking context and event capture.

fix: Replace custom div dialog (lines 141-197) with Radix AlertDialog component
verification: UNVERIFIED - needs implementation and mobile testing
files_changed: []
