# Canonical Request and Solution Forms Design

**Date:** 2026-09-04
**Status:** Approved design; awaiting written-spec review
**Scope:** Remove obsolete standalone request, request-detail, and solution authoring flows while preserving the active modal workflow

## Purpose

The application currently carries two implementations of New Request and Submit Solution. Users enter the current flows through modal components, but standalone Next.js pages and their private component trees remain in the repository and are still exercised by several tests. This duplication increases maintenance work and allows fixes or behavior to drift between visible and obsolete surfaces.

This change establishes the modal system as the only supported request-authoring, request-detail, and solution-authoring interface.

## Goals

- Make `SubmitterModal` the only New Request and Submit Solution form implementation.
- Make `RequestModalRouter` the canonical request-detail and workflow router.
- Remove standalone routes and components that are no longer entered by the application.
- Keep “View Original Request” available without losing an in-progress solution draft.
- Preserve all active server actions, validation, authorization, staged uploads, inline images, previews, and approval behavior.
- Move regression and browser coverage from obsolete pages to the active modal surfaces.
- Identify unrelated dead-code candidates without deleting them as part of this change.

## Non-Goals

- No approval-workflow redesign.
- No visual redesign of `SubmitterModal` or the request modals.
- No database or Prisma schema changes.
- No production migration or deployment.
- No deletion of unrelated legacy component clusters during this change.
- No removal of active backend APIs merely because an obsolete client also called them.
- Historical design and implementation records under `docs/superpowers/` will not be rewritten.

## Current Canonical Flows

### New Request

The visible New Request actions in `RequestsListClient` and `FollowUpDashboard` open:

```text
SubmitterModal(mode="request")
  -> createRequest(...)
  -> staged request attachments and inline-image adoption
```

The standalone `/requests/new` page is not linked by the current application. It is the only runtime importer of `src/components/requests/request-form.tsx`.

### Submit Solution

The engineering dashboard opens `RequestModalRouter`. For a request in `SentToEngineer`, the router presents `CompletedRequestModal`; its Submit Solution action opens:

```text
SubmitterModal(mode="solution")
  -> RequestModalRouter callback
  -> submitSolution(...)
  -> staged solution attachments and inline-image adoption
```

The standalone `/engineering/solutions/[requestId]` page is not linked by the active workflow. It is the only runtime importer of `src/components/solutions/solution-form.tsx`.

### Request Details and Deep Links

The supported deep-link mechanism is:

```text
/requests?requestId=<id>
  -> RequestDeepLinkModal
  -> RequestModalRouter
```

The active Submit Solution modal currently links “View Original Request” to the separate `/requests/[requestId]` page. That standalone detail page duplicates the modal detail system and will be retired.

## Route Decisions

Delete these page routes completely:

- `src/app/(dashboard)/requests/new/page.tsx`
- `src/app/(dashboard)/engineering/solutions/[requestId]/page.tsx`
- `src/app/(dashboard)/requests/[requestId]/page.tsx`

The deleted URLs intentionally return the normal Next.js 404 response:

- `/requests/new`
- `/engineering/solutions/<request-id>`
- `/requests/<request-id>`

No compatibility redirect will be retained for these URLs.

The active “View Original Request” control will instead open this URL in a new browser tab:

```text
/requests?requestId=<encoded-request-id>
```

Opening a new tab is deliberate: the engineer can inspect the canonical request modal without closing or resetting the in-progress solution modal and its staged draft attachments.

## Component Removal

Remove the obsolete request-form tree:

- `src/components/requests/request-form.tsx`
- `src/components/mobile/mobile-file-upload.tsx`

`mobile-file-upload.tsx` has no runtime importer outside the obsolete request form.

Remove the obsolete standalone solution-form tree:

- `src/components/solutions/solution-form.tsx`
- `src/components/solutions/solution-file-upload.tsx`
- `src/components/solutions/solution-preview.tsx`
- `src/lib/attachments/upload-progress.ts`
- `src/lib/attachments/upload-batch.ts`

`solution-file-upload.tsx` and `solution-preview.tsx` have no runtime importer outside the obsolete solution form. `upload-progress.ts` is used in production only by `solution-preview.tsx`, and `upload-batch.ts` is then used in production only as the type/utility source for `upload-progress.ts`; both become transitively orphaned with the standalone solution tree and will be removed with their obsolete-only tests.

## Code That Must Remain

The following code is active and is explicitly outside the deletion set:

- `src/components/requests/submitter-modal.tsx`
- `src/components/requests/request-modal-router.tsx`
- `src/components/requests/request-deep-link-modal.tsx`
- `src/hooks/use-staged-request-attachments.ts`
- `src/hooks/use-staged-solution-attachments.ts`
- `src/hooks/use-inline-description-images.ts`
- `src/server-actions/requests.ts#createRequest`
- `src/server-actions/solutions.ts#submitSolution`
- `src/server-actions/solutions.ts#resubmitSolution`
- Request and solution schemas and attachment storage/policy code

`src/components/solutions/custom-approval-picker.tsx` must remain because `final-approval-actions.tsx` and the hierarchy-picker harness still use it.

`uploadFileAction` must remain because `src/components/requests/file-upload-zone.tsx` still calls it.

## Link and Cache Invalidation Cleanup

Change the “View Original Request” link in `SubmitterModal` from `/requests/<id>` to the canonical `/requests?requestId=<encoded-id>` URL. Preserve `target="_blank"` and `rel="noopener noreferrer"`.

Remove cache invalidations that target deleted routes:

- `/requests/new`
- `/requests/<request-id>`

`revalidateRequestViews` will revalidate the canonical list and dashboard paths only. Its obsolete request-ID parameter will be removed, and callers will be updated mechanically to call it without an argument. This does not change request selection or authorization; those IDs remain in each caller for their primary operation.

## Test Strategy

Implementation follows test-driven development.

### New removal contract

First add a regression test that fails against the current repository and asserts:

- All three obsolete page files are absent.
- All five obsolete private component files and both transitively orphaned attachment helper files are absent.
- Runtime source does not import those files.
- `SubmitterModal` links “View Original Request” through `/requests?requestId=` and keeps new-tab protections.
- `RequestModalRouter` still calls the active `submitSolution` action.
- New Request callers still render `SubmitterModal` in request mode.

The absence checks are intentional architectural boundaries: they prevent a second form implementation from being reintroduced accidentally.

### Existing regression tests

Tests that read or render `RequestForm`, `SolutionForm`, `SolutionFileUpload`, or `SolutionPreview` will be changed as follows:

- Delete assertions that exist only to protect an obsolete surface.
- Move shared behavior assertions to `SubmitterModal` when that behavior is part of the active request or solution flow.
- Retain coverage for rich-text limits, inline-image blocking, discard confirmation, staged attachment readiness, retry/remove fencing, preview, and ID-only server-action payloads.
- Keep tests for shared code that remains active, including the shared custom approval picker.
- Remove narrow-page layout contracts for deleted routes.

Tests must not be weakened by merely deleting all corresponding assertions. Each behavior still used by the modal flow remains covered on the modal flow.

### Browser tests

Update browser tests that navigate directly to deleted pages:

- New Request scenarios navigate to `/requests`, click New Request, and exercise `SubmitterModal(mode="request")`.
- Submit Solution scenarios navigate through the engineering dashboard and current request modal into `SubmitterModal(mode="solution")`.
- Request-detail verification uses `/requests?requestId=<encoded-id>` and waits for `RequestDeepLinkModal`/`RequestModalRouter` content.
- Network instrumentation follows the active page URL and `/api/attachments/stage` rather than the deleted standalone route URL.

The environment-backed upload release gate remains a release gate; this cleanup changes its entry path, not its upload, authorization, filename, or metadata assertions.

## Documentation

Update `docs/MODAL-FLOW.md` to state that:

- New Request and Submit Solution are modal-only flows.
- `/requests?requestId=<id>` is the canonical request deep link.
- The three standalone routes were intentionally retired.

Historical specs and plans remain unchanged as an audit trail.

## Unrelated Dead-Code Report

After the scoped removal, perform a static import/reachability audit and report unrelated candidates without deleting them. Confirmed candidates to include in that report are:

- `src/components/requests/request-detail-modal.tsx`
- `src/components/requests/request-detail-desktop.tsx`
- `src/components/requests/request-detail-desktop-v2.tsx`
- `src/components/requests/request-detail-desktop-example.tsx`

These files form a separate legacy detail-view cluster. Their removal may affect a broader set of old presentation helpers and tests and therefore requires a separate approved cleanup.

## Risks and Mitigations

### External bookmarks return 404

This is an explicit product decision. Current in-app links will use the canonical modal deep link before the legacy pages are removed.

### Tests may falsely imply lost coverage

Every test deletion will be classified as obsolete-only or migrated to the active modal. The final diff will make those replacements reviewable.

### Active server actions could be mistaken for dead code

Client reachability is traced independently from backend use. `createRequest`, `submitSolution`, `resubmitSolution`, schemas, and upload hooks remain because the modal workflow calls them.

### Closing the solution modal could discard work

“View Original Request” continues opening a new tab, so inspecting the request does not unmount the form or trigger draft cleanup.

## Verification

Run, through Portly where applicable:

1. The new legacy-flow removal regression test in its failing state.
2. Targeted changed regression tests after implementation.
3. `npm run check`.
4. Playwright test discovery for changed E2E specifications.
5. Relevant live E2E gates only when their required test environment variables and managed server are available.
6. `graphify update .` after code changes.
7. A final source scan for imports and links to deleted routes/components.

No production migration will be run.

## Completion Criteria

The change is complete when:

- The three legacy URLs have no page implementation and return 404.
- The ten obsolete page/component/helper files are deleted.
- All visible New Request and Submit Solution actions use `SubmitterModal`.
- “View Original Request” opens the canonical request modal deep link in a new tab.
- Active request and solution submission server actions remain wired.
- Relevant behavioral coverage has moved to the modal flow.
- `npm run check` passes.
- Playwright discovers the updated E2E suite successfully.
- Graphify is updated.
- Unrelated dead-code candidates are reported but untouched.
