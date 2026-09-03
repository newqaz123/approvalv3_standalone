# Attachment Upload Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Users can always see what they're waiting for during attachment uploads on request submit (SubmitterModal) and solution submit (SubmitterModal + solution page flow).

**Architecture:** Add a pure `describeUploadProgress()` helper (count-based, honest — no fake percentages) shared by all three upload surfaces. Extend `onSubmitRequest` with an optional progress callback so the two live callers (requests-list-client, follow-up-dashboard) can report the create→upload→finalize phases to the modal. Fix the phantom `progress`% render bug in solution-preview.

**Tech Stack:** Next.js App Router, React hooks, shadcn/ui (Button, Progress), lucide-react (Loader2), node:test via tsx for regression tests.

**Spec:** Audit conversation 2026-09-01 (upload UX audit of request-form.tsx, solution-form.tsx, submitter-modal.tsx, solution-file-upload.tsx, solution-preview.tsx).

## Global Constraints

- Run `npm run check` after code changes; it must stay green (baseline: 1097 tests pass).
- No fake byte-level percentages — the batch coordinator has no real progress events; use honest count-based labels ("Uploading 2/3 — invoice.pdf").
- Keep e2e-asserted strings intact: button "Review & Submit", "Confirm & Submit", heading "Submit Solution" (tests/e2e/solution-attachment-upload.spec.ts).
- `AttachmentUploadItem` (src/lib/attachments/upload-batch.ts) has NO `progress` field — never render `item.progress`.
- Solution/resubmit modal modes upload through `useSolutionAttachments` → `ensureUploaded()`; request mode uploads inside callers after `createRequest` returns `requestId` (uploads need requestId).
- TypeScript strict: no implicit any.

---

### Task 1: Pure upload-progress helper (TDD)

**Files:**
- Create: `src/lib/attachments/upload-progress.ts`
- Test: `tests/regression/upload-progress.test.ts`

**Interfaces:**
- Consumes: `AttachmentUploadItem` from `src/lib/attachments/upload-batch.ts` (fields: `id`, `file: File`, `status: 'pending'|'uploading'|'success'|'error'`, `error?`).
- Produces:
  ```ts
  export interface UploadProgressSummary {
    active: boolean;            // any item currently uploading
    doneCount: number;          // success + error (terminal)
    totalCount: number;         // all items
    currentName?: string;       // first uploading item's file name
    label: string | null;       // "Uploading 2/3 — invoice.pdf" or null when idle
  }
  export function describeUploadProgress(items: AttachmentUploadItem[]): UploadProgressSummary;
  export function requestPhaseLabel(p: RequestUploadProgress | null): string | null;
  export interface RequestUploadProgress {
    phase: 'creating' | 'uploading' | 'finalizing';
    uploaded: number;   // files finished (success or failed)
    total: number;
    fileName?: string;  // file currently uploading
  }
  ```

- [ ] **Step 1: Write failing tests** covering: empty list → idle; one uploading → label "Uploading 1/1 — <name>"; mix success+uploading → "Uploading 2/3 — <name>"; all terminal → idle (label null); requestPhaseLabel null → null; creating → "Creating request..."; uploading → "Uploading 2/3 — <name>"; finalizing → "Finalizing..."; uploading with 0 total → "Uploading files...".
- [ ] **Step 2: Run** `npx tsx --test tests/regression/upload-progress.test.ts` → expect FAIL (module not found).
- [ ] **Step 3: Implement** `describeUploadProgress` + `requestPhaseLabel` (pure, no React).
- [ ] **Step 4: Re-run** → PASS.
- [ ] **Step 5: Commit** `feat: add upload progress summary helpers`

### Task 2: Fix phantom `%` in solution preview

**Files:**
- Modify: `src/components/solutions/solution-preview.tsx:188-194`

**Interfaces:**
- Consumes: `describeUploadProgress` from Task 1.

- [ ] **Step 1:** Replace `{isUploading && (<p ...>Uploading... {fileItem.progress}%</p>)}` with `{isUploading && (<p className="flex items-center gap-1.5 text-xs text-blue-600 mt-1"><Loader2 className="h-3 w-3 animate-spin" />{summaryLabel}</p>)}` where `summaryLabel = describeUploadProgress(data.files).label` computed once above the map; import `Loader2` from lucide-react and the helper. Remove the nonexistent `fileItem.progress` reference.
- [ ] **Step 2:** `npx tsc --noEmit` → clean.
- [ ] **Step 3:** Commit `fix: replace phantom progress percent with spinner + count label in solution preview`

### Task 3: Progress bar in SolutionFileUpload (solution page flow)

**Files:**
- Modify: `src/components/solutions/solution-file-upload.tsx:285-320`

**Interfaces:**
- Consumes: `describeUploadProgress` (Task 1), shadcn `Progress` (src/components/ui/progress.tsx), `Loader2`.

- [ ] **Step 1:** Compute `const progress = describeUploadProgress(items)` in component body. For the row where `showProgress`, render `<Loader2 className="h-4 w-4 animate-spin text-gray-400" />` in place of the plain file icon area OR beside name, and replace static "Uploading..." with `{progress.label ?? 'Uploading...'}`. Below the row content, when `showProgress`, render `<Progress value={(progress.doneCount / Math.max(progress.totalCount, 1)) * 100} className="h-1.5 mt-2" />`.
- [ ] **Step 2:** `npx tsc --noEmit` → clean.
- [ ] **Step 3:** Commit `feat: show count-based progress bar during solution attachment upload`

### Task 4: SubmitterModal busy feedback (all modes)

**Files:**
- Modify: `src/components/requests/submitter-modal.tsx` (footer buttons ~1177-1213, solution-mode file rows ~1094-1098)

**Interfaces:**
- Consumes: `describeUploadProgress` (Task 1) over `attachmentItems`, `Loader2`.
- Produces: busy button text change only — no prop signature changes in this task.

- [ ] **Step 1:** Compute `const uploadProgress = describeUploadProgress(attachmentItems)`. In solution/resubmit file rows, replace `Uploading...` with spinner + `{uploadProgress.label}`. In footer submit Button, when `isBusy` render `<Loader2 className="w-4 h-4 mr-1.5 animate-spin" />` and text `Submitting...` (replace mode-specific label; keep Send/CheckCircle2/RotateCcw icons when not busy).
- [ ] **Step 2:** `npx tsc --noEmit` → clean.
- [ ] **Step 3:** Commit `feat: add busy spinner and upload count feedback to submitter modal`

### Task 5: Request-mode upload progress via caller callback

**Files:**
- Modify: `src/components/requests/submitter-modal.tsx` (props type ~L40, handleSubmit request branch ~577, request-mode file rows ~1131-1170)
- Modify: `src/components/requests/requests-list-client.tsx:35-70`
- Modify: `src/components/dashboard/follow-up-dashboard.tsx:56-95`

**Interfaces:**
- Consumes: `RequestUploadProgress`, `requestPhaseLabel` (Task 1).
- Produces: `onSubmitRequest?: (data: SubmitRequestData, onUploadProgress?: (p: RequestUploadProgress) => void) => Promise<{ success: boolean; error?: string }>` — second param optional so existing callers stay type-valid.

- [ ] **Step 1:** In submitter-modal props, add optional second callback param to `onSubmitRequest`. Add `const [requestProgress, setRequestProgress] = useState<RequestUploadProgress | null>(null)`; reset to null when modal opens/submit starts; in request branch call `await onSubmitRequest({...}, setRequestProgress)`.
- [ ] **Step 2:** Request-mode file rows: derive per-row status from `requestProgress` — index < uploaded → `<CheckCircle2 className="h-4 w-4 text-green-600" />`; index === uploaded && phase==='uploading' → `<Loader2 className="h-4 w-4 animate-spin text-blue-600" />` + label `requestPhaseLabel(requestProgress)` shown once above the list; else keep Trash2 remove button (hidden while busy).
- [ ] **Step 3:** In `requests-list-client.tsx` `handleSubmitRequest`: accept `(data, onUploadProgress?)`; call `onUploadProgress?.({phase:'creating',uploaded:0,total:data.files.length})` before createRequest; inside loop per file `onUploadProgress?.({phase:'uploading',uploaded:i,total,fileName:file.name})`; after loop `onUploadProgress?.({phase:'finalizing',uploaded:total,total})`.
- [ ] **Step 4:** Mirror Step 3 in `follow-up-dashboard.tsx` `handleSubmitRequest`.
- [ ] **Step 5:** `npx tsc --noEmit` → clean; `npm run check` full → green.
- [ ] **Step 6:** Commit `feat: surface per-file upload progress in request submitter modal`

### Task 6: Final verification

- [ ] **Step 1:** `npm run check` (tsc + tests) green.
- [ ] **Step 2:** `graphify update .` to refresh the navigation graph.
- [ ] **Step 3:** Summarize changed files + follow-ups (mobile duplicate list, simulated progress on orphaned request-form page, router submitter case passing no onSubmitRequest).
