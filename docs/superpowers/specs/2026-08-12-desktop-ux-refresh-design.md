# Approval App Desktop UX Refresh Design

**Date:** 2026-08-12  
**Status:** Approved for planning  
**Selected direction:** Open Design variant A — Adaptive wide canvas

## Summary

The authenticated Approval App uses a `max-w-7xl` desktop shell that leaves excessive unused space on large monitors and forces operational tables to wrap important values. This refresh introduces a shared adaptive desktop canvas, tightens the desktop navbar, improves the Requests filter and table hierarchy, and adds visible inline search to every custom approval hierarchy picker.

The work is presentation- and interaction-focused. Existing permissions, routes, request filtering contracts, server actions, modal routing, refresh behavior, notification polling, and approval workflows remain unchanged.

## Design Reference

Open Design project: **Approval App Desktop UX Refresh** (`approval-app-desktop-ux-refresh`)  
Entry artifact: `approval-system-ux-study.html`  
Studio: <http://127.0.0.1:59340/projects/approval-app-desktop-ux-refresh/conversations/d001c0de-9013-4f50-9af8-6f3b4924f1c7>

The artifact compares three density directions. Production will follow **A — Adaptive wide canvas**, adjusted to preserve the application's existing brand text, Lucide navigation icons, semantic status colors, and live behavior. It will not introduce the artifact's illustrative data, extra Apply button, extra Export action, or a new logo.

## Goals

1. Use large desktop screens more effectively without making focused forms uncomfortably wide.
2. Align the desktop navbar and authenticated page content to one shared canvas.
3. Make the Requests filters easier to scan and use across desktop and tablet widths.
4. Give the request title and operational metadata predictable table space.
5. Make every custom hierarchy selector searchable by the user information already available in that flow.
6. Preserve current mobile navigation and request-card behavior.

## Non-goals

- No route, information-architecture, role, permission, or navigation-item changes.
- No changes to request filter types, API query parameters, polling, pagination, or server actions.
- No changes to request modal selection, close behavior, or refresh callbacks.
- No migration, seed, or production database change.
- No broad typography, color, dark-mode, dashboard-card, or mobile-card redesign.
- No consolidation of all hierarchy workflows into one picker component in this task.
- No new filter result counts because the current API does not provide facet counts.

## 1. Shared Authenticated Canvas

### Outer shell

Create one shared authenticated-shell utility used by:

- the dashboard layout,
- both admin route layouts, and
- the desktop navbar inner container.

The utility provides:

- `width: 100%`,
- a maximum width of **1720px**,
- centered alignment,
- horizontal gutters of **16px on phones**, **24px on small/tablet screens**, **32px on desktop**, and **40px on very wide screens**.

Navbar content and page content must share the same left and right edges.

### Wide versus focused content

The shared shell is the outer boundary, not a command to stretch every control.

Wide operational surfaces—Requests, My Actions, Dashboard, Engineering, Analytics, Budget Monitor, and admin list/overview pages—may use the full shell width and must not add a redundant `max-w-7xl` or Tailwind `container` cap.

Focused surfaces—profile, password change, create/edit forms, solution forms, and request-detail pages—retain their existing narrower inner maximum widths inside the shared shell.

### Responsive handoff

The existing mobile navigation remains the small-screen navigation. The desktop navbar appears from the `lg` breakpoint. Between `lg` and wide desktop widths, the navbar uses compact gaps and hides secondary user metadata before allowing links to wrap or overflow.

## 2. Desktop Navbar

The navbar remains a white, bordered, 64px-high product bar.

### Brand and navigation

- Render **Approval System** on one line at desktop sizes.
- Retain the existing Lucide icons and role-aware link set.
- Use compact 44px-minimum-height link targets with restrained neutral active and hover states.
- Keep pending-action badges inline and stable rather than floating far outside their link bounds.
- Preserve `aria-current`, pending-action accessible labels, routes, and role checks.

### User controls

- Keep the notification bell, user menu, profile links, approval-chain link, password link, and sign-out behavior unchanged.
- Use a compact name/avatar cluster.
- Hide role/email copy at constrained desktop widths; reveal it only when enough space is available.
- Preserve the existing click-outside behavior and relative `/sign-in` logout callback.

## 3. Requests Header and Filters

### Page header

Keep the current title, supporting copy, role-specific bulk-delete action, and New Request action. Align the heading and actions to the wider shell and retain the current mobile stacking behavior.

### Filter structure

Keep the existing immediate filter behavior and `GetRequestsFilters` payload. Do not add an Apply step.

Arrange controls in two visual tiers:

1. **Primary query tier**
   - title/description search receives the largest share of width;
   - department and requester selectors;
   - from/to date inputs;
   - the existing no-WR toggle;
   - contextual **Clear all** when filters differ from defaults.
2. **Status tier**
   - the existing seven multi-select statuses displayed as wrapping labeled checkbox facets;
   - selection remains driven by real checkbox state, not color alone.

### Responsive behavior

- Very wide desktop: primary controls fit on one row.
- Laptop/tablet: controls reflow to three and then two columns without shrinking below usable widths.
- Phone: one column; status facets wrap naturally.
- Every control keeps a minimum 40–44px interaction height and a visible keyboard focus state.

Filter fetch, refresh events, and loading/error behavior remain unchanged.

## 4. Requests Table and Rows

### Desktop table

The desktop table remains the `md`-and-up representation; existing mobile request cards remain unchanged.

Use a stable minimum table width with explicit title-first column proportions. The title gets roughly one third of available width. Requester, status, approval status, PIC, and department receive predictable middle widths. Files stays compact, and Created is wide enough to remain on one line.

### Row anatomy

- Target an approximately **60px minimum row height**.
- Allow mixed Thai/English titles to use up to two natural lines without forcing unrelated columns to wrap.
- Keep Created dates on one line.
- Keep status badges, attachment counts, and PIC content vertically aligned.
- Use quiet separators and a restrained row hover background.
- Preserve the existing sky-tinted WR-received row state.
- Add a visible focus state and Enter/Space activation for keyboard users while preserving click-to-open behavior.
- Preserve `RequestListRow`, TanStack Table use, selected request state, `RequestModalRouter`, `onDataRefresh`, and empty state behavior.

## 5. Searchable Custom Approval Hierarchies

The repository contains several hierarchy picker implementations with different workflow-specific behavior. This task standardizes search presentation and filtering without replacing those workflows with one large shared picker.

### Covered flows

Search must be present in:

- the shared solution `CustomApprovalPicker`,
- solution submission/resubmission in `SubmitterModal`,
- final approval submission,
- final approval resubmission, and
- the legacy solution modal picker.

### Shared search behavior

Introduce a small reusable search presentation/helper that can work with each picker's existing user shape and selection callbacks.

- The search field is clearly visible whenever available approvers are shown.
- Match case-insensitively against **name**, **email**, and **role or level text when that metadata exists**.
- Exclude the current user and already-selected approvers exactly as each flow does today.
- Show a live visible result count.
- Place results in a bounded scroll region instead of allowing the list to grow across the modal.
- Show **No approvers found** when the query has no matches.
- Show the existing no-more-users message when selection, rather than search, exhausts the list.
- Clear the query after selection and when the picker closes.
- Focus the search field when the picker opens where the current popover structure permits it.
- Preserve selected order, move up/down, remove, disabled, and workflow submission behavior.

The shared solution picker already has a `CommandInput`; it receives the same width, result-count, metadata, bounded-list, reset, and empty-state treatment as the other flows.

## 6. Accessibility and Interaction Requirements

- Desktop navigation and request rows have visible `focus-visible` styles.
- Navbar links retain text labels and `aria-current`.
- Notification and pending-action counts retain accessible labels.
- Status filters remain label-associated checkbox controls.
- The no-WR control retains `aria-pressed`.
- Search fields have visible or accessible labels and meaningful placeholders.
- Search result counts are exposed as status text without moving focus.
- Empty hierarchy results provide explicit text rather than an empty panel.
- No information is available only on hover or by color.
- Reduced-motion preferences continue to be respected; this work adds no decorative animation.

## 7. Data Flow and Error Handling

No server data contract changes are required.

- Requests filtering still emits the same filter object and fetches `/api/requests` with the existing query serialization.
- Request data refresh events and polling remain unchanged.
- Hierarchy search is derived client-side from users already supplied to each picker.
- Empty searches and exhausted user lists are normal UI states, not errors.
- Existing request loading, fetch failure, modal error, and toast behavior remain unchanged.

## 8. Testing and Verification

Implementation follows TDD with focused regression coverage before production changes.

### Automated contracts

Add regression coverage for:

- the shared 1720px shell utility and its use by dashboard/admin layouts and navbar;
- the desktop/mobile navbar breakpoint handoff and compact metadata behavior;
- Requests' two-tier responsive filter structure without an Apply-step contract change;
- desktop table minimum width, title-first proportions, row focus/keyboard behavior, and non-wrapping dates;
- unchanged mobile request-card rendering;
- visible hierarchy search, name/email/role matching, result count, empty state, bounded results, and reset behavior in every covered flow.

### Verification sequence

1. Run focused regression tests while implementing each unit.
2. Run primary LSP diagnostics on all touched TypeScript/TSX files.
3. Run `npm run check`.
4. Run `git diff --check`.
5. Run `graphify update .`.
6. Build/test against the Docker-backed app and existing database without migrations or seed changes.
7. Browser-check wide desktop, laptop, and mobile viewports.

### Browser acceptance scenarios

- Navbar and page edges align on Requests, My Actions, Engineering, Analytics/Budget, and an admin list page.
- Wide Requests view uses materially more screen width without horizontal page overflow.
- Filters reflow cleanly at desktop, laptop, and phone widths and still return correct data.
- Desktop request rows open the correct request by mouse and keyboard.
- Created dates do not wrap at the intended desktop widths.
- Existing mobile request cards remain usable.
- Every custom hierarchy flow can find an approver by name, email, and available role/level metadata; no-result and exhausted-list states are clear.

## Acceptance Criteria

The design is complete when:

1. Authenticated wide pages share a maximum 1720px canvas aligned with the navbar.
2. Focused forms retain appropriate inner widths.
3. The desktop navbar remains usable without wrapping or clipping from `lg` upward.
4. Requests filters and rows are more compact and scannable while preserving all current behavior.
5. The desktop table gives titles materially more room and keeps dates on one line.
6. Mobile navigation and request cards remain unchanged in function.
7. All custom approval hierarchy flows expose consistent inline search and empty states.
8. No permissions, workflow, request API, modal, polling, or server-action behavior changes.
9. Focused tests, `npm run check`, diagnostics, Graphify refresh, and Docker-backed browser checks pass.
