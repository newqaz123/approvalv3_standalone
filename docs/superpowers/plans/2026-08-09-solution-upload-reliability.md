# Solution Upload Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make initial solution submission and resubmission reliably upload every selected attachment, block submission on any upload failure, verify attachment ownership atomically, and clean unlinked draft attachments.

**Architecture:** Upload each file through one authorized draft-attachment action, then submit only attachment UUIDs. A pure batch coordinator returns explicit final results instead of relying on stale React state, while server transactions verify ownership, request association, count, and solution state before linking attachments. Resubmission uses the same staged-ID flow and deletes physical files only after the database transaction succeeds.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Prisma 6 transactions, Zod 4, Node test runner via `tsx`, Playwright.

## Global Constraints

- Execute `2026-08-09-private-attachment-storage.md` before this plan.
- Upload files individually; never send multiple raw `File` objects through `submitSolution` or `resubmitSolution`.
- A solution cannot be reported successful unless every selected attachment has a verified attachment ID linked to that solution.
- Attachment IDs are UUIDs, unique, limited to 10, owned by the current user, associated with the target request, and unlinked before submission.
- Successful uploads remain reusable during an in-place retry.
- Cancelling a form deletes only unlinked attachments staged by that form and user.
- No VPS or production database operation is part of this plan.

---

## File Structure

**Create**

- `src/lib/attachments/upload-batch.ts` — pure sequential upload coordinator with explicit results.
- `src/hooks/use-solution-attachments.ts` — React state wrapper for add/remove/upload/retry/cleanup.
- `tests/regression/upload-batch.test.ts` — stale-state, partial-failure, and retry tests.
- `tests/regression/solution-upload-actions.test.ts` — source and schema contract tests.
- `tests/e2e/solution-attachment-upload.spec.ts` — logged-in boundary and Thai filename flow.
- `tests/fixtures/uploads/` generated at test runtime and removed after tests.

**Modify**

- `src/server-actions/files.ts` — explicit solution-draft upload and owner-only cleanup actions; remove unused legacy flow.
- `src/lib/schemas/solution-schemas.ts` — UUID/count validation for file IDs and resubmission.
- `src/server-actions/solutions.ts` — ownership/count verification and ID-based resubmission.
- `src/components/solutions/solution-form.tsx` — shared hook; no stale state decisions.
- `src/components/solutions/solution-file-upload.tsx` — render shared item statuses and retry/remove controls.
- `src/components/requests/submitter-modal.tsx` — shared hook for solution/resubmit modes.
- `src/components/requests/request-modal-router.tsx` — callbacks receive IDs, not files; remove upload loops.
- `src/app/(dashboard)/engineering/solutions/[requestId]/page.tsx` — do not relink prior-solution files during a new submission.
- `package.json`, `playwright.config.ts` — focused upload E2E command and external-base-URL handling.

---

### Task 1: Pure Upload Batch Coordinator

**Files:**

- Create: `src/lib/attachments/upload-batch.ts`
- Create: `tests/regression/upload-batch.test.ts`

**Interfaces:**

- Produces: `AttachmentUploadItem`, `AttachmentUploadBatchResult`, `UploadOneAttachment`, and `uploadAttachmentBatch(items, uploadOne, onItemChange?)`.
- Consumes: attachment policy from the private-storage plan.

- [ ] **Step 1: Write failing coordinator tests**

```ts
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { uploadAttachmentBatch, type AttachmentUploadItem } from '../../src/lib/attachments/upload-batch'

const file = (name: string) => new File(['pdf'], name, { type: 'application/pdf' })
const item = (id: string, name: string): AttachmentUploadItem => ({ id, file: file(name), status: 'pending' })

describe('uploadAttachmentBatch', () => {
  it('returns explicit failure and never relies on stale UI state', async () => {
    const result = await uploadAttachmentBatch(
      [item('a', 'ok.pdf'), item('b', 'bad.pdf')],
      async (candidate) => candidate.id === 'a'
        ? { success: true, attachmentId: '11111111-1111-1111-1111-111111111111' }
        : { success: false, error: 'Upload failed' }
    )
    assert.equal(result.success, false)
    assert.deepEqual(result.attachmentIds, ['11111111-1111-1111-1111-111111111111'])
    assert.equal(result.items.find((entry) => entry.id === 'b')?.status, 'error')
  })

  it('reuses previous successes and retries only failures', async () => {
    const calls: string[] = []
    const existing: AttachmentUploadItem = {
      ...item('a', 'ok.pdf'),
      status: 'success',
      attachmentId: '11111111-1111-1111-1111-111111111111',
    }
    const result = await uploadAttachmentBatch([existing, { ...item('b', 'retry.pdf'), status: 'error' }], async (candidate) => {
      calls.push(candidate.id)
      return { success: true, attachmentId: '22222222-2222-2222-2222-222222222222' }
    })
    assert.deepEqual(calls, ['b'])
    assert.equal(result.success, true)
    assert.equal(result.attachmentIds.length, 2)
  })
})
```

- [ ] **Step 2: Run tests and confirm missing module**

Run: `npx tsx --test tests/regression/upload-batch.test.ts`  
Expected: FAIL because `upload-batch.ts` does not exist.

- [ ] **Step 3: Implement immutable explicit-result coordination**

```ts
export interface AttachmentUploadItem {
  id: string
  file: File
  status: 'pending' | 'uploading' | 'success' | 'error'
  attachmentId?: string
  error?: string
}

export type UploadOneAttachment = (item: AttachmentUploadItem) => Promise<
  | { success: true; attachmentId: string }
  | { success: false; error: string }
>

export interface AttachmentUploadBatchResult {
  success: boolean
  items: AttachmentUploadItem[]
  attachmentIds: string[]
}

export async function uploadAttachmentBatch(
  input: AttachmentUploadItem[],
  uploadOne: UploadOneAttachment,
  onItemChange?: (item: AttachmentUploadItem) => void
): Promise<AttachmentUploadBatchResult> {
  const items = [...input]
  for (let index = 0; index < items.length; index += 1) {
    const current = items[index]
    if (current.status === 'success' && current.attachmentId) continue
    const uploading = { ...current, status: 'uploading' as const, error: undefined }
    items[index] = uploading
    onItemChange?.(uploading)
    const result = await uploadOne(uploading)
    items[index] = result.success
      ? { ...uploading, status: 'success', attachmentId: result.attachmentId }
      : { ...uploading, status: 'error', error: result.error }
    onItemChange?.(items[index])
  }
  const attachmentIds = items.flatMap((entry) => entry.status === 'success' && entry.attachmentId ? [entry.attachmentId] : [])
  return { success: items.every((entry) => entry.status === 'success'), items, attachmentIds }
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx tsx --test tests/regression/upload-batch.test.ts && npx tsc --noEmit`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/attachments/upload-batch.ts tests/regression/upload-batch.test.ts
git commit -m "feat: add reliable attachment upload coordinator"
```

---

### Task 2: Authorized Solution-Draft Upload and Cleanup Actions

**Files:**

- Modify: `src/server-actions/files.ts`
- Create: `tests/regression/solution-upload-actions.test.ts`

**Interfaces:**

- Consumes: Task 1 policy/storage modules from the private-storage plan.
- Produces: `uploadSolutionDraftAttachmentAction(_previous, formData)` and `cleanupSolutionDraftAttachments({ requestId, attachmentIds })`.

- [ ] **Step 1: Write failing action-contract tests**

Read `src/server-actions/files.ts` and assert:

```ts
assert.match(source, /export async function uploadSolutionDraftAttachmentAction/)
assert.match(source, /role !== UserRole\.engineering/)
assert.match(source, /RequestStatus\.SentToEngineer/)
assert.match(source, /uploadedById: userId/)
assert.match(source, /solutionId: null/)
assert.match(source, /export async function cleanupSolutionDraftAttachments/)
assert.match(source, /uploadedById: userId/)
assert.doesNotMatch(source, /export async function prepareFileUpload/)
assert.doesNotMatch(source, /export async function confirmSolutionFileUpload/)
assert.doesNotMatch(source, /export async function uploadSolutionFileAction/)
```

- [ ] **Step 2: Run the test and confirm the new contract is absent**

Run: `npx tsx --test tests/regression/solution-upload-actions.test.ts`  
Expected: FAIL on missing draft action and legacy exports.

- [ ] **Step 3: Prove legacy actions have no callers**

Run:

```bash
grep -R "prepareFileUpload\|confirmFileUpload\|confirmSolutionFileUpload\|uploadSolutionFileAction\|getDownloadUrl" src tests --exclude=files.ts
```

Expected: no production callers. Remove the legacy interfaces, schemas, and actions only after this result.

- [ ] **Step 4: Implement draft upload authorization**

Require authentication, active engineering role, an existing non-deleted request in `SentToEngineer`, and the shared metadata policy. Store the attachment as `requestId=<target>`, `solutionId=null`, `uploadedById=<current user>`. Return a discriminated structured result:

```ts
type DraftUploadResult =
  | { success: true; attachmentId: string; fileAttachment: SerializedAttachment }
  | { success: false; error: string }
```

Serialize Date and Decimal values before crossing the Server Action boundary.

- [ ] **Step 5: Implement owner-only cleanup**

Validate a UUID array with maximum length 10. Query only records matching `requestId`, `solutionId:null`, `uploadedById:userId`, and the supplied IDs. Reject a count mismatch. Delete database records in a transaction, then delete physical files with `Promise.allSettled`; return cleanup warnings without deleting attachments owned by another user.

- [ ] **Step 6: Run focused tests and typecheck**

Run: `npx tsx --test tests/regression/solution-upload-actions.test.ts tests/regression/attachment-policy.test.ts && npx tsc --noEmit`  
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/server-actions/files.ts tests/regression/solution-upload-actions.test.ts
git commit -m "fix: authorize staged solution attachments"
```

---

### Task 3: Verify Attachment IDs During Initial Solution Submission

**Files:**

- Modify: `src/lib/schemas/solution-schemas.ts`
- Modify: `src/server-actions/solutions.ts`
- Modify: `tests/regression/solution-upload-actions.test.ts`

**Interfaces:**

- Consumes: staged attachments from Task 2.
- Produces: `submitSolutionSchema.fileIds` as at most 10 unique UUIDs; all-or-nothing attachment transfer.

- [ ] **Step 1: Add failing schema and transaction assertions**

Add direct schema tests:

```ts
assert.throws(() => submitSolutionSchema.parse({ ...validInput, fileIds: ['not-a-uuid'] }))
assert.throws(() => submitSolutionSchema.parse({ ...validInput, fileIds: Array.from({ length: 11 }, () => crypto.randomUUID()) }))
```

Add source assertions that the `submitSolution` transaction queries staged attachments using `uploadedById: user.id`, compares the number found with the number of unique IDs, and throws `One or more attachments are invalid or no longer available` before linking.

- [ ] **Step 2: Run tests and confirm permissive schema/transfer fail**

Run: `npx tsx --test tests/regression/solution-upload-actions.test.ts`  
Expected: FAIL because file IDs are unrestricted strings and transfer count is unchecked.

- [ ] **Step 3: Tighten the schema**

```ts
fileIds: z.array(z.string().uuid()).max(MAX_ATTACHMENTS_PER_FORM).refine(
  (ids) => new Set(ids).size === ids.length,
  'Attachment IDs must be unique'
).default([]),
```

- [ ] **Step 4: Verify then link inside the transaction**

Before `updateMany`, query `file_attachments.findMany` with all of:

```ts
{
  id: { in: validated.fileIds },
  requestId: validated.requestId,
  solutionId: null,
  uploadedById: user.id,
}
```

Compare `stagedAttachments.length` to `validated.fileIds.length`; throw on mismatch. Then update exactly those IDs. Assert the returned `updateMany.count` also matches before continuing.

- [ ] **Step 5: Run tests and typecheck**

Run: `npx tsx --test tests/regression/solution-upload-actions.test.ts tests/regression/budget-control.test.ts && npx tsc --noEmit`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/schemas/solution-schemas.ts src/server-actions/solutions.ts tests/regression/solution-upload-actions.test.ts
git commit -m "fix: verify solution attachment ownership"
```

---

### Task 4: Convert Resubmission from Raw Files to Attachment IDs

**Files:**

- Modify: `src/lib/schemas/solution-schemas.ts`
- Modify: `src/server-actions/solutions.ts`
- Modify: `tests/regression/solution-upload-actions.test.ts`

**Interfaces:**

- Consumes: staged IDs from Task 2.
- Produces: `resubmitSolution(input: ResubmitSolutionInput)` with `newFileIds` and `deletedFileIds`, never `File[]`.

- [ ] **Step 1: Add a failing resubmission schema test**

Define and test this interface:

```ts
export const resubmitSolutionSchema = z.object({
  requestId: z.string().uuid(),
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(5000),
  cost: z.number().positive(),
  currency: z.enum(['THB', 'USD', 'EUR']),
  timeline: z.string().min(1).max(500),
  newFileIds: z.array(z.string().uuid()).max(10).default([]),
  deletedFileIds: z.array(z.string().uuid()).max(10).default([]),
  useCustomHierarchy: z.boolean(),
  customApprovers: z.array(z.string().uuid()).default([]),
})
```

Assert the production source no longer declares `files: File[]` or calls `file.arrayBuffer()` inside `resubmitSolution`.

- [ ] **Step 2: Run tests and confirm raw-file behavior fails**

Run: `npx tsx --test tests/regression/solution-upload-actions.test.ts`  
Expected: FAIL on the old input and disk writes.

- [ ] **Step 3: Validate staged and deleted attachments before mutation**

Inside the transaction:

- Query `newFileIds` with target `requestId`, `solutionId:null`, and `uploadedById:userId`.
- Query `deletedFileIds` with `solutionId:<current solution>`.
- Require exact counts and unique IDs.
- Reject overlap between new and deleted ID sets.

- [ ] **Step 4: Perform DB changes atomically**

Update staged rows to `solutionId=<solution>`, `requestId=null`. Delete selected existing attachment rows inside the transaction. Return the deleted rows' file paths with the updated solution.

After the transaction commits, delete each returned physical path with `Promise.allSettled` and log attachment IDs for any cleanup warning. A physical cleanup warning must not roll back the successful solution resubmission.

- [ ] **Step 5: Run solution tests**

Run: `npx tsx --test tests/regression/solution-upload-actions.test.ts tests/regression/budget-control.test.ts tests/regression/gap-improvements.test.ts`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/schemas/solution-schemas.ts src/server-actions/solutions.ts tests/regression/solution-upload-actions.test.ts
git commit -m "refactor: resubmit solutions with attachment ids"
```

---

### Task 5: Shared React Hook for Upload, Retry, and Cleanup

**Files:**

- Create: `src/hooks/use-solution-attachments.ts`
- Modify: `src/components/solutions/solution-file-upload.tsx`
- Modify: `tests/regression/upload-batch.test.ts`

**Interfaces:**

- Consumes: coordinator from Task 1 and server actions from Task 2.
- Produces: `useSolutionAttachments({ requestId })` with `items`, `addFiles`, `removeItem`, `ensureUploaded`, `cleanupDrafts`, and `reset`.

- [ ] **Step 1: Extend coordinator tests for state callbacks and cleanup IDs**

Assert `onItemChange` receives `uploading` then terminal status and that `attachmentIds` includes both prior successes and new successes in item order.

- [ ] **Step 2: Implement the hook**

The hook owns `AttachmentUploadItem[]`. Use functional state updates keyed by stable item ID. `ensureUploaded()` snapshots current items, calls `uploadAttachmentBatch`, replaces state with `result.items`, and returns that result directly. Never inspect the pre-call React closure to decide success.

`removeItem(id)` calls cleanup first when the item has a staged `attachmentId`, then removes it. `cleanupDrafts()` submits all successful staged IDs to `cleanupSolutionDraftAttachments`. `reset()` clears local state only after cleanup returns.

- [ ] **Step 3: Update the upload presentation component**

`SolutionFileUpload` receives `items: AttachmentUploadItem[]` and event callbacks instead of parallel `files` and `filesWithProgress` props. Show server error text beside each failed file and expose a retry action by keeping failed items selectable.

- [ ] **Step 4: Run coordinator tests and diagnostics**

Run: `npx tsx --test tests/regression/upload-batch.test.ts && npx tsc --noEmit`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/use-solution-attachments.ts src/components/solutions/solution-file-upload.tsx tests/regression/upload-batch.test.ts
git commit -m "feat: share solution attachment state"
```

---

### Task 6: Use the Shared Flow in Dedicated and Modal Submission

**Files:**

- Modify: `src/components/solutions/solution-form.tsx`
- Modify: `src/components/requests/submitter-modal.tsx`
- Modify: `src/components/requests/request-modal-router.tsx`
- Modify: `src/app/(dashboard)/engineering/solutions/[requestId]/page.tsx`
- Modify: `tests/regression/solution-upload-actions.test.ts`

**Interfaces:**

- Consumes: Task 5 hook and ID-based submit/resubmit actions.
- Produces: consistent UI behavior across dedicated page, modal submit, and modal resubmit.

- [ ] **Step 1: Add failing source-wiring assertions**

Assert:

```ts
assert.match(solutionForm, /useSolutionAttachments/)
assert.match(submitterModal, /useSolutionAttachments/)
assert.doesNotMatch(router, /formData\.append\('file'/)
assert.doesNotMatch(router, /uploadFileAction/)
assert.doesNotMatch(router, /files: data\.files/)
assert.match(router, /newFileIds: data\.fileIds/)
```

- [ ] **Step 2: Run the test and confirm duplicated loops fail**

Run: `npx tsx --test tests/regression/solution-upload-actions.test.ts`  
Expected: FAIL because router and form still implement separate upload loops.

- [ ] **Step 3: Convert `SolutionForm`**

Replace `selectedFiles` upload logic with the hook. On confirmed submission:

1. Await `ensureUploaded()`.
2. If `success` is false, show `Some files failed to upload` and stop.
3. Call `submitSolution` with `result.attachmentIds`.
4. If metadata submission fails, retain successful items for retry.
5. On success, clear local state without deleting linked attachments.

Do not combine previous solution file IDs into a new solution. Remove `previousFiles` from this new-submission path; resubmission owns existing attachment editing.

- [ ] **Step 4: Convert `SubmitterModal` solution modes**

For `mode='solution'` and `mode='resubmit'`, create hook items from selected files, upload before invoking the parent callback, and pass `fileIds`. Keep request mode's post-request file flow unchanged. On close/cancel, await `cleanupDrafts()` before clearing fields and closing.

Update callback types:

```ts
onSubmitSolution?: (data: SolutionFields & { fileIds: string[] }) => Promise<{ success: boolean; error?: string }>
onResubmit?: (data: ResubmitFields & { newFileIds: string[]; deletedFileIds: string[] }) => Promise<{ success: boolean; error?: string }>
```

- [ ] **Step 5: Simplify router callbacks**

Remove dynamic imports and upload loops. Call `submitSolution` and `resubmitSolution` with IDs. Return structured success/error to the modal; only close and refresh after success.

- [ ] **Step 6: Run focused tests and typecheck**

Run: `npx tsx --test tests/regression/upload-batch.test.ts tests/regression/solution-upload-actions.test.ts && npx tsc --noEmit`  
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/solutions/solution-form.tsx src/components/solutions/solution-file-upload.tsx src/components/requests/submitter-modal.tsx src/components/requests/request-modal-router.tsx 'src/app/(dashboard)/engineering/solutions/[requestId]/page.tsx' tests/regression/solution-upload-actions.test.ts
git commit -m "fix: block solutions on attachment failures"
```

---

### Task 7: Logged-In Solution Attachment E2E

**Files:**

- Create: `tests/e2e/solution-attachment-upload.spec.ts`
- Modify: `package.json`
- Modify: `playwright.config.ts` — disable the local web server when `TEST_BASE_URL` targets an external test environment.

**Interfaces:**

- Consumes: completed solution upload UI.
- Produces: `npm run test:e2e:upload` release gate.

- [ ] **Step 1: Add the focused command**

```json
{
  "scripts": {
    "test:e2e:upload": "playwright test tests/e2e/solution-attachment-upload.spec.ts"
  }
}
```

- [ ] **Step 2: Create deterministic test files at runtime**

In `beforeAll`, use the existing `pdf-lib` dependency to create valid ASCII and Thai-named PDFs, then pad trailing bytes to deterministic sizes of 512 KB, 2.1 MB, and 9.5 MB plus a 10 MB + 1 byte rejection fixture. Remove them in `afterAll`. Do not commit large binary fixtures.

- [ ] **Step 3: Require explicit test environment**

The test reads:

```text
TEST_BASE_URL
E2E_ENGINEERING_EMAIL
E2E_ENGINEERING_PASSWORD
E2E_SENT_TO_ENGINEER_REQUEST_ID
E2E_UNRELATED_EMAIL
E2E_UNRELATED_PASSWORD
```

Throw a clear setup error when any is missing; do not silently `test.skip()` the release gate.

Update `playwright.config.ts` so an explicit `TEST_BASE_URL` disables the local `webServer`; otherwise keep the existing local development server:

```ts
const externalBaseUrl = process.env.TEST_BASE_URL

export default defineConfig({
  use: { baseURL: externalBaseUrl || 'http://localhost:3000' },
  webServer: externalBaseUrl ? undefined : {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
```

- [ ] **Step 4: Implement the browser matrix**

Log in, navigate to `/engineering/solutions/<request-id>`, select each accepted fixture, confirm submission, and assert no 413/500 response. For the Thai file, open preview and download, then assert `Content-Disposition` includes `filename*=UTF-8''`. For the oversized fixture, assert visible 10 MB validation and no upload request.

Before the final successful submission, add a partial-failure case by counting POST requests after selecting two files and fulfilling the second upload request with HTTP 500; assert solution submission remains open and the failed filename is visible. Retry the failed item, then complete one final solution submission containing the accepted boundary and Thai files. Sign out and request the captured attachment URL directly, expecting denial. Log in as the configured unrelated general-department user without request visibility and expect 403 from the attachment endpoint.

- [ ] **Step 5: Run against a disposable local/staging dataset**

Run: `npm run test:e2e:upload`  
Expected: PASS. This command may not target production or the VPS test instance unless the user explicitly supplies that target later.

- [ ] **Step 6: Commit**

```bash
git add tests/e2e/solution-attachment-upload.spec.ts package.json playwright.config.ts
git commit -m "test: cover solution attachment uploads"
```

---

### Task 8: Full Reliability Verification and Graph Refresh

**Files:**

- Verify all files changed by Tasks 1–7.
- Update: `graphify-out/`.

**Interfaces:**

- Consumes: all prior tasks.
- Produces: release-ready solution upload flow.

- [ ] **Step 1: Run focused tests**

```bash
npx tsx --test \
  tests/regression/attachment-policy.test.ts \
  tests/regression/attachment-storage.test.ts \
  tests/regression/upload-batch.test.ts \
  tests/regression/solution-upload-actions.test.ts \
  tests/regression/file-preview.test.ts
```

Expected: all pass.

- [ ] **Step 2: Run repository verification**

```bash
npm run check
npm run build
git diff --check
```

Expected: zero failures.

- [ ] **Step 3: Run the logged-in release gate**

Run: `npm run test:e2e:upload`  
Expected: PASS with an explicitly configured disposable request fixture. If credentials/data are unavailable, record the gate as pending and do not claim the upload flow is fully verified.

- [ ] **Step 4: Refresh Graphify**

Run: `graphify update .`  
Expected: graph updated without corruption warnings.

- [ ] **Step 5: Commit graph changes if tracked**

```bash
git add graphify-out
git commit -m "chore: refresh upload workflow graph"
```

Skip only when there are no tracked graph changes.
