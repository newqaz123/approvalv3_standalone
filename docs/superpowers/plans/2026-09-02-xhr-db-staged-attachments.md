# XHR DB-Backed Request Draft Attachments

**Supersedes:** Tasks 4–6 of `2026-09-01-xhr-staged-attachments.md`. The abandoned filesystem lifecycle diff is preserved at `.superpowers/sdd/2026-09-01-xhr-staged-attachments/abandoned-filesystem-lifecycle.patch`.

**Goal:** True XHR byte progress with no rollback. Each upload becomes an owner-scoped draft `file_attachments` row. `createRequest` adopts only ready draft IDs in the same DB transaction as request, approvals, activities, and status.

**Why:** The previous stateless filesystem staging design required a custom distributed lock/crash-recovery protocol and still had load-bearing races after five review rounds. This design reuses the application’s reviewed solution-draft pattern and existing nullable `file_attachments.requestId`; no schema migration is needed.

## Global constraints

- Request flow only; solution/resubmit flows and exact E2E strings remain unchanged.
- Real percentages come only from `xhr.upload.onprogress` loaded/total.
- No request rollback action or client rollback loop.
- No filesystem lock/state/tombstone protocol.
- Draft ownership is enforced by `uploadedById`; draft rows require `requestId:null`, `solutionId:null`.
- Ready drafts are identified only by a server-controlled `filePath` prefix.
- IDs are canonical UUIDs, unique, max `MAX_ATTACHMENTS_PER_FORM`.
- Request + draft adoption + approvals + activities + status commit in one Prisma transaction.
- Notifications run only after transaction success.
- Use Portly for tests/build/server. Reviewer approval before every commit.

### Task 1: DB-backed XHR stage + cleanup route

**Files:**
- Modify `src/app/api/attachments/stage/route.ts`
- Simplify `src/lib/attachments/storage.ts` to path helpers only
- Tests `tests/regression/staged-attachment-route.test.ts`, `staged-attachment-storage.test.ts`

**Contract:**
- POST multipart `{ file, attachmentId }`.
- Auth + shared metadata validation.
- Server creates/updates only an owner-scoped unowned draft row (`requestId:null`, `solutionId:null`).
- Each POST uses a server generation UUID and an uploading path; concurrent/retried generations finalize with a conditional `updateMany` on the exact uploading path. A stale/lost generation cleans its file and cannot overwrite the row.
- Transition file from uploading to a stable ready path before conditional DB finalize. Retry cleans prior uploading/derived-ready paths known from the existing row.
- Response `{ attachmentId, fileName, fileType, fileSize }` only after row is ready.
- DELETE JSON `{ attachmentId }`: conditional owner-scoped draft-row delete; delete physical path only when DB delete count is 1. 404 when absent; never delete an adopted file.
- Focused behavior tests: auth/policy, owner mismatch, successful finalize, concurrent stale generation, abort/delete-before-finalize, retry crash paths, DELETE-vs-adopt conditional safety.

### Task 2: Atomic createRequest adopts ready draft IDs

**Files:**
- Modify `src/server-actions/requests.ts`
- Reuse transaction-capable `createApprovalChain` in `src/server-actions/approvals.ts`
- Update `tests/regression/request-staged-attachments.test.ts`

**Contract:**
- Replace `stagedAttachments` metadata with `stagedAttachmentIds: UUID[]` (unique, max 10, default []).
- Before/inside transaction verify every selected row is owner-scoped, unowned, and has a ready request-draft path; verify files exist.
- Inside the SAME transaction: create request, conditional `updateMany` adopting all IDs via `requestId:newRequest.id`, exact count check, inline-image reconciliation, creation activity, approval chain, top-level status/activity.
- No file rename during submit: ready path stays stable after adoption.
- Notifications after successful transaction only.

### Task 3: XHR request-draft hook

**Files:**
- Create `src/hooks/use-staged-request-attachments.ts`
- Update `tests/regression/use-staged-request-attachments.test.ts`

**Contract:**
- Client generates stable `attachmentId` UUID per item and POSTs it with the file.
- `xhr.upload.onprogress` is the only percentage source.
- Status: pending/uploading/success/error; success stores server attachmentId metadata.
- Retry reuses attachmentId; stale attempt callbacks ignored.
- Remove/reset DELETE by attachmentId and keep row on cleanup failure; cleanup-pending/error items excluded from ready IDs and block submit.
- `clear()` after successful commit drops local state without DELETE.

### Task 4: Modal + callers

**Files:**
- Modify `src/components/requests/submitter-modal.tsx`
- Modify `src/components/requests/requests-list-client.tsx`
- Modify `src/components/dashboard/follow-up-dashboard.tsx`
- Simplify `src/lib/attachments/upload-progress.ts`
- Update relevant regression tests

**Contract:**
- Request mode uses the hook and renders true percent/progress, retry, cleanup errors, descriptions if supported by draft metadata.
- Submit blocks during upload/cleanup or if any item errored.
- `createRequest({ ..., stagedAttachmentIds })` only; no post-create upload loop, rollback, or request progress callback.
- Failure keeps drafts/form for retry. Success calls local `clear()`, closes, refreshes.
- Cancel/remove awaits/uses owner-scoped DELETE cleanup.
- Solution/resubmit modes unchanged.

### Task 5: Verification + final review

- Portly `npm run check`.
- Browser via Portly + agent-browser: real XHR progress, retry/remove/cancel, success with all attachments, forced upload failure creates no request, notifications only after submit success.
- Final whole-branch reviewer; one fix wave maximum.
- After merge: `graphify update .` on main.
