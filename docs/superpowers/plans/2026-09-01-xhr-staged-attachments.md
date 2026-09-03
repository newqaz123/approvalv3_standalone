# XHR Staged Attachments (Request Flow) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Request attachments upload via XHR with REAL byte-level progress to a staging area BEFORE submit; `createRequest` then commits request + attachments atomically — a request can never exist without its files, so no rollback is needed.

**Architecture:** Stage-then-commit. New authenticated route handler stages validated files under `uploads/stage/<stagedId>/` (same pattern as inline description images' session staging). A new hook uploads via `XMLHttpRequest` (`upload.onprogress` = true 0–100%) and owns retry/remove/cancel cleanup. `createRequest` receives `stagedAttachments[]`, verifies + renames each staged file to its final path, then inserts request + approvals + attachment rows in ONE transaction. Notifications fire only on atomic success (no email for doomed requests). The client-side upload loop, `rollbackCreatedRequest`, and the request-mode progress-callback machinery are removed.

**Tech Stack:** Next.js App Router route handler, XHR, zod, Prisma transaction, existing attachments storage/policy libs, node:test via tsx.

**Spec:** User decision 2026-09-01 ("XHR + atomic"), prior review findings on this branch.

## Global Constraints

- `npm run check` green after every task (baseline 1111 pass).
- Staged files live ONLY under `uploads/stage/<uuid>/` — the DELETE endpoint must reject any path outside that subtree (path-traversal + other-users'-files protection).
- Reuse `validateAttachmentMetadata` + `ATTACHMENT_EXTENSIONS` for all validation; server re-verifies size via fs stat in createRequest.
- Submit is blocked while any staged upload is in flight (mirror the existing inline-image blocking-guidance pattern).
- Scope: request flow ONLY (SubmitterModal request mode + its two callers). Solution/resubmit flows keep `useSolutionAttachments`.
- E2e-asserted strings stay intact ("Review & Submit", "Confirm & Submit", heading "Submit Solution").
- Reviewer gate: one full-diff review before committing.

---

### Task 1: Staging storage helpers (TDD)

**Files:**
- Modify: `src/lib/attachments/storage.ts`
- Test: `tests/regression/staged-attachment-storage.test.ts` (new)

**Interfaces:**
- Produces:
  ```ts
  export function createStagedAttachmentPath(stagedId: string, originalName: string): string  // `stage/<stagedId>/<normalized-name>`
  export async function attachmentFileExists(storedPath: string): Promise<boolean>
  export function isStagedAttachmentPath(storedPath: string): boolean  // true only for `stage/<uuid>/...`
  ```

- [ ] Step 1: Failing tests — `createStagedAttachmentPath('uuid','a b.pdf')` → `stage/uuid/a_b.pdf`-style normalized, no `..`, no leading `/`; `isStagedAttachmentPath` true for stage paths, false for `uploads/<requestId>/x`, `../stage/x`, absolute paths.
- [ ] Step 2: Run → FAIL.
- [ ] Step 3: Implement (mirror `createStoredAttachmentPath` normalization; uuid regex check).
- [ ] Step 4: Run → PASS. Commit `feat: staged attachment path helpers`.

### Task 2: Stage + cleanup route handler

**Files:**
- Create: `src/app/api/attachments/stage/route.ts`
- Reference auth: `src/app/api/actions/pending-count/route.ts` (same session pattern)

**Interfaces:**
- Produces:
  - `POST /api/attachments/stage` — multipart `file`; 200 `{ stagedPath, fileName, fileType, fileSize }` (writes via `writeAttachmentFile`); 401 unauthenticated; 400 validation error (policy message); 500 write failure.
  - `DELETE /api/attachments/stage` — JSON `{ stagedPath }`; 200; 400 when `!isStagedAttachmentPath(storedPath)` or traversal; 404 when missing (idempotent OK).

- [ ] Step 1: Implement POST + DELETE with auth, `validateAttachmentMetadata`, staged path generation, `writeAttachmentFile`, size from stat.
- [ ] Step 2: `npx tsc --noEmit` clean.
- [ ] Step 3: Manual curl checks against dev server (auth cookie): upload ok; DELETE rejects `../` and non-stage path; DELETE idempotent.
- [ ] Step 4: Commit `feat: staged attachment upload + cleanup endpoint`.

### Task 3: Atomic createRequest with stagedAttachments

**Files:**
- Modify: `src/server-actions/requests.ts` (createRequest schema + body)

**Interfaces:**
- Consumes: Task 1 helpers, `deleteAttachmentFile`.
- Produces: `createRequest` input gains `stagedAttachments?: Array<{ stagedPath: string; fileName: string; fileType: string; fileSize: number; description?: string }>` — legacy `files`/loop callers are gone after Task 5, so no dual-mode.

- [ ] Step 1: Schema: `stagedAttachments` array (zod, max MAX files, each with stagedPath/fileName/fileType/fileSize/description?).
- [ ] Step 2: Pre-tx: for each item — `isStagedAttachmentPath` guard, `attachmentFileExists`, stat-size must equal declared size, compute final path `createStoredAttachmentPath(request.id …)` — NOTE request id only exists post-tx; generate the request UUID up-front (`crypto.randomUUID()` passed into tx create) so final paths are known pre-tx; `fs.rename` staged → final; any failure → return `{ success:false, error }` with nothing created (rename-first: a tx failure after rename leaves an orphan FILE, invisible + harmless).
- [ ] Step 3: Tx inserts `file_attachments` rows (filePath = final path, metadata from item).
- [ ] Step 4: Unit-style contract test in `tests/regression/request-staged-attachments.test.ts`: source asserts — schema contains stagedAttachments; rename happens before `prisma.$transaction`; rows created inside tx; notifications still created only after tx success.
- [ ] Step 5: `npm run check` green. Commit `feat: atomic request creation with staged attachments`.

### Task 4: XHR staging hook

**Files:**
- Create: `src/hooks/use-staged-request-attachments.ts`
- Test: `tests/regression/use-staged-request-attachments.test.ts` (source-contract: XHR usage, onprogress wiring, retry/remove/reset call DELETE)

**Interfaces:**
- Produces:
  ```ts
  useStagedRequestAttachments(): {
    items: StagedItem[];              // { id, file, status: 'pending'|'uploading'|'success'|'error', progress: 0-100 (real bytes), stagedPath?, error? }
    addFiles(files: File[]): void;    // starts XHR upload per file (parallel)
    retryItem(id: void): void;
    removeItem(id: void): void;       // DELETEs staged file if uploaded
    reset(): Promise<void>;           // DELETEs all staged files (cancel/close path)
    hasBlockingOperations: boolean;   // any uploading
    readyAttachments: StagedAttachmentInput[]; // success items for submit
  }
  ```

- [ ] Step 1: Implement XHR wrapper (POST FormData; `xhr.upload.onprogress` → progress = loaded/total*100 rounded; onload 2xx parse JSON → stagedPath; error/retry states; abort in-flight on remove).
- [ ] Step 2: Contract test + `npm run check`. Commit `feat: XHR staged attachment hook with real progress`.

### Task 5: SubmitterModal request mode + callers

**Files:**
- Modify: `src/components/requests/submitter-modal.tsx`
- Modify: `src/components/requests/requests-list-client.tsx`, `src/components/dashboard/follow-up-dashboard.tsx`
- Modify: `src/lib/attachments/upload-progress.ts` (remove `RequestUploadProgress`/`requestPhaseLabel`; keep `describeUploadProgress`)
- Modify tests: `upload-progress.test.ts`, `request-upload-progress-wiring.test.ts`, `inline-image-form-wiring.test.ts`

- [ ] Step 1: Modal request mode uses the hook: per-row REAL `Progress` bar + `%`, Retry on error, remove (disabled while uploading), description input on success items; amber guidance + disabled submit while `hasBlockingOperations`.
- [ ] Step 2: `onSubmitRequest` data: replace `files: File[]` with `stagedAttachments: StagedAttachmentInput[]`; modal calls `reset()` (clear WITHOUT delete) after confirmed success; cancel/close → `await reset()` with delete (mirror existing inlineImages cancel handling).
- [ ] Step 3: Both callers: drop upload loop / rollback helper / progress callback — `createRequest({...form, stagedAttachments})` only; success → toast + close; failure → error shown, modal stays (staged files remain for retry).
- [ ] Step 4: Remove `rollbackCreatedRequest` from requests.ts and all rollback wiring tests; update the three test files to the new contracts.
- [ ] Step 5: `npm run check` green. Commit `feat: request submit uses staged XHR uploads atomically`.

### Task 6: Browser verification + reviewer gate

- [ ] Step 1: Portly dev server; browser: attach 3 files → REAL % bars advance; remove one → staged file gone from disk; submit → request created with all files; modal cancel → staged files cleaned.
- [ ] Step 2: Failure path: chmod 555 uploads → staging fails pre-submit with red error + Retry (no request ever created; nothing to roll back).
- [ ] Step 3: Dispatch reviewer on full uncommitted-feature diff; fix findings; commit fixes.
- [ ] Step 4: `graphify update .` post-merge (main checkout).
