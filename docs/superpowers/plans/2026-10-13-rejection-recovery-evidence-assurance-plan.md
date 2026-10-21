# Rejection/Recovery Evidence Assurance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans after explicit implementation approval, task-by-task with one writer and no child delegation. Steps use checkbox (`- [ ]`) syntax. This revision authorizes documentation only.

**Goal:** Produce fail-closed, action-specific evidence for two fresh 44-case supported-scope passes without changing permanent product behavior.

**Architecture:** Pure contracts/validators stay in matrix support; real context/action capture stays in the manual driver; owned-copy AST generation and compilation stay in matrix runtime. Eleven original server exports are observed only in generated disposable copies, using their existing auth and transaction results. Durable action/negative/case gates precede further business work; no telemetry result substitutes for business truth.

**Tech Stack:** Existing TypeScript/compiler API, node:test/tsx, Playwright 1.58.2, Next 15.5.23, node:crypto/fs; no dependencies.

**Spec:** `docs/superpowers/specs/2026-10-13-rejection-recovery-evidence-assurance-design.md` (revision 3).

**Provenance:** Revision 3 is one narrow correction of revision-2 provenance/deadline findings. Revision 2 and its critique remain at `test-results/rejection-recovery-20261011/assurance-20261013/blocked-plan-v2-20261013T154236Z/`; revision 1 remains at `blocked-plan-v1-20261013T124140Z/`. All prior reviews/handoffs/checkpoints stay untouched; the six resolved blueprint contracts are retained. READY_FOR_REVIEW means plan readiness only. Source navigation began with the existing Graphify query for `runMatrixCase playwrightMatrixUi initiateFinalApproval`; direct TypeScript AST inspection verified all eleven signatures/auth/transaction sites. No AST/LSP extension skill was available; installed TypeScript was used read-only.

## Global Constraints

- Future checked-in edits: **only** `tests/support/rejection-recovery-matrix.ts` (S), `tests/manual/rejection-recovery-matrix.ts` (M), `tests/support/native/rejection-recovery-runtime.ts` (R), `tests/regression/rejection-recovery-matrix.test.ts` (T). All new regressions belong to T.
- No product/UI/config/dependency/env/schema/shared-fixture changes or permanent logging. Generated app-copy transforms are proposed diagnostics, not already implemented or authorized for execution.
- One fresh empty owned runtime per profile-pass; new request per case; 4 profiles × 2 serial passes = 8 invocations, 44 distinct IDs **in each pass**, 88 fresh executions. Historical 29 are context only.
- Exactly one original mutation call; no retry/replay/API injection. Preserve route/co-candidate/current-turn/phase/custom/UUID/seed/ownership/read-only guards and original 86 focused regressions. Historical full 3285 pass/0 fail/1 skip is retained context, not a forecast or a new check result.
- Missing dispatch/result/handler/actor/targets/current-turn/source/build/snapshot/artifact proof fails evidence. Observer failures after invocation never replace original return/throw. No sleeps/business retries/timeout increases as an RRM-030 fix.
- No stage/commit/reset/stash/push. Each future task ends with a durable reviewed diff/hash checkpoint, not a commit. No code generation/runtime/DB/browser/probes/SQL/npm checks in this documentation stage.
- Future validation only: `npx tsx --test tests/regression/rejection-recovery-matrix.test.ts`; `npm run check` (exact script: `npx tsc --noEmit && npm run test:manage && npx tsx --test tests/regression/*.test.ts`); `graphify update .`. Report actual test totals/exits; do not guess a new count or convert unavailable checks to pass.

## Review Focus

1. **RF1 False correlation:** wrong/absent server handler, actor, phase/attempt/group/current turn/response/build must fail even with green UI and FINAL rows (Task 1).
2. **RF2 Failure masking:** committed original plus observer/UI failure stays proven committed but fails evidence/case; original exception identity and combined cleanup errors survive (Tasks 2, 5).
3. **RF3 Negative boundary:** old held target versus fresh Completed baseline, immutable immediate pair including mail; UI-only absence is not backend denial (Tasks 1, 4).
4. **RF4 Capture/shutdown:** real factory registration, late/missing/unfinished Flight/JS bodies, pending writes and bounded cancellation cannot deadlock owned stop (Task 3).
5. **RF5 Actual callers:** default opener matcher and actual resubmit/initiate/approval callers are tested, not merely overridden newContext/callback counts (Tasks 3–5).

---

## Source map and complete action registry

`runMatrixCase` is **S:1063**, not M; `ensureResubmitSolutionOpenerReadyAndOpen` is **M:1111** (30,000 ms unchanged); `playwrightMatrixUi` is **M:199**, nested `newContext` M:201–289; case gate M:1031; session/aggregate M:1141–1283. R:250–266 currently only copies; R:533–579 currently does not compile an instrumented copy. T:2369–2377 replaces newContext in the existing FakeRrm023 drive; that test alone cannot prove observer registration.

Handler IDs below are source module/export identities; **never** hardcoded future wire fingerprints. M methods always use real UI business clicks. Router is `src/components/requests/request-modal-router.tsx` (C); create surface also `requests-list-client.tsx:42`. All optional arguments remain optional, and the router decision calls currently pass only two arguments (no asserted expectedUpdatedAt third argument).

| Logical action / phase | Actual module/export and server arguments | Actual UI caller | Baseline → mandatory persisted proof |
|---|---|---|---|
| submit-request / REQUEST | `requests.ts:116 createRequest(input: CreateRequestInput)` | M.createRequest; requests-list-client:42 | unique title/content hash, actor, request absent → RequestCreateEvidence, returned requestId/requester, ImprovementRequest, REQUEST a1/current route rows/audit |
| resubmit / REQUEST | `requests.ts:2211 resubmitRequest({requestId,title?,description?,inlineImageSessionId?})` | M.resubmit; C:645 | RevisionBaseline REQUEST → ResubmitEvidence, exact prior/new REQUEST attempts, supersession, no carried approvals/full intended new chain |
| approve-step / REQUEST | `approvals.ts:93 approveRequest(requestId, comments?, expectedUpdatedAt?: string\|Date)` | M.approveStep; C:547 | ActionBaseline REQUEST → ApprovalEvidence, exact row/actor/order/attempt, next turn or phase outcome |
| confirm-rejection / REQUEST | `approvals.ts:174 rejectRequest(requestId, comments, expectedUpdatedAt?: string\|Date)` | M.rejectCurrentStep; C:589 | ActionBaseline → RejectionEvidence REQUEST, exact reason/rejector/row, ImprovementRequest, rejected instance/history/audit |
| submit-solution / SOLUTION | `solutions.ts:260 submitSolution(input: SubmitSolutionActionInput)` | M.submitSolution; C:1049 | request SentToEngineer, SOLUTION absent → SolutionSubmitEvidence, returned solutionId, SOLUTION a1, DesignCostEstimationApproval, exact full new chain/route |
| resubmit / SOLUTION (including FINAL recovery) | `solutions.ts:1685 resubmitSolution(input: ResubmitSolutionActionInput)` | M.resubmit; C:1105 (also C:821 resubmit surface) | RevisionBaseline SOLUTION (rejected, or approved after FINAL reject) → ResubmitEvidence, same request/solution identity, fresh SOLUTION attempt, superseded prior, no carried approvals/full chain |
| approve-step / SOLUTION | `solutions.ts:809 approveSolution(solutionId, comments?, expectedUpdatedAt?: string\|Date)` | M.approveStep; C:544 | ActionBaseline SOLUTION → ApprovalEvidence; exact solution→request binding, next turn or SendBackToRequester |
| confirm-rejection / SOLUTION | `solutions.ts:900 rejectSolution(solutionId, comments, expectedUpdatedAt?: string\|Date)` | M.rejectCurrentStep; C:586 | ActionBaseline → RejectionEvidence SOLUTION, exact row/reason/actor, SentToEngineer/audit |
| initiate-final / FINAL | `solutions.ts:1204 initiateFinalApproval(requestId, useCustomChain: boolean, customApproverIds?: string[])` | M.initiateFinal; C:1158 | SendBackToRequester, expected phase-local FINAL attempt → FinalInitiationEvidence, fresh FINAL instance/rows/full chain, FinalApproval |
| approve-step / FINAL | `solutions.ts:1458 approveFinalApproval(requestId, comments?, expectedUpdatedAt?: string\|Date)` | M.approveStep; C:537 | ActionBaseline FINAL → ApprovalEvidence exact row/actor/current turn, next turn or Completed |
| confirm-rejection or stale-confirm-rejection / FINAL | `solutions.ts:1536 rejectFinalApproval(requestId, comments, expectedUpdatedAt?: string\|Date)` | M.rejectCurrentStep/M.openHeldRejectDialog.staleConfirm; C:580 | positive: RejectionEvidence FINAL/SentToEngineer; stale: held old target + fresh Completed baseline → specific unchanged denial, no commit |

Create input: title, description, inlineImageSessionId?, stagedAttachmentIds?. Submit input follows `src/lib/schemas/solution-schemas.ts:35–61`: requestId/title/description/inlineImageSessionId?, costEstimate?, currency, timeline?, conceptDesign?, useCustomApprovals, customApproverIds?, fileIds. Resubmit input :71–100: requestId/title/description/inlineImageSessionId?, cost/currency/timeline, newFileIds/deletedFileIds/useCustomHierarchy/customApprovers. Types are existing schema-derived inputs with optional inlineImageSessionId; do not invent cost/title argument positions. Actual C mappings :1049–1062 and :1105–1118 are authoritative. Keep original validation/defaults.

## Shared contracts (new in S unless explicitly assigned to R/M)

These are planned interfaces, not claims that exports already exist. Existing evidence types above are reused; stronger validation makes their currently optional observed fields mandatory where applicable.

```ts
export type HandlerKey =
  | 'requests.createRequest' | 'requests.resubmitRequest'
  | 'approvals.approveRequest' | 'approvals.rejectRequest'
  | 'solutions.submitSolution' | 'solutions.resubmitSolution'
  | 'solutions.approveSolution' | 'solutions.rejectSolution'
  | 'solutions.initiateFinalApproval'
  | 'solutions.approveFinalApproval' | 'solutions.rejectFinalApproval'
export type JsonValue = null | boolean | number | string | JsonValue[]
  | { [key: string]: JsonValue }
export interface ArtifactRef { path: string; sha256: string; bytes: number }
export interface ClockMark { domain: string; monotonicMs: number; wallMs: number }
export interface ActionIdentity extends RunBinding {
  caseId: string; contextId: string; sequence: number
} // RunBinding is defined in Task 5; acquired before the attempting record.
export interface RowlessTarget {
  requestId: string | null; solutionId: string | null; phase: Phase
  previous: RevisionBaseline | null; expectedAttempt: number
  expectedChain: readonly string[]; titleSha256: string
}
export interface DecisionTarget extends ActionBaseline {
  candidateGroupId: string | null; currentOrder: number
}
export type ActionSpec =
  | { kind: 'create'; handler: 'requests.createRequest'; target: RowlessTarget }
  | { kind: 'submit-solution'; handler: 'solutions.submitSolution'; target: RowlessTarget }
  | { kind: 'initiate-final'; handler: 'solutions.initiateFinalApproval'; target: RowlessTarget }
  | { kind: 'resubmit'; handler: 'requests.resubmitRequest' | 'solutions.resubmitSolution'; target: RowlessTarget }
  | { kind: 'approve' | 'reject'; handler: HandlerKey; target: DecisionTarget }
  | { kind: 'deny-stale'; handler: 'solutions.rejectFinalApproval'; target: DecisionTarget; current: TerminalSnapshot }
export interface ActionRecord {
  identity: ActionIdentity; spec: ActionSpec; intendedActor: string
  argumentProjection: JsonValue; stage: 'attempting' | 'resolved'; start: ClockMark
}
export interface BusinessSnapshot {
  terminal: TerminalSnapshot | null
  request: JsonValue; solutions: readonly JsonValue[]
  instances: readonly JsonValue[]; approvalRows: readonly JsonValue[]
  groups: readonly JsonValue[]; activities: readonly JsonValue[]
  notifications: readonly JsonValue[]; mail: readonly JsonValue[]
}
export type PhaseProof = RequestCreateEvidence | SolutionSubmitEvidence
  | ApprovalEvidence | RejectionEvidence | ResubmitEvidence | FinalInitiationEvidence
export type LifecycleOutcome = 'OBSERVER_FAILED_BEFORE_INVOCATION'
  | 'QUEUED_OR_UNOBSERVED_DISPATCH' | 'DISPATCHED_RESPONSE_ABSENT'
  | 'DENIED_UNCHANGED' | 'THROWN_NONCOMMITTING' | 'RETURNED_NONCOMMITTING'
  | 'COMMITTED_AND_UI_CONFIRMED' | 'COMMITTED_BUT_UI_FAILED' | 'EVIDENCE_FAILURE'
export interface BuildBinding {
  actionId: string; handler: HandlerKey; chunk: ArtifactRef; byteOffset: number
  generatedSourceSha256: string; contextId: string
}
export interface DispatchProof {
  identity: ActionIdentity; actionId: string; argumentProjection: JsonValue
  start: ClockMark; end: ClockMark | null; status: number | null
  body: ArtifactRef | null; result: FlightResult
}
export type FlightResult =
  | { state: 'returned'; projection: JsonValue }
  | { state: 'thrown'; code: string; digest: string | null }
  | { state: 'missing' | 'incomplete' | 'unsupported'; reason: string }
export interface ServerProof {
  invocationId: string; handler: HandlerKey; argumentProjection: JsonValue
  actorId: string | null; authObserved: boolean; originalInvoked: boolean
  start: ClockMark; end: ClockMark | null
  transaction: 'not-started' | 'resolved' | 'rejected' | 'unknown'
  exit: FlightResult; observerErrors: readonly string[]; sourceSha256: string
}
export interface ActionEvidence {
  record: ActionRecord; binding: BuildBinding | null
  dispatch: DispatchProof | null; server: ServerProof | null
  before: BusinessSnapshot | null; after: BusinessSnapshot | null
  beforeArtifact: ArtifactRef | null; afterArtifact: ArtifactRef | null
  phaseProof: PhaseProof | null; uiConfirmed: boolean
}
export interface ActionEvaluation {
  outcome: LifecycleOutcome; gaps: readonly string[]
  commitProven: boolean; evidenceValid: boolean; expectedSatisfied: boolean
}
export interface NegativePair {
  id: string; kind: 'stale' | 'blank-reason' | 'unauthorized-viewer'
  before: BusinessSnapshot; after: BusinessSnapshot
  beforeArtifact: ArtifactRef; afterArtifact: ArtifactRef
  action: ActionEvidence | null // mandatory for stale; absent for UI-only checks
}
export function evaluateAction(input: ActionEvidence): ActionEvaluation
export function assertNegativePair(input: NegativePair): void
export function serializeBusinessSnapshot(input: BusinessSnapshot): string
```

ActionSpec validation requires the exact registry handler for its kind/phase, not any member of HandlerKey. With one admitted business action at a time, correlate the unique server invocation by handler/generated-source, exact safe argument projection, original-auth actor and calibrated dispatch/start/end interval (retain calibration uncertainty). The owner/runtime portion of ActionIdentity is acquired before attempting; host attaches that identity to the matching ServerProof only after that match. No client-asserted identity header or duplicate auth. Zero/multiple candidates, overlapping ambiguous intervals or a conflicting exit/result fails evidence. Invocation IDs are generated server-side and cannot be inferred from HTTP/toast. Snapshots use complete private row JSON, not count-only projections; typed required IDs/phase/attempt/state are checked before accepting JSON. Extend current scoped SQL to include approverId/comments, candidateGroupId/full memberships, full request/solution business fields and current turn. Canonicalize row arrays by stable table/ID, preserve chain/member order where semantically ordered, hash rich content for review only. Mail semantics: sorted immutable message IDs + recipient fixture IDs + semantic type/request association + body digest from isolated capture; no raw addresses/body in review. There is no denied-row status exception. UI-only negative gates require complete paired equality, asserted absent/disabled controls and zero business dispatch, not fictional handler proof.

## Task 1: Registry and discriminated evaluator

**Files:** S:760–1062/evidence validators; T. **Consumes:** existing buildInventory/buildCasePlan, ActionBaseline/RevisionBaseline and phase-specific evidence validators. **Produces:** all shared contracts, `evaluateAction`, `assertNegativePair`, `serializeBusinessSnapshot` above.

- [ ] Write failing T tests: `registry_covers_every_matrix_business_caller` enumerates all plan branches/all eleven exports including stale; each successful fixture asserts the matching phase proof, exact trusted actor/target/current turn/group and source/build/result. Mutate each required field individually (missing and wrong); green UI/FINAL rows cannot rescue REQUEST/SOLUTION proof. Test creation null pre-request as explicit attempting action, not no action.
- [ ] Run focused command: expect named new tests to fail by behavioral assertion; missing-export errors are setup, not proof of regression sensitivity.
- [ ] Implement discriminated validators in S. Apply existing correlatePersistedProof/assertFreshPhaseProof/assertEligibleBaseline rules plus complete current-group/source/server/result checks. Server result projection must match returned DB identity and parsed Flight projection. Require transaction resolved **and** matching action-specific persisted transition/audit before commitProven; notifications/mail are separately required evidence. Exact server throw + transaction rejected/not-started + complete unchanged state permits THROWN_NONCOMMITTING; returned success:false/stale plus unchanged state permits RETURNED_NONCOMMITTING or expected DENIED_UNCHANGED. No FINAL-count shortcuts. Missing response→DISPATCHED_RESPONSE_ABSENT is failed evidence even if commitProven is independently retained. Unobserved dispatch asserts no client-queue cause. Any missing required class leaves evidenceValid=false; unexpected/UI-failed actions never qualify a case.
- [ ] Add RF1/RF3 counterexamples: observed throw after resolved commit plus matching changed rows is committed/UI-failed, not noncommit; throw without transaction/snapshots is evidence failure; expected business rejection changes row/status/audit and qualifies only its positive proof; stale changing any row/request/audit/notification/mail fails; UI-only absence cannot pass a dispatched denial fixture.
- [ ] Run focused command: all original 86 regressions and new named tests pass; record actual counts. Save diff/hash checkpoint without staging.

## Task 2: Guarded generated-copy observer and explicit compilation

**Files:** R:250–266, lifecycle after copy/before spawn; T. **Consumes:** HandlerKey/ServerProof from S and the registry. **Produces in R:**

```ts
export interface SourceGuard { relativePath: string; sha256: string; exports: readonly HandlerKey[] }
export interface ObserverCopyInput {
  ownedRoot: string; appDir: string; evidenceDir: string
  guards: readonly SourceGuard[]; nextVersion: '15.5.23'
}
export interface ObserverCopyManifest {
  original: readonly SourceGuard[]; generated: readonly ArtifactRef[]
  registered: readonly HandlerKey[]; compiled: boolean
}
export function transformObserverSource(source: string, guard: SourceGuard): string
export function prepareObservedAppCopy(input: ObserverCopyInput): Promise<ObserverCopyManifest>
```

Extend MatrixRuntimeHandle with `observerManifest?: ObserverCopyManifest`; set it only after successful generation/compilation. Default M dependencies require this manifest before context creation, otherwise fail readiness. Observer journal evidenceDir is a private directory under the verified owned runtime root; copy its immutable records into the review evidence lane through the host gate, never write outside ownership from generated app code.

Generated private module `src/lib/rrm-action-observer.ts` exports `ObserverInvocation`, `runObservedOriginal<T>(handler: HandlerKey, args: JsonValue, original: (inv: ObserverInvocation) => Promise<T>): Promise<T>`, `observeAuthenticatedActor(inv: ObserverInvocation, actorId: string | null): void`, and `observeTransaction<T>(inv: ObserverInvocation, original: () => Promise<T>): Promise<T>`. Its types are emitted from a template in R (no product/test cross-import). Token holds invocationId, handler, safe args, actor/authObserved, transaction state, clocks and sticky observer errors.

- [ ] Write source-fixture AST tests `observer_registration_is_exact_and_source_guarded`, `observer_compilation_failure_blocks_spawn`, and fault-injected generated-module tests `observer_preinvoke_failure_has_zero_calls` / `observer_postcommit_failure_preserves_result`: exact eleven registrations; rejects missing/renamed/duplicate exports, unexpected auth/transaction sites, hash mismatch, symlink/path escape, wrong copy owner, next-version drift, original-file overwrite; compile failure prevents spawn/browser/action. Generated module test dependencies are explicit local `append(record):void`, `clock():ClockMark`, `nextInvocationId():string`; no undefined handlerProbe.
- [ ] Run focused command RED; use test-local directories only in eventual authorized implementation, never generate an app copy now.
- [ ] Implement deterministic AST-local transforms (no regex guesses/whole-program monkeypatch). Preserve original exports/signatures/parameters. Wrap original body in an async lexical callback, keeping original guard/return/catch order; reject unsupported lexical this/arguments/yield/super constructs rather than rewriting them. Insert actor tap after **existing** `user = await getCurrentUser()` in createRequest; after **existing** `_authUser` and userId declarations in all ten remaining exports. user-cache :44–58 obtains the original session then user by session ID. No auth call added.
- [ ] Tap direct `$transaction` call expressions in requests create/resubmit and approvals approve/reject and solutions submit (one each), preserving original `.catch` translations. For six other solution mutations, append an observer token as third optional argument to copied private `runSolutionTransactionWithNotifications(work, options?, inv?)`; instrument its two existing prisma.$transaction branches before notification dispatch. Registered call sites pass `undefined` for absent options, retaining original options/callback unchanged. No shared post-commit module edits or extra DB reads. Record not-started on guard denial; no transaction replay. AST rejects any unrecognized mutation/transaction path in these registered functions.
- [ ] Implement safety distinction: append/fsync BEGIN before original invocation; admission failure throws an observer-specific error and zero original calls. Thereafter all observations catch/latch their own errors and do not throw into original logic; end capture returns original object or rethrows identical original error. Missing end/auth/transaction record or sticky fault fails host evidence. No false commitFlag from return success; resolved transaction plus persisted proof is required. Post-commit append fault cannot become a business exception. Record available fault metadata in private stderr; even if fault recording also fails, missing required sequence fails closed.
- [ ] `prepareObservedAppCopy` realpath-checks under owned root, verifies freshly reviewed source guards before/after copy, emits only module + three copied-source transforms, records template/generated hashes/exact registration and writable private journal admission. Run copied `node_modules/.bin/tsc --noEmit --incremental false` with cwd=appDir via existing runChild; require exit 0 and save log before app spawn. Compilation is separate from later readiness/served binding verification. This uses no private manifest encryptionKey. No unchanged historical SHA assumed for a future revised source baseline.
- [ ] RF2 tests: begin append failure→0 business calls; after auth/transaction/commit/end append failure→1 call and original return/throw identity, mandatory evidence failure; guard denial/auth throw leaves original guards; helper transaction resolves before notification failure and remains recorded resolved; rejected transaction remains original exception; failed build→0 spawn. Run focused and future `npm run check`; save checkpoint. If exact semantics cannot be proven within boundary, STOP `BLOCKED_OWNER_DECISION`, naming transform/proof and requested scope instead of proxying it.

## Task 3: Real context capture, served public bindings, Flight and bounded drain

**Files:** M:199–289/newContext, close/failClosed; T. **Consumes:** shared contracts, observer manifest. **Produces in M:**

```ts
export interface CaptureSummary { artifacts: readonly ArtifactRef[]; errors: readonly string[] }
export type ActionResultDeadline =
  | { operation: 'held-stale-confirm'; budgetMs: 15000; started: ClockMark }
  | { operation: 'positive-result'; budgetMs: 30000; started: ClockMark }
export interface ContextCapture {
  contextId: string
  begin(record: ActionRecord): Promise<void>
  startResultWait(record: ActionRecord,
    operation: ActionResultDeadline['operation']): ActionResultDeadline
  finish(record: ActionRecord, deadline: ActionResultDeadline): Promise<{ binding: BuildBinding | null; dispatch: DispatchProof | null }>
  drain(reason: 'action' | 'case' | 'close' | 'pause' | 'stop'): Promise<CaptureSummary>
  cancel(reason: string): void
}
export function registerMatrixContextCapture(context: BrowserContext, input: {
  contextId: string; root: string; manifest: ObserverCopyManifest
}): ContextCapture
export function decodeActionFlight(bytes: Uint8Array, contentType: string): FlightResult
export function extractServedBindings(bytes: Uint8Array, artifact: ArtifactRef,
  contextId: string, manifest: ObserverCopyManifest): readonly BuildBinding[]
export interface MatrixUiDependencies {
  handle: MatrixRuntimeHandle; manifest: ObserverCopyManifest
  mkdir(dir: string, options: { recursive: true }): Promise<unknown>
  writeFile(file: string, body: string | Uint8Array): Promise<void>
  readFile(file: string): Promise<Uint8Array>
  rename(from: string, to: string): Promise<void>
}
export function playwrightMatrixUi(browser: Browser, evidenceRoot: string,
  deps?: MatrixUiDependencies): MatrixUi & { traces: string[] }
```

ObserverCopyManifest and MatrixRuntimeHandle are imported as types from R. Dependencies default to the current owned handle/manifest and fs; they do not replace registration/factory/business callbacks. Existing BrowserContext remains Playwright's type; no new telemetry platform.

- [ ] Write `real_context_factory_registers_before_page_work` using a fake **Browser.newContext**, not overriding M's nested newContext. Exercise the actual M factory through createRequest/resubmit/initiate: assert context listeners registered before tracing.start/newPage/goto/sign-in; unregistered contexts fail admission. Add a narrow optional `playwrightMatrixUi` third-argument IO/runtime dependency seam (existing two-arg call stays valid), injecting existing handle/baseUrl/query/writes/capture only for offline tests. Do not replace the factory itself in this test. Test setup-failure/held-dialog contexts and any fresh manual `createSession` factory before allowing it into the evidence lane; current authorized M source has no separate createSession symbol, so do not invent its existence or reuse an unregistered external script.
- [ ] Run focused RED. Implement context.on request/response/requestfinished/requestfailed immediately after browser.newContext and before newPage. Capture full JS response bytes (not only digest), immutable context-relative paths `contexts/<id>/js/<sha>.js`, and manifest `contexts/<id>/build-bindings.json`. Parse served `createServerReference(actionId,...,exportName)` bindings with TypeScript AST, requiring source registration/module provenance and exact source span; same-named ambiguity/unknown emitted form fails, not guessed. Reject missing JS/used binding/version drift. Historical 6ed/098/a471 references are comparison context only. No private build manifest or closure decrypt.
- [ ] Implement complete relevant request/response capture: method/path/action ID and allowlisted argument projection, raw clocks/status/content type, requestFinished/error, body bytes under private `contexts/<id>/responses/<sequence>.flight`, safe parsed result/error. Exclude auth request bodies, Cookie/Authorization/Set-Cookie, token/closure payloads and arbitrary headers. For ordinary matrix argument JSON/multipart, resolve only public typed arguments; unexpected opaque references fail proof rather than export/decrypt. Hash descriptions/title/reason/content and retain fixture IDs/flags/ordered lists consistently on browser/server sides.
- [ ] Implement Next-15.5.23 frame parsing pinned to installed `react-server-dom-webpack-client.node.development.js:3150–3218` framing: hex row ID + colon, newline-delimited model/control rows; length-delimited `T/A/O/o/U/S/s/L/l/G/g/M/m/V` byte rows. Frame the **entire** finished body; no executable module loading/evaluation. Resolve root `a` as Next's server-action-reducer :116–123 does, following `$<hex>`/`$@<hex>`/outlined property paths, escaped `$$`, Date/undefined/numeric scalar encodings and text rows. Record referenced E error rows/digest as thrown (never 200 success); detect cycles/missing/duplicate conflicting models, halted/unfinished streams. Non-action navigation/debug/module chunks are framed/archived, not treated as action results. A result graph requiring unsupported module/function/temporary/binary/stream values yields unsupported, not a fabricated JSON result. Project only success/stale, IDs, status, safe known error code/digest, deleted IDs/warning hashes and allowed resubmitted request identity; deny raw stack/content. Redirect, missing root.a, non-Flight body, absent EOF or unresolved reference fails evidence. Test every actual registry return shape, including resubmitRequest's request object/Date fields, not just `{success:true}`.
- [ ] Track capture and immutable-write promises. Operation-specific existing result-wait budgets are **15,000 ms for held stale confirm** (M:767–775, following its single click :766) and **30,000 ms for applicable positive-result waits** (M:583 create, :619 approve, :661 submit-solution, :701 positive reject, :816/:835 resubmit, :871 initiate-final). Call startResultWait at the existing result-wait start after the business click; finish consumes that same deadline, including elapsed UI wait, with no reset or second business timeout. Unknown operation/changed budget fails. Opener readiness (M:1099–1126, 30,000 ms), page default locator/screenshot (M:245, 30,000 ms), navigation (M:246, 90,000 ms), checkpoint pauses and other prerequisite matchers remain separate and unchanged; none enlarges the result deadline. Preserve the existing stale 250 ms polling cadence (:774); add no new retries/polls. Shutdown/close drains have fixed 5,000 ms evidence-only budget and cannot admit a late response as a timely business result. On expiry cancel capture, seal incomplete artifact index, remove listeners, handle late promise rejection/resolution without publishing late artifacts, and return failure so owned stop can proceed; never await an unfinished body that needs context/app stop. Writes use unique temp paths and publish only if capture generation remains active; late writes cannot overwrite sealed evidence. Write failure/time budget exhaustion is failed evidence, not “drained.” No sleeps/polls/retries added as a fix.
- [ ] RF4 tests `flight_resolves_actual_registry_results_and_errors`, `served_binding_requires_archived_exact_bytes`, `capture_deadline_seals_before_owned_stop`, and `review_packet_excludes_auth_secrets`: split UTF-8/length-framed Flight, references/promise errors, missing body/no response, JS body failure/mismapped action ID, hidden credentials, fixture trace password boundary, never-resolving body with cancellation, late writer/rejection, disk failure and primary + capture + close errors. Add `result_deadline_preserves_stale_15000_positive_30000_and_drain_5000` with controlled clocks on actual stale/positive callers: result start follows one click, elapsed wait is not reset by finish, stale expiry remains 15,000 even when drain continues, positive expiry remains 30,000, and opener/screenshot/navigation budgets do not leak into either. Assert stop is reached and no PASSED/next click; run focused/full checks and checkpoint. If public mapping/result decoder cannot support actual loaded form, stop readiness; never fall back to generic JSON or a hardcoded binding.

## Task 4: Immediate negative pairs and actual action wiring

**Files:** S.runMatrixCase :1063–1267, M business/negative methods :568–953 and scoped capture :1192–1224; T. **Consumes:** Tasks 1–3; existing journal and phase proof builders. **Produces:**

```ts
// M export; complete snapshot + isolated mail is written before resolving.
export function persistActionSnapshot(input: {
  root: string; record: ActionRecord; edge: 'before' | 'after'
  read: () => Promise<BusinessSnapshot>
}): Promise<{ snapshot: BusinessSnapshot; artifact: ArtifactRef }>
// S planned extension of HeldRejectDialog.staleConfirm's return:
// { outcome: existing union; evidence: string; actionEvidence: ActionEvidence }
```

Extend MatrixUi with `readBusinessSnapshot(row: MatrixRow, title: string): Promise<BusinessSnapshot>` and `writeNegativeSnapshot(id: string, edge: 'before'|'after', snapshot: BusinessSnapshot): Promise<ArtifactRef>`; M implementations delegate to the same canonical snapshot writer, with `negatives/<id>/<edge>.json`. Keep existing string-returning business methods compatible, while M maintains durable ActionEvidence records keyed by ActionIdentity for its strict gate.

- [ ] Write `stale_negative_writes_immediate_pair_before_denial_acceptance` / `stale_negative_any_business_or_mail_change_fails` on actual runMatrixCase, asserting order: capture current Completed snapshot→await BEFORE immutable write→one held confirm→specific handler/result denial→fresh AFTER capture/write→assertNegativePair→recordDeniedStaleConfirm. Delay/reject BEFORE write: confirm clicks=0. Omit/reject AFTER: no passed denial/case/next action. Bind held old a1/row/instance/actor separately from current Completed instances; wrong old/current target fails. Changed denied row, audit, request, instance, notification or mail each fails unchanged proof (RF3).
- [ ] Run focused RED. Wire all eleven business paths: ledger attempting durable→ContextCapture.begin→one click→startResultWait at the existing operation-specific wait→finish(record, deadline) result/server evidence and fresh snapshot even when UI wait fails→evaluate→durable record→confirm original ledger only for expected successful evidence. Preserve original action exceptions, append capture errors; do not replace a proven commit with no-commit. Create/submit/initiate/resubmit explicitly emit ActionRecord independent of unresolvedTarget:null; include the record in `captureCaseEvidence`/case/aggregate on failure. Null snapshot is missing evidence, not permission to clear attempting.
- [ ] Wire stale pair at actual S :1204–1238; remove reliance on toast-only denial as proof. `rejectFinalApproval` eligibility denial code is matched to its actual source guard, not a notification response. Require server-auth actor and no transaction/unchanged snapshot; compare `assertSnapshotsEqual(before.terminal, after.terminal)` plus full BusinessSnapshot equality. Persist action, pair and comparison refs. Missing held window is incomplete required coverage, never silently accepted.
- [ ] Wire paired blank-reason snapshots around actual disabled confirm assertion in M.rejectCurrentStep **before** reason fill/business rejection; wire unauthorized-viewer before/after actual M.checkUnauthorizedViewer inspection. UI-only snapshot writing uses serializeBusinessSnapshot/the same immutable IO implementation, not a fabricated ActionRecord/handler target. No negative click where controls are absent/disabled, no backend-denial inference, no forced APIs. Legitimate rejection is evaluated separately with its positive RejectionEvidence/postconditions.
- [ ] Extend FakeRrm023 actual resubmit driver preserving default `expect(Locator).toBeVisible({timeout:30_000})`, deferred readiness, 0/1 opener click, exactly one submit and pre-opened-form tests. Since its existing newContext override bypasses registration, keep it for caller/default-matcher regression **and separately** drive real factory tests from Task 3. Mutation-sensitive bypass: disable the actual observer hook/finish/writer/default matcher in controlled mutants and require named test failure, not just bundle length arithmetic. Add actual create/initiate/approval/rejection caller tests and wrong result/source/actor mutations; no all-phase fake FINAL arithmetic.
- [ ] Run focused/full checks; record original compatibility/new counts and checkpoint. Do not add unrelated product behavior.

## Task 5: Durable gates, combined failures and eight-pass plan

**Files:** M.runCaseWithEvidenceGate/main/flushProgress, R.runOwnedMatrixSession/stopMatrixRuntime, S pure run-plan; T. **Consumes:** all prior proof/capture interfaces and existing lifecycle enclosures. **Produces in S:**

```ts
export type SourceMode = 'strict-assurance' | 'historical-legacy'
export type ArtifactReader = (ref: ArtifactRef) => Promise<Uint8Array>
export type ArtifactWriter = (path: string, bytes: Uint8Array) => Promise<ArtifactRef>
export interface ProfileInvocation {
  pass: 1 | 2; invocation: number; invocationId: string
  profile: RouteProfile; caseIds: readonly string[]
}
export interface AssurancePlanManifest {
  planId: string; sourceMode: 'strict-assurance'
  invocations: readonly ProfileInvocation[]
}
export interface OwnerClearedInvocation {
  plan: ArtifactRef; slot: ProfileInvocation; clearanceId: string
  sourceMode: 'strict-assurance'; evidenceRoot: string; approvedSource: ArtifactRef
}
export interface AssuranceAuthority {
  plan: ArtifactRef; clearances: readonly ArtifactRef[]
  qualifiedInvocations: readonly ArtifactRef[]; acceptedPasses: readonly ArtifactRef[]
}
export interface ClearedInvocationContext {
  authority: ArtifactRef; manifest: ArtifactRef; value: OwnerClearedInvocation
}
export interface RunBinding {
  pass: 1 | 2; invocation: number; invocationId: string; profile: RouteProfile
  runId: string; sourceMode: SourceMode; evidenceRoot: string
  clearanceManifest: ArtifactRef; runtimeManifest: ArtifactRef
}
export interface RuntimeProvenance {
  authority: ArtifactRef; clearanceManifest: ArtifactRef; slot: ProfileInvocation
  runId: string; sourceMode: 'strict-assurance'; evidenceRoot: string; ownedRoot: string
  approvedSource: ArtifactRef; observerManifest: ArtifactRef
  ownedIdentity: ArtifactRef; freshEmptyFixture: ArtifactRef
}
export interface CaseRunBinding { binding: RunBinding; caseId: string }
export interface CaseProvenance extends CaseRunBinding { requestId: string }
export interface NegativeProofArtifact { provenance: CaseProvenance; pair: NegativePair }
export interface CompletedCaseProof {
  provenance: CaseProvenance; completed: CompletedEvidence
  snapshot: BusinessSnapshot; snapshotArtifact: ArtifactRef
}
export interface CaseQualification {
  schema: 'strict-assurance-case-v3'; provenance: CaseProvenance
  actions: readonly ArtifactRef[]; negatives: readonly ArtifactRef[]
  completed: ArtifactRef; traces: readonly ArtifactRef[]; artifactIndex: ArtifactRef
}
export interface GateReceipt {
  gate: 'owned-stop' | 'native-check' | 'visual-review' | 'independent-review' | 'parent-acceptance'
  runtimeManifest: ArtifactRef; caseQualifications: readonly ArtifactRef[]
  verdict: 'accepted'; evidence: readonly ArtifactRef[]
}
export interface InvocationQualification {
  runtimeManifest: ArtifactRef; caseResults: readonly ArtifactRef[]
  ownedStop: ArtifactRef; nativeCheck: ArtifactRef; visualReview: ArtifactRef
  independentReview: ArtifactRef; parentAcceptance: ArtifactRef
}
export interface CompletedCaseEntry {
  provenance: CaseProvenance; caseResult: ArtifactRef
  caseQualification: ArtifactRef; invocationQualification: ArtifactRef
}
export interface VerifiedPassInventory {
  schema: 'strict-assurance-pass-v3'; sourceMode: 'strict-assurance'
  pass: 1 | 2; authority: ArtifactRef
  completed: readonly CompletedCaseEntry[]; invocations: readonly ArtifactRef[]
}
export function buildEvidenceRunPlan(planId: string): readonly ProfileInvocation[]
export function loadClearedInvocation(input: {
  authority: ArtifactRef; invocationId: string; readArtifact: ArtifactReader
}): Promise<ClearedInvocationContext>
export function verifyCompletedCaseEntry(input: {
  expectedAuthority: ArtifactRef; entry: CompletedCaseEntry; readArtifact: ArtifactReader
}): Promise<CaseProvenance>
export function assertPassInventory(input: {
  pass: 1 | 2; expectedAuthority: ArtifactRef
  completed: readonly CompletedCaseEntry[]; priorAccepted: readonly ArtifactRef[]
  readArtifact: ArtifactReader
}): Promise<VerifiedPassInventory>
// M producer, called only after session stop and external review/parent barriers:
export function finalizeInvocationInventory(input: {
  expectedAuthority: ArtifactRef; invocationId: string; qualification: ArtifactRef
  readArtifact: ArtifactReader; writeArtifact: ArtifactWriter
}): Promise<readonly CompletedCaseEntry[]>
```

Identity namespaces are distinct: ProfileInvocation/RunBinding.invocationId identifies one **profile-pass slot**; existing ServerProof.invocationId identifies one **server business-action call**. Never equate these strings. Preserve the original exact handler/actor/argument/clock match, then archive that ServerProof inside the ActionEvidence whose record.identity carries the profile-pass binding.

- [ ] Write `case_gate_preserves_all_failures_and_never_logs_pass_early`, `pass_inventory_requires_exact_44_ids_per_pass`, and `pause_retains_ambiguous_action_without_replay` on actual callers/enclosures: primary + response/capture + pair/action write + case/aggregate + progress + runtime stop + browser close errors retained in deterministic order; successful business with any required write failed produces no PASSED/next case. Never-resolving capture yields bounded failure then verified stop; late callback cannot restore pass. Mutants that bypass capture/after-pair, mask primary in finally or mark passed before flush must fail named tests.
- [ ] Run focused RED. Extend existing gate—not an all-COMMITTED constant—to require evidenceValid/expectedSatisfied for every expected positive action and dispatched denial, all UI-only pairs, explicit attempting honesty, completed current phases/history/no carried approvals, verified trace/JS/response/pair/action files, and zero outstanding writes. Persist final candidate case/progress/aggregate status before logging PASSED; on failure persist failed disposition as possible and combine additional write errors. Current flush-before-setting-passed ordering must not leave durable progress describing a different outcome. Profile success additionally requires capture drain and verified owned stop; stop failure retracts profile qualification without rewriting old action facts.
- [ ] Write `two_qualified_fresh_passes_accept_88_requests_in_8_runtime_groups`, `complete_pass1_inventory_cannot_accept_as_pass2`, `rewritten_pass_label_with_pass1_proof_refs_fails`, and `inventory_rejects_reused_runtime_request_or_unqualified_foreign_proof`. Fixtures must use real artifact-reader SHA/size verification and the Task1 action/negative/completed validators, not label-only fake approvals. Genuine pass1 then pass2 yields 44+44 entries/88 unique request IDs/8 unique runtime groups; reject **complete** pass1 submitted for pass2, rewriting its entry pass to 2 with unchanged/rehashed foreign qualification references, cross-pass request/run reuse, other-case/historical proof, wrong source mode/source manifest/root, missing/wrong digest/unqualified review refs, duplicate/omitted/wrong-profile IDs. Preserve legitimate same-case IDs/actor UUIDs across passes and 12/11/11/10 cases sharing each correct runtime. Run focused RED, implement the following producer/consumer contract, then focused GREEN with actual counts and checkpoint.
- [ ] Build slots with buildEvidenceRunPlan(planId) from PROFILE_ORDER/buildInventory: invocations 1–4 pass1 and 5–8 pass2, counts 12/11/11/10; invocationId is `${planId}:invocation-${invocation}`. This pure function allocates no runtime and grants no clearance. Before each owner-cleared launch, parent persists an immutable AssurancePlanManifest and OwnerClearedInvocation for that slot (exact expected IDs/root/reviewed implementation source manifest), then an AssuranceAuthority snapshot pinning their ArtifactRefs. Parent approval pins the authority's absolute path/SHA256/size outside case/entry data. Subsequent authority snapshots add cleared/qualified invocations or accepted passes without overwriting earlier records. No generated run ID is invented before allocation; no end-of-run pass stamping supplies authority.
- [ ] **Proposed M options, not current CLI support:** extend Options with `assurance?: { authority: ArtifactRef; invocationId: string }`. Add strict-lane arguments `--assurance-authority=<owner-pinned-absolute-path> --assurance-authority-sha256=<owner-approved-digest> --assurance-authority-bytes=<owner-approved-size> --invocation-id=<owner-slot-id>` to the existing routes/evidence-root/seed command. parseOptions/main (M:103–125,1141–1169) use loadClearedInvocation before allocation: reader verifies exact bytes/hash and canonical schema; slot must occur exactly once in authority.plan, its clearance must be pinned in authority.clearances, profile/root/selected IDs must equal the canonical slot. Require strict-assurance and reviewed source manifest; missing authority leaves historical/legacy mode ineligible for either new pass. No `--pass` label, subset `--case-ids` or user entry labels grant strict acceptance. No command runs now.
- [ ] **Runtime/session/action lineage:** extend R.startMatrixRuntime input with `assurance?: ClearedInvocationContext` and MatrixRuntimeHandle with `assuranceBinding?: RunBinding`. R (allocation :457–461, handle :470 onward) rereads/verifies the same clearance and actual realpath/source identity; after actual fresh owned allocation/identity/empty-fixture gates and observer compilation, write immutable `runtime/assurance-runtime.json` as RuntimeProvenance, containing the real runtime.runId, actual ownedRoot, clearance slot/root/source, observer manifest and existing ownership/empty-fixture gate artifact refs (no credentials or new auth/DB probe). Only then derive RunBinding from those verified records and attach it to handle before browser/session work. runOwnedMatrixSession and playwrightMatrixUi consume that same binding; each Task1 ActionRecord/DispatchProof.identity inherits it at creation, and matched ServerProof/PhaseProof are archived within that identity envelope. CaseResult in M adds `caseBinding?: CaseRunBinding; provenance?: CaseProvenance; qualification?: ArtifactRef`: populate caseBinding from handle before runMatrixCase/any attempting record and retain it on failure, including rowless create with no request yet; acquire requestId only from the validated create action's returned/persisted RequestCreateEvidence, require it absent in the pre-create scoped state and new within the session, then bind all later action/proof targets to it. Never populate requestId from title/entry/client assertion alone. Fixture actor UUIDs are not request/runtime uniqueness keys.
- [ ] **Persisted producer:** inside runCaseWithEvidenceGate (M:1025–1096), after the existing action/pair/capture/durable flush gates, write immutable CaseQualification, CompletedCaseProof and passed case-result artifacts under that run's approved evidenceRoot; every action/result artifact retains the same RunBinding/case/request identity; negative references resolve NegativeProofArtifact envelopes whose provenance matches before calling assertNegativePair on pair. Completion metadata must not come from the old `{profile,caseId}` result projection. After `await runOwnedMatrixSession(...)` in M.main (:1184–1276), verified stop/browser-close completes before writing candidate runtime/case-result references (these are not yet an InvocationQualification); stop/capture failure leaves no qualifying invocation. Native/visual/independent/parent receipts are then supplied by the existing external barriers, each GateReceipt bound to the exact runtimeManifest and complete caseQualifications with nonempty supporting evidence refs. Persist a new complete InvocationQualification only after those receipts exist; the parent-approved authority snapshot pins it in qualifiedInvocations. Only now may the parent call M.finalizeInvocationInventory at that post-session checkpoint. It loads that pinned qualification, verifies each passed case-result and all gates with verifyCompletedCaseEntry, freezes/writes `inventory/<caseId>.json` entries via immutable ArtifactWriter, and returns CompletedCaseEntry[] copied from canonical loaded provenance—not labels supplied by the inventory caller. No next runtime is allocated by this finalizer.
- [ ] **Case/proof verification:** verifyCompletedCaseEntry resolves all refs with SHA256/bytes/realpath checks under the authority-approved evidence root (initial plan/clearance/review records may live in the parent-approved authority lane). Compare entry provenance against RuntimeProvenance, its immutable owner clearance/plan slot, passed CaseResult, CaseQualification and CompletedCaseProof; verify actual source manifest/ObserverCopyManifest and action served-build bindings, not a `sourceMode` string alone. Load/re-evaluate every ActionEvidence with evaluateAction, all required NegativePairs with assertNegativePair, completed current phases/history/no-carried proof and artifact index/traces using the retained strict gates. All action identities, request/solution targets, persisted create/terminal/snapshot IDs and group/turn/handler/result facts must agree. Require CaseQualification.schema strict-assurance-case-v3, zero missing requirements, and every receipt's exact subject/verdict/supporting artifacts, including parent's pinned qualification; unqualified/missing/foreign proof cannot become accepted by a boolean or pass rename. The source fixture/runtime evidence is taken from already-required gates, not new probes.
- [ ] **Inventory consumer:** assertPassInventory gets explicit expectedAuthority (the parent-pinned reference, never recovered from submitted entries), intended pass, completion entries and priorAccepted artifact references. It loads canonical plan/clearances/qualified invocations, verifies all entries as above, and requires exactly the four slots/44 unique IDs belonging to that pass, each profile's exact 12/11/11/10 membership. Group by invocationId: all cases in a slot share the identical runtimeManifest/runId; different slots require different runtimeManifest/runId/ownedRoot and noncolliding `(evidenceRoot, profile)` artifact namespaces, with exactly one runtime per slot. Four profiles may share a pass evidenceRoot as the existing driver permits, but every artifact must match its approved root/profile/case namespace; pass2 must not reuse pass1's namespace. Each requestId is unique per case, including across passes. For pass1 priorAccepted must be empty; for pass2 require exactly the parent-pinned pass1 acceptance in authority.acceptedPasses, load its VerifiedPassInventory and original authority, revalidate its complete entries/qualifications/plan lineage rather than trusting its totals or labels. Validate the union: eight distinct canonical invocation/runtime groups, 88 distinct request IDs, each invocation used only once as a group; repeated case IDs and actor UUIDs across passes are allowed. Reused runtime/request, old manifest/proof references or another case's evidence fails even if an entry's pass is rewritten. Return VerifiedPassInventory only after this verification; parent immutably persists its JSON/digest and pins that reference in later authority snapshots. Historical29 are never inputs to priorAccepted.
- [ ] Add operator-pause admission flag in the manual driver's owned session: stop admitting new actions, await admitted action's existing bounded resolution or classify ambiguity, drain/seal, close contexts and verified owned stop. Paused/incomplete profile does not qualify uninterrupted pass; do not SIGSTOP healthy actions/resume-count. Test pause before action, after proven commit, and unknown dispatch with retained attempting/no replay. Runtime root retained; no broad kills or old-port warnings.
- [ ] Run focused, `npm run check`, `graphify update .` **only after future implementation approval**. Require actual exit 0, original regressions compatibility and explicit skip accounting; save logs/hash/diff checkpoint. Independent native readiness review checks generated source/compile/caller mutation evidence; parent clears launch separately. New scope/technical obstacle→owner disposition, no automatic repair rounds.

## Future operations (separate owner clearance, never execution by this planner)

Order: pass1 all-defaults → solution-exception → final-exception → solution-and-final-exceptions; pass2 same order. Before each launch parent checks readiness/owned resource identity/private storage capacity and clears **that invocation only**. Fresh empty fixture/runtime per invocation, case requests never reused. After each: durable complete inventory/evidence, visual screenshots, native gate, verified owned stop, fresh independent review, then parent next-profile clearance. Any failure stops all later cases/profiles; any continuation/retest scope needs owner disposition. Separate case retests or historical partial runs are not uninterrupted full passes.

Quota 429 is a planning/review model failure, not permission to freeze/cancel a healthy autonomous driver or switch provider. Explicit owner pause uses Task 5's safe boundary; ambiguous actions remain blocked. Future canonical run/monitor/control manifest records run ID, actual allocated ports, PID/start identities, source/build generation and monitor coverage, so warning/restart truth cannot come from old ports or incomplete historical monitor. Preserve all old failures/reports and private traces.

Historical ~6–7 min/case suggests ~10–11 h **execution-only** for 88, excluding implementation/readiness/review, pauses and storage provision/drain. No runtime allocation now. RRM-030 root cause remains UNKNOWN; no longer attribute long notification POST or toast timeout to a frozen FINAL action. Original runtime is already stopped and retained. Unsupported REQUEST-custom/R-S stale/direct-access/download/export/sharing checks and UI-history/FINAL-label bugs remain disclosed; never claim release/100% bug-free.

## Self-review and stop rule

Applied: spec §§1–2→Tasks1/4/5; §3→Task2; §4→Tasks1/4; §5→Tasks2/3/5; §6→Task5/operations. Revision-3 audit additionally checks owner authority→runtime→action/case→qualified entry→pass acceptance lineage (including full pass1 reuse/relabel counterexamples) and 15,000/30,000 ms operation results versus 5,000 ms evidence drain. All new signatures/types are defined above or existing named imports; no handlerProbe, historical authoritative registry, combined-exception profile or misnamed opener/runMatrixCase location. Five RF classes each have owning named tests/mutants. Generated-copy compilation and public binding extraction remain future checkable readiness gates, **not evidence they have succeeded now**. One correction only; no live reproduction or implementation during repair. If a required method cannot fit source/semantics/privacy boundaries, STOP `BLOCKED_OWNER_DECISION` with exact unmet proof; no placeholder/fallback disguised as feasibility.
