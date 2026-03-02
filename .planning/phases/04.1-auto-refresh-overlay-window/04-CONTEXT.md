# Phase 4.1: Auto Refresh Overlay Window - Context

**Gathered:** 2026-02-06
**Status:** Ready for planning

## Phase Boundary

Implement auto-refresh mechanism to keep request data current without full page reloads. When users take actions (approve, reject, submit, cancel), the system automatically refreshes the affected request data so users see the latest state without manual page refresh.

## Implementation Decisions

### Refresh Triggering
- **Interaction-based refresh**: Auto-refresh happens after user clicks action buttons (approve, reject, submit, cancel)
- **Refresh scope**: Only the affected request refreshes (not entire dashboard)
- **Additional triggers**: Also refresh on tab changes and modal close events
- **Cross-tab behavior**: Refresh happens only in the tab where action occurred (not all open tabs)

### Refresh Scope & UX
- **Full modal refresh**: Replace entire request detail modal content with fresh data from server
- **Loading state**: Show skeleton loading shimmer effect while data is being fetched
- **Completion feedback**: No visual flash when new data arrives (seamless swap)
- **Scope boundaries**: Only refresh the request detail modal, not background lists or dashboard widgets

### User Interaction Handling
- **Form input blocks refresh**: Any interaction with form fields (typing, dropdowns, selections) blocks auto-refresh
- **No indicators**: Silent blocking - user doesn't see any "refresh paused" notification
- **Modal interaction**: Allow refresh only after user clicks action buttons inside modals (not just any modal open state)

### Conflict Resolution
- **Stale data detection**: Check for changes by other users on every action taken
- **Warning banner**: Show yellow/amber warning banner at top of modal: "This request was updated by another user. Click here to refresh."
- **Passive approach**: Banner is informational only, doesn't force refresh or countdown
- **Action trigger**: Conflict check runs every time user takes an action (approve/reject/submit)

### Claude's Discretion
- Exact skeleton loading component design and animation timing
- Implementation details of form interaction detection (event listeners, state tracking)
- Server-side API design for efficient stale data checking (version numbers, timestamps, or ETags)
- Mobile responsiveness of warning banner placement and sizing

## Specific Ideas

- Current user workflow: "When I click approve, I want to see the updated request immediately without manually refreshing"
- Problem to solve: "Now user have to hit manual refresh for see changes"
- Multi-user scenario: When engineer A approves a solution, engineer B viewing the same request should know it changed
- UX preference: No jarring visual transitions - skeleton loading provides smooth perceived performance

## Deferred Ideas

- Real-time push notifications (WebSocket/SSE) for instant updates across all users - belongs in future "Real-time Collaboration" phase
- Cross-tab synchronization using BroadcastChannel API - could be added later if multi-tab usage becomes common
- Optimistic locking with conflict resolution prompts - current approach is passive warning, active resolution could be future enhancement

---

*Phase: 04-auto-refresh-overlay-window*
*Context gathered: 2026-02-06*
