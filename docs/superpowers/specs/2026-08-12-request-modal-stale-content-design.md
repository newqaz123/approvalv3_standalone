# Request Modal Stale-Content Prevention Design

**Date:** 2026-08-12

## Problem

On the Requests page, opening request A, closing it, and then opening request B briefly displays request A's details before request B finishes loading. The screen recording confirms this stale-content flash: the second dialog first paints the previous request and then replaces it with the intended request.

`RequestModalRouter` remains mounted while the selected request ID changes. Its `requestData` state still contains the previous request when `loadRequestData()` starts fetching the new ID. The current guard, `if (loading && !requestData)`, only hides the initial load when no prior data exists, so stale data remains renderable during subsequent loads.

## Goal

When a user selects a different request, immediately show an accessible request-detail skeleton for that request and never render details belonging to the previously selected request.

## Scope

### Included

- The shared `RequestModalRouter` used by the Requests page and its other callers.
- A fresh state boundary for every distinct `requestId`.
- An accessible skeleton dialog while request data loads.
- Regression coverage for the state boundary and loading behavior.
- Updating existing regression expectations that currently require the stale-data-preserving loading guard.

### Excluded

- Changing list refresh, polling, filtering, or pagination behavior.
- Changing which user actions close a dialog.
- Refactoring workflow actions or server actions.
- Redesigning loaded request-detail variants.
- Treating the Radix `DialogDescription` warning as the cause of this defect.

## Design

### Keyed state boundary

Keep `RequestModalRouterProps` and the exported `RequestModalRouter` API unchanged. Convert the exported component into a thin wrapper that renders a private stateful component with `key={requestId}`.

Conceptually:

```tsx
export function RequestModalRouter(props: RequestModalRouterProps) {
  return <RequestModalRouterContent key={props.requestId} {...props} />
}
```

All existing router state and behavior move into `RequestModalRouterContent`. A new `requestId` therefore creates a new state instance whose `requestData` begins as `null`. The old instance is unmounted, so a late response from the previous request cannot replace the new request's state.

The key must depend only on `requestId`. It must not include `open`, timestamps, random values, request status, or list data because those would create unnecessary remounts.

### Loading experience

When the current keyed instance is loading and has no request data, render a controlled Radix dialog instead of returning `null`.

The loading dialog will:

- use the incoming `open` value;
- forward close events through `onOpenChange`;
- retain the normal request-detail modal dimensions;
- render `DialogTitle` with “Loading request”;
- render a screen-reader-friendly `DialogDescription` explaining that request details are loading;
- render the existing `RequestDetailSkeleton` component.

This makes the transition immediate and stable: request A closes, request B opens as a skeleton, and request B's content replaces that skeleton only after its own data is ready.

### Missing and failed data

Existing missing-request and load-error callbacks remain unchanged. The keyed boundary must not alter permission checks, modal selection, action completion, or close behavior.

If the request cannot be loaded, the existing `onLoadError` contract remains responsible for notifying callers. No previous request data may be retained as a fallback.

## Data Flow

1. The user opens request A.
2. The wrapper mounts `RequestModalRouterContent` keyed by A.
3. A's instance renders a skeleton, loads A, then renders A.
4. The user closes A. Existing close behavior runs unchanged.
5. The user selects request B.
6. React unmounts A's keyed instance and mounts B's fresh instance.
7. B's instance immediately renders the skeleton because `requestData` is `null`.
8. B's fetch completes and only B's details render.
9. Any late completion from A belongs to the unmounted A instance and cannot paint into B.

## Accessibility

Every loading `DialogContent` must have both a `DialogTitle` and `DialogDescription`. The description may be visually hidden but must remain available to assistive technology. This removes the accessibility warning for this loading path while keeping the warning separate from the stale-content root cause.

## Testing

Add focused regression coverage that verifies source-level wiring consistent with the repository's existing regression suite:

- the exported router renders a private stateful router keyed by `requestId`;
- the key is stable and uses only `requestId`;
- the loading branch renders `Dialog`, `DialogContent`, `DialogTitle`, `DialogDescription`, and `RequestDetailSkeleton`;
- the old `loading && !requestData -> return null` behavior is absent;
- existing router props are forwarded without API changes.

Update `tests/regression/engineering-sub-tasks.test.ts` so it no longer requires the old stale-data-preserving guard. Add the focused stale-content contract in a dedicated regression test file rather than expanding unrelated sub-task assertions.

Run focused regression tests first, then the repository-required `npm run check`. Run `graphify update .` after code changes.

## Success Criteria

- Opening request B after request A never paints request A's title, description, attachments, approval state, or actions.
- A skeleton dialog appears immediately while B loads.
- Request B replaces the skeleton when its own fetch completes.
- Late asynchronous work from A cannot overwrite B.
- Existing request actions and close behavior remain unchanged.
- The loading dialog emits no missing-description accessibility warning.
- All repository checks pass.
