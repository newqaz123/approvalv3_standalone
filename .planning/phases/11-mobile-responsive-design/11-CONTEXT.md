# Phase 11: Mobile-Responsive Design - Context

**Gathered:** 2026-02-16
**Status:** Ready for planning

## Phase Boundary

System works seamlessly on mobile devices (320px to 1920px+). Users can navigate, view requests, approve/reject, and submit new requests with touch-friendly interactions and responsive layouts.

## Implementation Decisions

### Navigation pattern on mobile
- Top tab bar with smart scroll behavior (auto-hide on scroll down, show on scroll up, like Facebook)
- 3 tabs: Dashboard, My Requests, Pending Approvals
- Each tab reloads full page to show fresh data (no state preservation)
- Active tab indicated by different background color
- User profile icon in top tab bar (far right)
- Notifications shown as red badge on Pending Approvals tab with count
- Profile identification: first initial in colored circle

### Information density on mobile
- Dashboard: Simplified with key stats visible, tap to expand details
- Request lists (My Requests, Pending Approvals): Card with key info (topic, status, date, approvals), tap to see description
- Request details open as modal overlay (slides up from bottom, swipe down to close)
- Approval history: Compact timeline with vertical line and small icons, tap to expand full details

### Tables and data grids
- Dashboard tables convert to card view with key-value pairs per row
- Admin tables use consistent card view approach (same as dashboard tables)
- Loading: Infinite scroll for large datasets (50+ rows)
- Search/filter: "Filter" button opens modal with all filter options

### Form layouts on mobile
- Request creation form: Single column stacked (all fields visible, scroll down)
- File upload: Button opens camera capture or file picker options
- Approval actions: Sticky bottom bar always visible with Approve/Reject buttons
- Rejection reason: Modal overlay with text area and Confirm/Cancel buttons

### OpenCode's Discretion
- Exact spacing and typography for mobile layouts
- Loading skeleton design for content states
- Swipe gesture mechanics and thresholds
- Bottom bar styling and button placement
- Filter modal layout and control selection

## Specific Ideas

- "I want the top tab bar to auto-hide on scroll down and appear on scroll up — like Facebook UI"
- Request details should open in a modal that slides up from bottom, swipe down to close
- Approval actions should always be visible via sticky bottom bar on mobile

## Deferred Ideas

None — discussion stayed within phase scope

---

*Phase: 11-mobile-responsive-design*
*Context gathered: 2026-02-16*
