# Canonical Request and Solution Forms Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the obsolete standalone request, request-detail, and solution form routes and make the existing modal workflow the sole supported UI without weakening submission coverage.

**Architecture:** `SubmitterModal` remains the single request/solution authoring component, and `RequestModalRouter` remains the single request-detail/workflow component. Legacy page entry points, their private component trees, and transitively orphaned upload helpers are deleted; request deep links use `/requests?requestId=<id>`, while active server actions and staged-upload hooks remain unchanged.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Node test runner through `tsx`, Playwright, Prisma-backed server actions, Portly process management, Graphify

**Spec:** `docs/superpowers/specs/2026-09-04-canonical-request-solution-forms-design.md`

## Global Constraints

- Do not change `createRequest`, `submitSolution`, or `resubmitSolution` behavior, schemas, authorization, transactions, or attachment adoption.
- Keep `SubmitterModal`, `RequestModalRouter`, both staged-attachment hooks, inline-image coordination, `CustomApprovalPicker`, and `uploadFileAction`.
- Deleted `/requests/new`, `/requests/<request-id>`, and `/engineering/solutions/<request-id>` routes intentionally return 404; do not add redirects.
- “View Original Request” must open `/requests?requestId=<encoded-id>` in a new tab with `rel="noopener noreferrer"`.
- Migrate active behavioral coverage to modal surfaces; do not retain tests solely for removed components.
- Do not modify historical files under `docs/superpowers/specs/` or `docs/superpowers/plans/`, except this plan and its approved spec correction.
- Do not touch the pre-existing untracked `docs/superpowers/plans/2026-09-03-xhr-solution-staged-attachments.md` or `presentation-output/`.
- Do not run production migrations.
- Use Portly for every test/build command: begin with `portly status`, then run bounded jobs with `portly temp` and `portly wait`.
- Run `graphify update .` after source changes.
- Each task is sequential because later tasks modify the same architectural regression test and several shared regression files.

## File Structure

### Create

- `tests/regression/canonical-request-solution-forms.test.ts` — source-level architectural boundary proving legacy routes/components are absent and canonical modal wiring remains.
- `docs/superpowers/reports/2026-09-04-request-solution-dead-code-audit.md` — read-only report of unrelated unreachable candidates intentionally left for a later cleanup.

### Modify

- `src/components/requests/submitter-modal.tsx` — point “View Original Request” at the canonical request modal deep link.
- `src/server-actions/request-view-invalidation.ts` — invalidate only canonical list/dashboard routes and drop its obsolete request-ID parameter.
- `src/server-actions/files.ts` — remove direct invalidation of the retired request-detail route.
- `src/server-actions/approvals.ts` — call `revalidateRequestViews()` without the retired parameter.
- `src/server-actions/engineering-sub-tasks.ts` — call `revalidateRequestViews()` without the retired parameter.
- `src/server-actions/requests.ts` — remove `/requests/new` invalidation and call `revalidateRequestViews()` without the retired parameter.
- `src/server-actions/solutions.ts` — call `revalidateRequestViews()` without the retired parameter.
- `tests/regression/authenticated-shell-navbar.test.ts` — remove layout contracts for deleted standalone pages.
- `tests/regression/formatted-description-rendering.test.ts` — retain active modal rendering boundaries only.
- `tests/regression/formatted-description-editors.test.ts` — retain editor and 20,000-character validation coverage on the active modal/shared schema.
- `tests/regression/inline-image-form-wiring.test.ts` — remove obsolete form loaders/suites while preserving `SubmitterModal` request and solution coverage.
- `tests/regression/discard-draft.test.ts` — remove obsolete dedicated-form contracts while preserving modal lifecycle coverage.
- `tests/regression/solution-upload-actions.test.ts` — collapse two-surface assertions to the active `SubmitterModal` plus `RequestModalRouter`.
- `tests/regression/approver-department-labels.test.ts` — remove the server-rendered standalone solution-page picker assertion.
- `tests/regression/image-attachment-ui.test.ts` — retain the active request resubmission uploader assertion only.
- `tests/regression/pre-submit-attachment-preview.test.ts` — retain active modal preview surfaces only.
- `tests/regression/request-upload-progress-wiring.test.ts` — remove the retired upload-progress helper assertion.
- `tests/e2e/formatted-descriptions.spec.ts` — reopen request details through the canonical query-string modal deep link.
- `tests/e2e/inline-description-images.spec.ts` — use the active New Request modal, staged request attachment endpoint, and modal detail deep link.
- `tests/e2e/solution-attachment-upload.spec.ts` — enter through the engineering modal flow and submit directly from `SubmitterModal`.
- `tests/e2e/modal-system.spec.ts` — stop expecting navigation to the retired solution page.
- `docs/MODAL-FLOW.md` — document canonical entry points and retired routes.

### Delete

- `src/app/(dashboard)/requests/new/page.tsx`
- `src/app/(dashboard)/requests/[requestId]/page.tsx`
- `src/app/(dashboard)/engineering/solutions/[requestId]/page.tsx`
- `src/components/requests/request-form.tsx`
- `src/components/mobile/mobile-file-upload.tsx`
- `src/components/solutions/solution-form.tsx`
- `src/components/solutions/solution-file-upload.tsx`
- `src/components/solutions/solution-preview.tsx`
- `src/lib/attachments/upload-progress.ts`
- `src/lib/attachments/upload-batch.ts`
- `tests/regression/upload-progress.test.ts`
- `tests/regression/upload-batch.test.ts`

---

### Task 1: Canonicalize Request Details and Retire the Standalone Detail Route

**Files:**
- Create: `tests/regression/canonical-request-solution-forms.test.ts`
- Modify: `src/components/requests/submitter-modal.tsx:1062-1076`
- Delete: `src/app/(dashboard)/requests/[requestId]/page.tsx`
- Modify: `src/server-actions/request-view-invalidation.ts:3-21`
- Modify: `src/server-actions/files.ts:112-113,232-233`
- Modify: `src/server-actions/approvals.ts:344,431`
- Modify: `src/server-actions/engineering-sub-tasks.ts:111,153,191,210,231`
- Modify: `src/server-actions/requests.ts` at every `revalidateRequestViews(...)` call
- Modify: `src/server-actions/solutions.ts` at every `revalidateRequestViews(...)` call
- Modify: `tests/regression/authenticated-shell-navbar.test.ts:116-128`
- Modify: `tests/regression/formatted-description-rendering.test.ts:5-21`

**Interfaces:**
- Consumes: `RequestDeepLinkModal({ requestId, returnTo })` on `/requests`; `SubmitterModalProps.initialData.requestId: string | undefined`.
- Produces: canonical link string ``/requests?requestId=${encodeURIComponent(initialData.requestId)}``; `revalidateRequestViews(): void` with no request-ID argument.

- [ ] **Step 1: Write the failing request-detail architecture tests**

Create `tests/regression/canonical-request-solution-forms.test.ts` with the shared helpers and the first three tests:

```ts
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const absolute = (path: string) => join(root, path)
const exists = (path: string) => existsSync(absolute(path))
const read = (path: string) => readFileSync(absolute(path), 'utf8')

function sourceText(path: string): string {
  const fullPath = absolute(path)
  return readdirSync(fullPath).sort().map((entry) => {
    const child = join(fullPath, entry)
    if (statSync(child).isDirectory()) return sourceText(join(path, entry))
    return /\.(?:ts|tsx)$/.test(entry) ? read(join(path, entry)) : ''
  }).join('\n')
}

describe('canonical request detail flow', () => {
  it('has no standalone request detail page', () => {
    assert.equal(exists('src/app/(dashboard)/requests/[requestId]/page.tsx'), false)
  })

  it('opens View Original Request through the modal deep link in a new tab', () => {
    const modal = read('src/components/requests/submitter-modal.tsx')
    assert.match(
      modal,
      /href=\{`\/requests\?requestId=\$\{encodeURIComponent\(initialData\.requestId\)\}`\}/,
    )
    assert.match(modal, /target="_blank"/)
    assert.match(modal, /rel="noopener noreferrer"/)
    assert.doesNotMatch(modal, /href=\{`\/requests\/\$\{initialData\.requestId\}`\}/)
  })

  it('does not invalidate deleted request-detail pages', () => {
    const runtime = sourceText('src')
    const invalidation = read('src/server-actions/request-view-invalidation.ts')
    assert.match(invalidation, /export function revalidateRequestViews\(\)/)
    assert.doesNotMatch(runtime, /revalidatePath\(`\/requests\/\$\{/)
    assert.doesNotMatch(runtime, /revalidateRequestViews\([^)]/)
  })
})
```

- [ ] **Step 2: Run the new test and verify the red state**

Run:

```bash
portly status
job_id="$(portly temp 'npx tsx --test tests/regression/canonical-request-solution-forms.test.ts' --path "$PWD" --timeout 30m)"
portly wait "$job_id"
```

Expected: FAIL because the standalone page exists, the link still uses `/requests/<id>`, and `revalidateRequestViews` still accepts request IDs.

- [ ] **Step 3: Change the original-request link**

In `src/components/requests/submitter-modal.tsx`, use the encoded canonical deep link while retaining the existing new-tab attributes:

```tsx
<a
  href={`/requests?requestId=${encodeURIComponent(initialData.requestId)}`}
  target="_blank"
  rel="noopener noreferrer"
  className="flex items-center gap-2 text-sm text-blue-700 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 transition-colors"
>
```

Do not change the label, request title, icon, or solution form state.

- [ ] **Step 4: Remove the standalone detail page and stale invalidations**

Delete the page:

```bash
rm 'src/app/(dashboard)/requests/[requestId]/page.tsx'
```

Replace `src/server-actions/request-view-invalidation.ts` with the same canonical path list and a parameterless function:

```ts
import { revalidatePath } from 'next/cache'

const REQUEST_VIEW_PATHS = [
  '/requests',
  '/requests/my-actions',
  '/dashboard',
  '/engineering',
  '/analytics',
  '/admin/retention',
  '/admin/deleted-requests',
]

export function revalidateRequestViews() {
  for (const path of REQUEST_VIEW_PATHS) {
    revalidatePath(path)
  }
}
```

In `src/server-actions/files.ts`, retain each `revalidatePath('/requests')` and remove only these two dynamic calls:

```ts
revalidatePath(`/requests/${request.id}`)
revalidatePath(`/requests/${requestId}`)
```

At every call site in the files listed above, make the mechanical API update:

```ts
revalidateRequestViews(requestId)
// becomes
revalidateRequestViews()
```

Apply the same replacement when the old argument is `request.id`, `input.requestId`, `existing.requestId`, `solution.requestId`, or `validated.requestId`. Do not change the surrounding transaction or action logic.

- [ ] **Step 5: Remove regression references to the deleted detail page**

In `tests/regression/authenticated-shell-navbar.test.ts`, remove only this focused-page map entry:

```ts
["src/app/(dashboard)/requests/[requestId]/page.tsx", "max-w-5xl"],
```

In `tests/regression/formatted-description-rendering.test.ts`, remove only this entry from `displayFiles`:

```ts
'src/app/(dashboard)/requests/[requestId]/page.tsx',
```

The active modal files stay in `displayFiles`.

- [ ] **Step 6: Run focused regressions and TypeScript**

Run:

```bash
job_id="$(portly temp 'npx tsx --test tests/regression/canonical-request-solution-forms.test.ts tests/regression/authenticated-shell-navbar.test.ts tests/regression/formatted-description-rendering.test.ts && npx tsc --noEmit' --path "$PWD" --timeout 30m)"
portly wait "$job_id"
```

Expected: PASS.

- [ ] **Step 7: Commit the canonical request-detail change**

```bash
git add -- \
  'src/app/(dashboard)/requests/[requestId]/page.tsx' \
  src/components/requests/submitter-modal.tsx \
  src/server-actions/request-view-invalidation.ts \
  src/server-actions/files.ts \
  src/server-actions/approvals.ts \
  src/server-actions/engineering-sub-tasks.ts \
  src/server-actions/requests.ts \
  src/server-actions/solutions.ts \
  tests/regression/canonical-request-solution-forms.test.ts \
  tests/regression/authenticated-shell-navbar.test.ts \
  tests/regression/formatted-description-rendering.test.ts
git commit -m "refactor: canonicalize request detail flow"
```

### Task 2: Retire the Standalone New Request Form

**Files:**
- Modify: `tests/regression/canonical-request-solution-forms.test.ts`
- Delete: `src/app/(dashboard)/requests/new/page.tsx`
- Delete: `src/components/requests/request-form.tsx`
- Delete: `src/components/mobile/mobile-file-upload.tsx`
- Modify: `src/server-actions/requests.ts:226-227`
- Modify: `tests/regression/formatted-description-editors.test.ts`
- Modify: `tests/regression/inline-image-form-wiring.test.ts`
- Modify: `tests/regression/discard-draft.test.ts`
- Modify: `tests/regression/authenticated-shell-navbar.test.ts`

**Interfaces:**
- Consumes: `SubmitterModal(mode="request")`, `createRequest`, `descriptionSchema`, `RequestsListClient`, and `FollowUpDashboard`.
- Produces: no `/requests/new` route and no `RequestForm` implementation; active New Request callers remain modal-based.

- [ ] **Step 1: Add failing New Request retirement tests**

Append this suite to `tests/regression/canonical-request-solution-forms.test.ts`:

```ts
describe('canonical New Request flow', () => {
  const retiredFiles = [
    'src/app/(dashboard)/requests/new/page.tsx',
    'src/components/requests/request-form.tsx',
    'src/components/mobile/mobile-file-upload.tsx',
  ]

  it('removes the standalone route and its private component tree', () => {
    for (const path of retiredFiles) assert.equal(exists(path), false, path)
    const runtime = sourceText('src')
    assert.doesNotMatch(runtime, /components\/requests\/request-form/)
    assert.doesNotMatch(runtime, /components\/mobile\/mobile-file-upload/)
  })

  it('keeps both visible New Request callers on SubmitterModal request mode', () => {
    for (const path of [
      'src/components/requests/requests-list-client.tsx',
      'src/components/dashboard/follow-up-dashboard.tsx',
    ]) {
      const source = read(path)
      assert.match(source, /<SubmitterModal/)
      assert.match(source, /mode=["']request["']/)
      assert.match(source, /onSubmitRequest=/)
    }
  })

  it('does not invalidate the retired New Request page', () => {
    assert.doesNotMatch(sourceText('src'), /revalidatePath\(['"]\/requests\/new['"]\)/)
  })
})
```

- [ ] **Step 2: Run the focused test and verify it fails**

```bash
job_id="$(portly temp 'npx tsx --test tests/regression/canonical-request-solution-forms.test.ts' --path "$PWD" --timeout 30m)"
portly wait "$job_id"
```

Expected: FAIL because all three retired files and the `/requests/new` invalidation still exist.

- [ ] **Step 3: Delete the obsolete New Request tree and invalidation**

```bash
rm 'src/app/(dashboard)/requests/new/page.tsx' \
   src/components/requests/request-form.tsx \
   src/components/mobile/mobile-file-upload.tsx
```

Remove only this line from the successful `createRequest` path in `src/server-actions/requests.ts`:

```ts
revalidatePath('/requests/new')
```

Keep `revalidateRequestViews()` and the later `revalidatePath('/admin')`; therefore the `next/cache` import remains used.

- [ ] **Step 4: Move request editor/limit assertions to active code**

In `tests/regression/formatted-description-editors.test.ts`:

1. Delete the test that reads `request-form.tsx`.
2. Remove `request-form.tsx` from the coordinator-path loop.
3. Replace the old client-form 20,000-character test with this shared-schema contract:

```ts
it('keeps the 20000-character rich description limit on active request and solution submissions', () => {
  const schemas = read('src/lib/schemas/solution-schemas.ts')
  const requests = read('src/server-actions/requests.ts')
  const modal = read('src/components/requests/submitter-modal.tsx')

  assert.match(schemas, /export const descriptionSchema = z[\s\S]*?\.max\(20000, 'Description too long'\)/)
  assert.match(requests, /description: descriptionSchema/)
  assert.match(modal, /id="description"[\s\S]*?inlineImages=\{inlineImages\}/)
  assert.match(modal, /id="solutionDescription"[\s\S]*?inlineImages=\{inlineImages\}/)
})
```

Keep the existing `SubmitterModal` assertion that both active editors use `RichTextEditor` and one inline-image coordinator.

- [ ] **Step 5: Remove obsolete RequestForm-only regression suites**

In `tests/regression/inline-image-form-wiring.test.ts`:

- Remove `RequestForm` from `FormModules`.
- Remove `import('../../src/components/requests/request-form')` from `loadForms()` and remove its result mapping.
- Delete `describe('request form', ...)` under both “inline image form blocking behavior” and “inline image form wiring contracts”.
- Keep the existing `describe('submitter modal', ...)` behavior and wiring suites; they already cover request-mode blocking, upload-session forwarding, success-only clears, template copying, and cleanup.

The loader should begin with this shape after both obsolete request entries are removed:

```ts
type FormModules = {
  SolutionForm: LooseComponent
  TemplateForm: LooseComponent
  ResubmitRequestDialog: LooseComponent
  RequestResubmitModal: LooseComponent
  SubmitterModal: LooseComponent
}
```

In `tests/regression/discard-draft.test.ts`, delete only `it('request form confirms before discarding a dirty draft', ...)`. Keep `it('submitter modal confirms before discarding a dirty draft', ...)` as the active contract.

In `tests/regression/authenticated-shell-navbar.test.ts`, remove:

```ts
["src/app/(dashboard)/requests/new/page.tsx", "max-w-3xl"],
```

- [ ] **Step 6: Run all changed request regressions**

```bash
job_id="$(portly temp 'npx tsx --test tests/regression/canonical-request-solution-forms.test.ts tests/regression/formatted-description-editors.test.ts tests/regression/inline-image-form-wiring.test.ts tests/regression/discard-draft.test.ts tests/regression/authenticated-shell-navbar.test.ts tests/regression/request-upload-progress-wiring.test.ts && npx tsc --noEmit' --path "$PWD" --timeout 30m)"
portly wait "$job_id"
```

Expected: PASS, including active `SubmitterModal` request-mode behavior.

- [ ] **Step 7: Commit the New Request consolidation**

```bash
git add -- \
  'src/app/(dashboard)/requests/new/page.tsx' \
  src/components/requests/request-form.tsx \
  src/components/mobile/mobile-file-upload.tsx \
  src/server-actions/requests.ts \
  tests/regression/canonical-request-solution-forms.test.ts \
  tests/regression/formatted-description-editors.test.ts \
  tests/regression/inline-image-form-wiring.test.ts \
  tests/regression/discard-draft.test.ts \
  tests/regression/authenticated-shell-navbar.test.ts
git commit -m "refactor: remove legacy new request form"
```

### Task 3: Retire the Standalone Submit Solution Form and Orphaned Helpers

**Files:**
- Modify: `tests/regression/canonical-request-solution-forms.test.ts`
- Delete: `src/app/(dashboard)/engineering/solutions/[requestId]/page.tsx`
- Delete: `src/components/solutions/solution-form.tsx`
- Delete: `src/components/solutions/solution-file-upload.tsx`
- Delete: `src/components/solutions/solution-preview.tsx`
- Delete: `src/lib/attachments/upload-progress.ts`
- Delete: `src/lib/attachments/upload-batch.ts`
- Delete: `tests/regression/upload-progress.test.ts`
- Delete: `tests/regression/upload-batch.test.ts`
- Modify: `tests/regression/formatted-description-editors.test.ts`
- Modify: `tests/regression/formatted-description-rendering.test.ts`
- Modify: `tests/regression/inline-image-form-wiring.test.ts`
- Modify: `tests/regression/discard-draft.test.ts`
- Modify: `tests/regression/solution-upload-actions.test.ts`
- Modify: `tests/regression/approver-department-labels.test.ts`
- Modify: `tests/regression/image-attachment-ui.test.ts`
- Modify: `tests/regression/pre-submit-attachment-preview.test.ts`
- Modify: `tests/regression/request-upload-progress-wiring.test.ts`
- Modify: `tests/regression/authenticated-shell-navbar.test.ts`

**Interfaces:**
- Consumes: `SubmitterModal(mode="solution" | "resubmit")`, `RequestModalRouter` callbacks, `useStagedSolutionAttachments({ requestId })`, and `submitSolution(input)`.
- Produces: one solution-authoring UI; no standalone solution route, private form components, batch uploader, or legacy summary helper.

- [ ] **Step 1: Add failing solution retirement and active-wiring tests**

Append this suite to `tests/regression/canonical-request-solution-forms.test.ts`:

```ts
describe('canonical Submit Solution flow', () => {
  const retiredFiles = [
    'src/app/(dashboard)/engineering/solutions/[requestId]/page.tsx',
    'src/components/solutions/solution-form.tsx',
    'src/components/solutions/solution-file-upload.tsx',
    'src/components/solutions/solution-preview.tsx',
    'src/lib/attachments/upload-progress.ts',
    'src/lib/attachments/upload-batch.ts',
  ]

  it('removes the standalone solution tree and transitively orphaned helpers', () => {
    for (const path of retiredFiles) assert.equal(exists(path), false, path)
    const runtime = sourceText('src')
    assert.doesNotMatch(runtime, /components\/solutions\/solution-form/)
    assert.doesNotMatch(runtime, /components\/solutions\/solution-file-upload/)
    assert.doesNotMatch(runtime, /components\/solutions\/solution-preview/)
    assert.doesNotMatch(runtime, /attachments\/upload-progress/)
    assert.doesNotMatch(runtime, /attachments\/upload-batch/)
  })

  it('keeps solution submission in SubmitterModal and RequestModalRouter', () => {
    const modal = read('src/components/requests/submitter-modal.tsx')
    const router = read('src/components/requests/request-modal-router.tsx')
    assert.match(modal, /mode === "solution"/)
    assert.match(modal, /useStagedSolutionAttachments\(\{ requestId \}\)/)
    assert.match(modal, /fileIds: solutionReadyAttachmentIds/)
    assert.match(router, /\bsubmitSolution\b/)
    assert.match(router, /await submitSolution\(\{/)
  })
})
```

- [ ] **Step 2: Run the architecture test and verify it fails**

```bash
job_id="$(portly temp 'npx tsx --test tests/regression/canonical-request-solution-forms.test.ts' --path "$PWD" --timeout 30m)"
portly wait "$job_id"
```

Expected: FAIL because all six retired production files still exist.

- [ ] **Step 3: Delete the standalone solution tree and obsolete helper tests**

```bash
rm 'src/app/(dashboard)/engineering/solutions/[requestId]/page.tsx' \
   src/components/solutions/solution-form.tsx \
   src/components/solutions/solution-file-upload.tsx \
   src/components/solutions/solution-preview.tsx \
   src/lib/attachments/upload-progress.ts \
   src/lib/attachments/upload-batch.ts \
   tests/regression/upload-progress.test.ts \
   tests/regression/upload-batch.test.ts
```

Do not delete `src/components/solutions/custom-approval-picker.tsx`, `src/hooks/use-staged-solution-attachments.ts`, `src/lib/schemas/solution-schemas.ts`, or `src/server-actions/solutions.ts`.

- [ ] **Step 4: Remove dedicated SolutionForm editor and lifecycle assertions**

In `tests/regression/formatted-description-editors.test.ts`, remove all reads/assertions for `solution-form.tsx`. Keep the active modal assertions and the shared `descriptionSchema` limit test created in Task 2.

In `tests/regression/inline-image-form-wiring.test.ts`:

- Remove `SolutionForm` from `FormModules` and `loadForms()`.
- Delete `describe('solution form', ...)` under both top-level behavior and wiring suites.
- Keep `SubmitterModal` solution/resubmit assertions.

After removal, the loader type is:

```ts
type FormModules = {
  TemplateForm: LooseComponent
  ResubmitRequestDialog: LooseComponent
  RequestResubmitModal: LooseComponent
  SubmitterModal: LooseComponent
}
```

In `tests/regression/discard-draft.test.ts`, delete these obsolete-only tests:

```text
dedicated solution form fences commit/cancel races and clears stale discard state
a stale SolutionFileUpload add callback cannot bypass operation locks
solution form confirms before discarding a dirty draft
```

Keep the equivalent `SubmitterModal` commit fencing, discard, cleanup-failure, and resubmit-state tests.

- [ ] **Step 5: Consolidate solution upload wiring assertions on the active modal**

In `tests/regression/solution-upload-actions.test.ts`, retain all schema, server-action transaction, ownership, adoption, notification, and resubmission suites before “Task 4 source-wiring”. Replace the two old mixed-surface UI suites with active modal/router assertions equivalent to:

```ts
describe('active modal staged solution wiring', () => {
  const modal = readFileSync('src/components/requests/submitter-modal.tsx', 'utf8')
  const router = readFileSync('src/components/requests/request-modal-router.tsx', 'utf8')

  it('stages solution and resubmit attachments eagerly and submits IDs only', () => {
    assert.match(modal, /useStagedSolutionAttachments\(\{ requestId \}\)/)
    assert.doesNotMatch(modal, /useSolutionAttachments/)
    assert.doesNotMatch(modal, /ensureUploaded/)
    const solution = modal.split('if (mode === "solution" && onSubmitSolution)')[1]
      ?.split('} else if (mode === "resubmit"')[0] ?? ''
    const resubmit = modal.split('} else if (mode === "resubmit" && onResubmit)')[1]
      ?.split('} catch')[0] ?? ''
    assert.match(solution, /fileIds: solutionReadyAttachmentIds/)
    assert.match(resubmit, /fileIds: solutionReadyAttachmentIds/)
    assert.match(resubmit, /deletedFileIds: deletedFileIdsSnapshot/)
  })

  it('blocks unstable drafts and fences commit, close, retry, and remove paths', () => {
    assert.match(modal, /const solutionAttachmentsBlocking =/)
    assert.match(modal, /beginSolutionCommit\(\)/)
    assert.match(modal, /abortSolutionCommit\(\)/)
    assert.match(modal, /clearSolutionAttachments\(\)/)
    assert.match(modal, /cleanupSolutionAttachments: resetSolutionAttachments/)
    assert.match(modal, /retryStagedSolutionItem\(id\)/)
    assert.match(modal, /removeStagedSolutionItem\(id\)/)
  })

  it('keeps raw files out of the modal router server boundary', () => {
    assert.doesNotMatch(router, /formData\.append\('file'/)
    assert.doesNotMatch(router, /uploadFileAction/)
    assert.doesNotMatch(router, /files: data\.files/)
    assert.match(router, /newFileIds: data\.fileIds/)
  })
})
```

This replacement removes only duplicate `SolutionForm` assertions; it keeps the active modal lifecycle protected.

- [ ] **Step 6: Remove remaining obsolete component/helper references**

Apply these exact test-scope changes:

- `tests/regression/formatted-description-rendering.test.ts`: remove `solution-preview.tsx` from `displayFiles` and delete both `solution preview ...` tests. Keep every active modal rendering assertion.
- `tests/regression/approver-department-labels.test.ts`: delete `it('provides department names to the server-rendered solution picker', ...)`; keep API, modal picker, and preview-fixture tests.
- `tests/regression/image-attachment-ui.test.ts`: remove `solutionSource` and `it('solution uploader no longer renders optimizer output ...')`; keep request uploader and WebP assertions.
- `tests/regression/pre-submit-attachment-preview.test.ts`: remove `solution-file-upload.tsx` from `SUBMIT_SURFACES` and delete the `const solution` assertions. `SubmitterModal` remains in `SUBMIT_SURFACES` and covers both active request and solution modes.
- `tests/regression/request-upload-progress-wiring.test.ts`: remove the `uploadProgress` read and replace “request-dead upload-progress helpers are gone; solution describeUploadProgress remains” with:

```ts
test('active modal has no submit-time batch progress dependency', () => {
  assert.doesNotMatch(modal, /describeUploadProgress/)
  assert.doesNotMatch(modal, /uploadAttachmentBatch/)
})
```

- `tests/regression/authenticated-shell-navbar.test.ts`: remove the `engineering/solutions/[requestId]/page.tsx` focused-page entry.

- [ ] **Step 7: Run all affected solution regressions and TypeScript**

```bash
job_id="$(portly temp 'npx tsx --test tests/regression/canonical-request-solution-forms.test.ts tests/regression/formatted-description-editors.test.ts tests/regression/formatted-description-rendering.test.ts tests/regression/inline-image-form-wiring.test.ts tests/regression/discard-draft.test.ts tests/regression/solution-upload-actions.test.ts tests/regression/approver-department-labels.test.ts tests/regression/image-attachment-ui.test.ts tests/regression/pre-submit-attachment-preview.test.ts tests/regression/request-upload-progress-wiring.test.ts tests/regression/authenticated-shell-navbar.test.ts && npx tsc --noEmit' --path "$PWD" --timeout 30m)"
portly wait "$job_id"
```

Expected: PASS. A final source scan must show no test/runtime references to the deleted solution files or helper modules.

- [ ] **Step 8: Commit the Submit Solution consolidation**

```bash
git add -A -- \
  'src/app/(dashboard)/engineering/solutions/[requestId]/page.tsx' \
  src/components/solutions/solution-form.tsx \
  src/components/solutions/solution-file-upload.tsx \
  src/components/solutions/solution-preview.tsx \
  src/lib/attachments/upload-progress.ts \
  src/lib/attachments/upload-batch.ts \
  tests/regression/upload-progress.test.ts \
  tests/regression/upload-batch.test.ts \
  tests/regression/canonical-request-solution-forms.test.ts \
  tests/regression/formatted-description-editors.test.ts \
  tests/regression/formatted-description-rendering.test.ts \
  tests/regression/inline-image-form-wiring.test.ts \
  tests/regression/discard-draft.test.ts \
  tests/regression/solution-upload-actions.test.ts \
  tests/regression/approver-department-labels.test.ts \
  tests/regression/image-attachment-ui.test.ts \
  tests/regression/pre-submit-attachment-preview.test.ts \
  tests/regression/request-upload-progress-wiring.test.ts \
  tests/regression/authenticated-shell-navbar.test.ts
git commit -m "refactor: remove legacy solution form"
```

### Task 4: Migrate New Request and Request Detail Browser Coverage

**Files:**
- Modify: `tests/e2e/formatted-descriptions.spec.ts:159-185`
- Modify: `tests/e2e/inline-description-images.spec.ts:1378-1450,1511-1604`

**Interfaces:**
- Consumes: `/requests?requestId=<encoded-id>`, `RequestDeepLinkModal`, `SubmitterModal(mode="request")`, and request-scope `/api/attachments/stage` PUT/POST traffic.
- Produces: browser specs that exercise only canonical request UI entry points.

- [ ] **Step 1: Add canonical detail and New Request helpers to the E2E specs**

In each relevant spec, add a local detail helper using its existing imported `Page`, `test`, and `expect` symbols:

```ts
async function openRequestDetail(page: Page, requestId: string) {
  await page.goto(`/requests?requestId=${encodeURIComponent(requestId)}`)
  const dialog = page.getByRole('dialog').last()
  await expect(dialog).toBeVisible({ timeout: 20_000 })
  return dialog
}
```

In `tests/e2e/inline-description-images.spec.ts`, also add:

```ts
async function openNewRequest(page: Page) {
  await page.goto('/requests')
  await page.getByRole('button', { name: 'New Request', exact: true }).click()
  const dialog = page.getByRole('dialog').filter({ hasText: 'Submit New Request' })
  await expect(dialog).toBeVisible({ timeout: 20_000 })
  return dialog
}
```

- [ ] **Step 2: Replace standalone request-detail navigation**

In `tests/e2e/formatted-descriptions.spec.ts`, replace the `/requests/<id>` navigation and page-card lookup with:

```ts
const detailDialog = await openRequestDetail(page, requestId)
const requestDescription = detailDialog.locator('span.rich-text').first()
await expect(requestDescription).toBeVisible({ timeout: 20_000 })
```

Keep the existing assertions for `<strong>`, `<br>`, literal script text, and no `<script>` element.

In `tests/e2e/inline-description-images.spec.ts`, replace both direct `/requests/<id>` navigations with `openRequestDetail(page, requestId)`. Scope saved images and palette assertions to the returned dialog:

```ts
const detailDialog = await openRequestDetail(page, requestId)
const detailImg = detailDialog.locator('span.rich-text img').first()
```

For the authorization scenario, discover `committedSrc` from that same modal image; keep the 401, 403, and 200 API assertions unchanged.

- [ ] **Step 3: Move template-copy request creation to SubmitterModal**

Replace `page.goto('/requests/new')` and its heading assertion with:

```ts
const requestDialog = await openNewRequest(page)
```

Scope the template picker, title input, editor images, upload input, and submit button to `requestDialog`. Use these active selectors:

```ts
await requestDialog.getByRole('combobox').click()
await page.getByRole('option', { name: templateName }).click()
await requestDialog.getByPlaceholder('Brief summary of your request').fill(uniqueTitle)
const attachmentInput = requestDialog
  .locator('label')
  .filter({ hasText: 'Click to upload files' })
  .locator('input[type="file"]')
await attachmentInput.setInputFiles(join(FIXTURE_DIR, ATTACHMENT_FIXTURE))
await requestDialog.getByRole('button', { name: 'Submit Request' }).click()
await expect(page.getByText('Request created successfully')).toBeVisible({ timeout: 60_000 })
await expect(requestDialog).toBeHidden({ timeout: 20_000 })
```

Replace the old `/requests/new` multipart instrumentation with request-stage instrumentation:

```ts
const attachmentUploads: number[] = []
await page.route('**/api/attachments/stage', async (route) => {
  if (route.request().method() !== 'POST') {
    await route.continue()
    return
  }
  const response = await route.fetch()
  attachmentUploads.push(response.status())
  await route.fulfill({ response })
})
```

Keep the final expectation but update its message and semantics:

```ts
expect(attachmentUploads, 'exactly one staged request attachment upload succeeded').toEqual([200])
```

- [ ] **Step 4: Verify no request E2E targets a deleted route**

Run the source scan and Playwright discovery:

```bash
! rg -n '/requests/new|page\.goto\(`/requests/\$\{' tests/e2e
job_id="$(portly temp 'npx playwright test --list tests/e2e/formatted-descriptions.spec.ts tests/e2e/inline-description-images.spec.ts' --path "$PWD" --timeout 30m)"
portly wait "$job_id"
```

Expected: the scan has no matches and Playwright lists both specifications without a TypeScript/configuration error. Do not run the environment-backed live scenarios unless all required variables are already configured.

- [ ] **Step 5: Commit the request E2E migration**

```bash
git add -- tests/e2e/formatted-descriptions.spec.ts tests/e2e/inline-description-images.spec.ts
git commit -m "test: move request e2e coverage to modals"
```

### Task 5: Migrate Submit Solution Browser Coverage

**Files:**
- Modify: `tests/e2e/solution-attachment-upload.spec.ts`
- Modify: `tests/e2e/modal-system.spec.ts:121-165`

**Interfaces:**
- Consumes: engineering rows identified by `data-testid="engineering-request-row"` and `data-request-id`, `CompletedRequestModal`, `SubmitterModal(mode="solution")`, and Next.js Server Action request headers.
- Produces: solution browser coverage with no dependency on `/engineering/solutions/<id>` or the removed preview-confirm page.

- [ ] **Step 1: Enter the release-gate solution test through the active modal flow**

In `tests/e2e/solution-attachment-upload.spec.ts`, remove `solutionPath` and replace direct page navigation with:

```ts
await login(page, engineeringEmail, engineeringPassword)
await page.goto('/engineering')
const engineeringRow = page.locator(
  `[data-testid="engineering-request-row"][data-request-id="${requestId}"]`,
)
await expect(engineeringRow).toBeVisible({ timeout: 20_000 })
await engineeringRow.getByRole('button', { name: /Submit solution/i }).click()

const requestDialog = page.getByRole('dialog').last()
await expect(requestDialog).toBeVisible({ timeout: 20_000 })
await requestDialog.getByRole('button', { name: 'Submit Solution' }).click()

const solutionDialog = page
  .getByRole('dialog')
  .filter({ hasText: 'Submit Engineering Solution' })
await expect(solutionDialog).toBeVisible({ timeout: 20_000 })
```

Fill the active controls instead of `name`-based standalone fields:

```ts
await solutionDialog.locator('#solutionTitle').fill('E2E reliability matrix solution')
const descriptionEditor = solutionDialog.locator('.rich-text[role="textbox"]')
await descriptionEditor.click()
await descriptionEditor.type('Deterministic solution attachment upload reliability verification.')
await solutionDialog.locator('#cost').fill('50000')
await solutionDialog.locator('#timeline').fill('2 weeks')
const fileInput = solutionDialog
  .locator('label')
  .filter({ hasText: 'Click to upload files' })
  .locator('input[type="file"]')
```

Assert the “View Original Request” link before uploading:

```ts
await expect(solutionDialog.getByRole('link', { name: /View Original Request/ })).toHaveAttribute(
  'href',
  `/requests?requestId=${encodeURIComponent(requestId)}`,
)
```

- [ ] **Step 2: Observe the active Server Action and use the direct modal submit**

Replace the route-specific metadata interception with a request observer registered before uploads:

```ts
const metadataSubmits: string[] = []
page.on('request', (request) => {
  if (request.method() === 'POST' && request.headers()['next-action']) {
    metadataSubmits.push(request.postData() ?? '')
  }
})
```

Scope upload rows, readiness text, Retry, and the submit button to `solutionDialog`. Rename `reviewButton` to `submitButton`:

```ts
const submitButton = solutionDialog.getByRole('button', { name: 'Submit Solution' })
```

Keep every oversized-file, staged reserve/upload, progress, readiness, remove, forced-failure, retry, attachment-ID, and no-cleanup assertion. Remove the old preview phase entirely:

```text
Review & Submit click
Confirm & Submit lookup
Ready badges in SolutionPreview
```

Immediately before the single final submit, capture stage counts:

```ts
const stageCountsBeforeSubmit = {
  reserve: routeState.reserveSeq,
  upload: routeState.stageUploadSeq,
  remove: routeState.stageDeleteSeq,
}
await submitButton.click()
await expect(page.getByText('Solution submitted successfully')).toBeVisible({ timeout: 60_000 })
await expect(solutionDialog).toBeHidden({ timeout: 20_000 })
expect(metadataSubmits, 'exactly one metadata submit').toHaveLength(1)
expect(routeState.reserveSeq).toBe(stageCountsBeforeSubmit.reserve)
expect(routeState.stageUploadSeq).toBe(stageCountsBeforeSubmit.upload)
expect(routeState.stageDeleteSeq).toBe(stageCountsBeforeSubmit.remove)
```

Do not expect a URL navigation: the canonical modal flow stays on `/engineering` and refreshes the data.

For the Thai filename checks, obtain the committed attachment ID from the already tracked reservation map rather than the removed detail page:

```ts
const attachmentId = [...stagedDraftById.entries()]
  .find(([, fileName]) => fileName === FIXTURES.thai.name)?.[0]
expect(attachmentId, 'captured the Thai staged attachment id').toBeTruthy()
```

Keep the existing preview/download API requests and authorization assertions using that ID.

- [ ] **Step 3: Update the general modal-system solution scenario**

In `tests/e2e/modal-system.spec.ts`, replace the retired navigation expectation after the engineering dashboard button click with modal assertions:

```ts
await submitButton.click()
const requestDialog = page.getByRole('dialog').last()
await expect(requestDialog).toBeVisible({ timeout: 5_000 })
await requestDialog.getByRole('button', { name: 'Submit Solution' }).click()
const solutionDialog = page
  .getByRole('dialog')
  .filter({ hasText: 'Submit Engineering Solution' })
await expect(solutionDialog).toBeVisible({ timeout: 5_000 })

await solutionDialog.locator('#solutionTitle').fill('Test Solution')
await solutionDialog.locator('.rich-text[role="textbox"]').fill('This is a test solution')
await solutionDialog.locator('#cost').fill('50000')
await solutionDialog.locator('#timeline').fill('2 weeks')
await solutionDialog.getByRole('button', { name: 'Submit Solution' }).click()
```

Delete `waitForURL(/\/engineering\/solutions\//)` and every standalone `input[name=...]`/`textarea[name=...]` selector in this scenario.

- [ ] **Step 4: Verify no active E2E references the removed solution route**

```bash
! rg -n '/engineering/solutions/' tests/e2e
job_id="$(portly temp 'npx playwright test --list tests/e2e/solution-attachment-upload.spec.ts tests/e2e/modal-system.spec.ts' --path "$PWD" --timeout 30m)"
portly wait "$job_id"
```

Expected: no route references and successful Playwright discovery. If the six release-gate environment variables and a healthy Portly-managed server are already available, run the live upload spec; otherwise record that live execution was not available without marking it passed.

- [ ] **Step 5: Commit the solution E2E migration**

```bash
git add -- tests/e2e/solution-attachment-upload.spec.ts tests/e2e/modal-system.spec.ts
git commit -m "test: move solution e2e coverage to modal flow"
```

### Task 6: Document the Canonical Flow, Record Deferred Dead Code, and Verify

**Files:**
- Modify: `docs/MODAL-FLOW.md`
- Create: `docs/superpowers/reports/2026-09-04-request-solution-dead-code-audit.md`

**Interfaces:**
- Consumes: final source tree and import/reference evidence.
- Produces: current modal-flow documentation, a bounded deferred-cleanup report, passing repository checks, and updated ignored Graphify output.

- [ ] **Step 1: Document canonical entry points and retired routes**

Add this section after “Main Idea” in `docs/MODAL-FLOW.md`:

```md
## Canonical Entry Points

Request creation, request details, and solution submission are modal-only flows:

- New Request: the `/requests` or dashboard “New Request” action opens `SubmitterModal` with `mode="request"`.
- Request deep link: `/requests?requestId=<id>` opens `RequestDeepLinkModal`, then `RequestModalRouter`.
- Submit Solution: the engineering request action opens `RequestModalRouter`, then `SubmitterModal` with `mode="solution"`.

The old standalone routes `/requests/new`, `/requests/<request-id>`, and `/engineering/solutions/<request-id>` were intentionally removed and return 404. Do not add new links to them or create a second authoring form.
```

In “Common Debug Checklist”, add a final item instructing maintainers to verify deep links use the query-string route.

- [ ] **Step 2: Write the deferred dead-code audit**

Create `docs/superpowers/reports/2026-09-04-request-solution-dead-code-audit.md` with this bounded report:

```md
# Request and Solution Dead-Code Audit

**Date:** 2026-09-04
**Scope:** Runtime TypeScript/TSX import reachability after canonical form consolidation

## Removed in This Change

The standalone New Request, request-detail, and Submit Solution routes; their private form components; and the transitively orphaned batch/progress helpers were removed under the approved design.

## Deferred Candidates

| Candidate | Runtime evidence | Why deferred |
| --- | --- | --- |
| `src/components/requests/request-detail-modal.tsx` | No runtime importer; references come from source-contract tests and comments. It still contains links to the retired solution route. | Large independent legacy detail implementation with its own action/export dependencies. |
| `src/components/requests/request-detail-desktop.tsx` | Runtime-imported only by the unused example component. | Belongs to the separate legacy detail-view cluster. |
| `src/components/requests/request-detail-desktop-v2.tsx` | No runtime importer found. | Separate presentation experiment, unrelated to authoring-flow removal. |
| `src/components/requests/request-detail-desktop-example.tsx` | No runtime importer found; imports `request-detail-desktop.tsx`. | Explicit example/prototype file. |
| `src/components/solutions/solution-detail.tsx` | No runtime importer found; current references are regression source reads. | Read-only solution presentation needs a separate coverage review before deletion. |

## Kept as Active

- `submitSolution` and `resubmitSolution`: called by `RequestModalRouter`.
- `createRequest`: called by the active New Request modal callers.
- `CustomApprovalPicker`: used by `final-approval-actions.tsx` and a test harness.
- `uploadFileAction`: used by `request/file-upload-zone.tsx` in request resubmission.
- Both staged-attachment hooks and inline-image coordination: used by `SubmitterModal`.

## Limitations

This is a static import/reference audit, not proof that every dynamically loaded or externally addressed file is unreachable. The deferred candidates must receive a separate approved cleanup with behavior and test review before deletion.
```

- [ ] **Step 3: Run final source-reference scans**

Run:

```bash
! rg -n --glob '!docs/superpowers/**' --glob '!presentation-output/**' \
  'components/requests/request-form|components/mobile/mobile-file-upload|components/solutions/solution-form|components/solutions/solution-file-upload|components/solutions/solution-preview|attachments/upload-progress|attachments/upload-batch' \
  src tests

! test -e 'src/app/(dashboard)/requests/new/page.tsx'
! test -e 'src/app/(dashboard)/requests/[requestId]/page.tsx'
! test -e 'src/app/(dashboard)/engineering/solutions/[requestId]/page.tsx'

rg -n '/engineering/solutions/' src tests || true
```

Expected: the first scan and all absence checks succeed. The final scan may report only the already-deferred `request-detail-modal.tsx` links; the audit must name every remaining match.

- [ ] **Step 4: Run the complete required check through Portly**

```bash
portly status
job_id="$(portly temp 'npm run check' --path "$PWD" --timeout 30m)"
portly wait "$job_id"
```

Expected: exit code 0 with TypeScript, manage tests, and every regression test passing.

- [ ] **Step 5: Verify the complete Playwright suite is discoverable**

```bash
job_id="$(portly temp 'npx playwright test --list' --path "$PWD" --timeout 30m)"
portly wait "$job_id"
```

Expected: exit code 0 and all E2E tests listed. This is discovery validation, not a claim that environment-backed live gates ran.

- [ ] **Step 6: Update Graphify and inspect repository state**

```bash
graphify update .
git diff --check
git status --short
```

Expected: Graphify completes successfully. `graphify-out/` remains ignored. The only pre-existing untracked paths are still:

```text
?? docs/superpowers/plans/2026-09-03-xhr-solution-staged-attachments.md
?? presentation-output/
```

All implementation changes should otherwise be tracked in the task commits.

- [ ] **Step 7: Commit documentation and audit**

```bash
git add -- docs/MODAL-FLOW.md docs/superpowers/reports/2026-09-04-request-solution-dead-code-audit.md
git commit -m "docs: record canonical modal flows"
```

- [ ] **Step 8: Record final evidence for handoff**

Capture in the implementation handoff:

```text
- Changed/deleted files from `git diff 675fedf..HEAD --stat`
- `npm run check` Portly job ID and exit code
- Playwright discovery Portly job ID and exit code
- Any live E2E commands actually run, or “not run: required environment unavailable”
- `graphify update .` result
- Deferred dead-code report path
- Residual risks: intentional 404s and any unexecuted environment-backed browser gate
```
