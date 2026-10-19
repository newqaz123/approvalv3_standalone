# Business workflow completion roadmap (2026-10-02; revised after Sol BLOCK review)

Status: DOC-REPAIR revision of the 2026-10-02 roadmap (original 164-line version preserved in
scratch/t15e-task135-business-completion-roadmap/ and the archived Task135 reports). No source/test
implementation is authorized by this document. Standing owner authorization
(scratch/t15e-task135-business-completion-roadmap/owner-authorization.md) covers sequenced GLM→Sol→
retest→milestone-commit cycles and isolated owned temporary PG/app/test-mail runs AFTER parent readiness
gates. Protected: default Homebrew PG, :3100, PIDs 87679/87681, real SMTP, .env, production
migrations/backfills. Browser gets no DATABASE_URL; screenshots-only; no preview. Historical labels that
remain: Task123 infrastructure-failed; Task132 preservation UNVERIFIABLE/BLOCKED; Task133 historical BLOCK.
Task134 readback fake-scope is Sol-cleared (CLEAR_SCOPED_TASK134_READBACK_REPAIR); committed checkpoint HEAD
1ff079401040e17d6532e449327e80ae88fc8a41 remains the LATEST COMMITTED milestone — the later scalar
(139/140), recording (159–161) and query/runner (167–171) work is UNCOMMITTED scoped-accepted only.
**Latest RECORDED checks (Task171; date not asserted):** focused 23/23, business siblings 506/506,
npm run check exit 0 — typecheck 0, management 78/78, regressions 3,150 total / 3,149 pass / 1 known
skip (B6-fix1/B11 replacement) across 715 suites; ordinary project graph 0 with 654 zero-node /
2 SQL-grammar-missing / 106 renamed communities. These are static/AST-VM/fake scoped verifications, NOT
fresh checks of this revision and NOT native/full-captureData proof. (The earlier "focused 137 / root
3051" figures were Task134-era history, superseded as latest by the numbers above.) **Process status
(preserved, unwaived):** Task172 options report FACTS/SPEC/QUALITY/DISCUSSION BLOCK; Task173 recovery setup
failed prelaunch (owner paused); Task174 timeout + forbidden Bash + relative edit paths; Task175 timeout + relative read paths; Task176 review BLOCK; Task177 quota STOP; Task178 timeout + pre-edit
reading-contract failure (its ONE retry was consumed; Task179's narrower documentation completion, which
produced this revision, does not retroactively cure it). Whole-T16 design remains human-gated (§4/§6).
Nothing here claims live acceptance.

Current-state basis: this revision is anchored to CURRENT source (HEAD 1ff0794), the five accepted scoped
reports indexed in §2, and the structured H19/H24 run evidence. The canonical plan
(docs/superpowers/plans/2026-09-16-business-workflow-test-plan.md, T01–T20) remains the target, but its stale
expectation/ledger tables are superseded wherever current code, approved policy, or an accepted scoped report
differs. Historical failure counts are facts about those runs, not claims about current code.

## 1. Current-state audit — R1–R14 (implemented ≠ full-suite acceptance; fresh matrix still required)

| # | Item | Current state (current-source / accepted-report anchored) | Track as |
|---|---|---|---|
| R1 | T08 final-origin/trigger eligibility | IMPLEMENTED + policy-aligned: src/lib/permission-checks.ts:24–37 authorizes Final via the origin-unit ancestor path (not exact-origin-only); src/lib/approval-engine/attempts.ts:138–154 resolves FINAL origin to the STORED requester (source FINAL_INITIATOR; caller originUserId is not the persisted trigger). H19 evidence: T08 all trigger actors passed (playwright-run.log:25–29) and T08B–E final-origin checks passed as original-requester (db-evidence.json:10893–11210) | Fresh four-profile matrix verification only — no product decision pending, no reopening |
| R2 | T10 evaluator title filter | RESOLVED in current source: tests/support/native/capture-workflow-db-evidence.ts:551–554 `BUSINESS_REQUEST_TITLE_LIKE = 'Business T%'` consumed by both filters; T10 route/origin/candidate regression coverage exists (tests/regression/business-db-evidence-final-trigger.test.ts:397–430) | Historical defect; fresh full-run T10 evidence in final matrix |
| R3 | T09 Staff-C expectations | RESOLVED policy-aligned: spec now asserts Staff C can VIEW under sharing ON but has no Final trigger/action item (tests/business-e2e/business-final-trigger.spec.ts:447–455,498–508); H19 T09A/T09B passed (playwright-run.log:30–31) | Fresh matrix verification only — no owner decision pending |
| R4 | T11C completed-checkpoint visibility | EXECUTED and PASSED in H19 (business-visibility.spec.ts T11C, playwright-run.log line 50, 1.9m) — the old "NEVER REACHED / click-before-hydration" label is history, not current state | Fresh matrix verification; the residual Department-manager-not-re-asserted-in-OFF-state gap moves to R6/M-COV |
| R5 | T11 attachments + denied direct-URL access | OPEN, now SCHEDULED (M-COV): upload helper unproven; `/requests?requestId=` denied-actor check skipped (id unobtainable browser-only — allowed seam: id from DB-evidence layer or Flight-action capture, browser still no DATABASE_URL) | Pre-full coverage-expansion contract; required omission BLOCKS final acceptance |
| R6 | Actor/checkpoint/share-state worksheet | OPEN, now SCHEDULED (M-COV): canonical §5 still "Record by actor" for rejected / solution waiting / solution rejected / awaiting-Final / final rejected rows × 4 route configs + OFF-state Department-manager re-assertion | Pre-full: derive from sharing.ts/scope.ts, owner-reviewed worksheet → spec assertions |
| R7 | T12 notification matrix beyond create-stage | PARTIALLY PROVEN, scoped: T12A accepted single run (§2) covers create→completed positives + viewer-negative + mail 11/11. NOT proven: rejection/resubmission transitions, all recipients, links, duplicates, superseded-step negatives | M-COV deliverable (matrix + assertions), then fresh runs |
| R8 | T13 mail evaluator decode/domain | RESOLVED in current source: strict quoted-printable/base64 transfer decoding fails closed (tests/support/native/mail-capture.ts:296–319,512–545); malformed/ambiguous identity classified and rejected BEFORE title fallback (capture-workflow-mail-evidence.ts:128–136 messageMatchesRequest); shared fixture sender business-workflow-test@business.test (seed-business-fixture.ts:160–174) with wrong-domain rejection regression (business-mail-evidence-evaluator.test.ts:140–160). These contracts must NOT be relaxed | Historical defect; fresh full-run mail evidence in final matrix |
| R9 | T14 rejection/resubmission | IMPLEMENTED + policy-aligned: rejection checks scoped through isCurrentInstanceApproval (request-modal-router.tsx:255–290); harness follows Resubmit Solution button-before-form (business-flow-helpers.ts:811–832); T14C asserts requester NO restart + Sent to Engineer + Engineering revision (business-reject-resubmit.spec.ts:362–384), matching preserved Final-rejection policy; H19 T14A/B/C all passed (playwright-run.log:40–42) | Fresh matrix verification only — answered policy stays closed |
| R10 | T15–T20 execution | EXECUTED in H19, several PASSING: T15B/C/D races, T16A/B failure-isolation, T17A–C2 chain-changes, T19A/B config-guards, T20A/B terminal (playwright-run.log:8–53); T18B/T18C2/T04B/T12/T15A H19 failures later received scoped single-run acceptances (§2) — NOT universal full-suite proof; H24 remains timeout-not-accepted | Fresh four-profile matrix + repeated runs |
| R11 | T16A mail-failure restoration | EXECUTED in H19 (all 7 manifest phases Pass incl. break/restore, evidence-manifest.jsonl:153–159) and entered in H24 (:145–146). WHOLE-T16A RESTORATION REMAINS **OPEN/BLOCKED** despite that run and the accepted local recording component (161): current source exposure — `business-failure-isolation.spec.ts` assigns `originalPort` from the helper return at 171–182 BEFORE the `try` at 183, and the `finally` at 225–240 restores only `if (originalPort)`; `setEmailSmtpPortViaUi` (`business-flow-helpers.ts` 1204–1219) publishes the previous port only in its final return after save+reload verification — a save/post-save/evidence/sign-in failure can leave port 9 persisted with no restoration identity reaching the outer finally. Source exposure ≠ proof of the historical contamination cause. Full mandatory obligations and the primitive-bridge GAP: §4 below | HUMAN-GATED sequence (§4/§6), NOT the old direct-repair mandate |
| R12 | Full-suite stability | H19 all-defaults full run FAILED: 37 pass / 6 fail / 7 skip (playwright-run.log tail); failures = T11B, T12, T15A, T18B, T18C2, T04B. H24 TIMED OUT (3,600,000ms; not accepted as evidence). H19/H24 DB/mail evaluator failed-check counts predate the current corrected evaluators — history, not current-code RED. Five of six H19 failures later scoped-accepted (§2); ACTUAL REMAINING = T11B: H19 failure is a sign-in `net::ERR_CONNECTION_RESET` at business-flow-helpers.ts:267 (signIn → page.goto('/sign-in')) inside setProductionSectionSharing — NOT the old Manage-click/hydration seam; cause unproven | T11B isolation repro after native readiness (post T16A gate); no broad run before that; no assumed causes |
| R13 | Final full matrix | Unchanged final gate: all FOUR route profiles × required scenarios incl. T15E actually wired+selected; fresh + REPEATED-run reliability (browser DB/in-app/test-SMTP/cleanup); explicit skips are not coverage | M7/M8 |
| R14 | T15E native chain | Approved architecture, M2–M5 below, with acceptance fences made explicit (§3) | M2–M5 |

## 2. Accepted scoped evidence index (each: SINGLE run, scoped; none is a full-suite/reliability claim)

> **Scope qualification (documentation reconciliation):** the five native reports below are single-run
> scoped acceptances with the listed limits; they never aggregate into full-suite, four-profile, repeated-run
> or reliability claims. Later UNCOMMITTED scoped-accepted work sits outside this table: scalar
> mail-port provenance/oracle (Tasks 139/140 — `scratch/t16a-task140-scalar-oracle-hardening/parent-task140-disposition.md`),
> the T16A safe-recording component (Tasks 149/159–161 — `scratch/t16a-task161-parent-recording-verification/parent-task161-fresh-verification.json`),
> and the DB-query/runner non-echo repair (Tasks 167–171 — `scratch/t16a-task171-parent-opaque-runner-verification/parent-task171-fresh-verification.json`;
> genuine 15-test RED → 15 GREEN, plus eight post-repair runner characterizations → 23 green). Historical
> recording feature-TDD remains unproven; the local recording component is not whole-T16A restoration.

| Accepted report | Scope proven | Explicit limits |
|---|---|---|
| scratch/t12a-focused-channel-retest-20260926-072501/astra-scoped-t12a-acceptance.md | T12A all-defaults, exit 0; 16 manifest phases incl. requester status-change bell + viewer-negative; mail 11/11 (3 global, 6 positive, 2 negative); exact decoded request IDs | DB evidence 2 pass / 18 skip (no T12 engine checks); no full-suite/flake/T16A-restoration claim; engine PID disappearance worker-reported |
| scratch/t15a-focused-ui-retest-20260927-075315/astra-scoped-t15a-ui-acceptance.md | T15A UI, exit 0; 12 phases; 2 native clicks / 2 observed POSTs in 3002ms bounded settlement; DB 17 pass / 18 skip incl. all 15 required T15A checks; mail 5 pass / 1 skip | Two observed POSTs prove NEITHER simultaneous server execution NOR conflict classification; deterministic server-concurrency case (T15E M5) pending |
| scratch/t18b-focused-mail-retest-20260925-114724/astra-scoped-t18b-acceptance.md | T18B, exit 0; DB 16 pass incl. all 14 required; restart/supersession/reason/audit persisted | 16 DB skips; UI-denial evidence, not a separate unauthorized API probe; mail 3 pass / 1 skip; single focused run |
| scratch/t18c2-focused-vacancy-retest-20260925-131643/astra-scoped-t18c2-acceptance.md | T18C2, exit 0; all 13 required DB checks (VACANT_POSITION skips ×3, zero groups/approvals, auto-complete audit) | 17 DB skips; mail 3 pass / 1 skip with ZERO messages = vacuous global checks, not delivery proof; single focused run |
| scratch/t04b-focused-diagnostic-20260925-164755/astra-scoped-t04b-acceptance.md | T04B, exit 0; 18 T04B + 2 fixture DB checks; correct FINAL routes/origins; Completed | 17 DB skips; did NOT reproduce the missing-Approve UI failure — establishes neither root cause nor fix nor flake elimination |

All five: engine/PID disappearance worker-reported, not independently probed; repeated-run reliability open.

## 3. T15E remaining dependency chain (approved architecture only — no redesign, fences explicit)

Cleared/test-domain-only: B1a1 pure protocol core, frame decoder, bounded JSON, readback schema; B1a2a bounded
wait helper (Task128); B1a2b readback-only collector (Task134 CLEARED_SCOPED — fake scope only). Remaining:

1. **B1a2b-tail/stderr + shared caps (contract gate first; M-B)**: tail collector (tag+ACK lines, 160B line
   bound, modelT15EMaintenanceTail as authority; aborted COMMIT stays UNKNOWN_COMMIT_NOT_CONFIRMED);
   count-only stderr: FIRST nonempty stderr → immediate STDERR_PRESENT failure fence BEFORE any further
   IO/publication; 4 KiB bounded count, no payload retention; cumulative 512 KiB stdout accounting across ALL
   phases enforced by the future controller (not the readback collector). Reuses the Task130/131 contract split.
2. **B1a2c injected-child maintenance controller (M3)**: already-open caller-owned child; captured
   clock/scheduler; finite absolute deadline; monotonic liveness/revocation; prefix write → WAIT_READBACK
   (sqlOk MODELED from complete frames+ACK, never caller boolean) → fixed COMMIT/ROLLBACK tail → actual
   tag+nonce ACK → END stdin → await ACTUAL child CLOSE(0) + ALL THREE stdio CLOSE events (not exit/finish);
   guarded one-shot write tokens; FRESH deadline/liveness/failure gates re-checked AFTER all successful
   finalizers, immediately BEFORE publication; 1000ms cleanup ceiling (TERM 250ms reserve + KILL 750ms) is
   the FAKE-scope design and is never native acceptance; module-level terminal sinks; authority:NONE,
   backendGoneConfirmed:false, cleanupObligation:PENDING_INDEPENDENT_MONITOR. No spawn API, no probe-stdin-end
   reuse, no TrustedCommand-union widening.
3. **B1b private factory + handshake + monitor (M4)**: producer-private construction; startup freshness;
   authenticated maintenance identity handshake; pre-established INDEPENDENT monitor (not controller-owned);
   actual installed PG15/16 version/SQL/tag/OS/auth verification before acceptance — fake facts never
   capabilities.
4. **B2 private issuer (M5)**: full-readback-confirmed ACTUAL COMMIT evidence; private credentials lifecycle
   (issue/ref/drop/revoke); truthful unknown cleanup; no mint in earlier slices.
5. **T15E-only atomic app URL wiring + measured overlap (M5)**: T15E-only atomic app URL (admin/shared URLs
   unchanged); FOR NO KEY UPDATE held coordinator; exactly TWO independently verified owned-app waiters;
   ARM READY nonce; exact pid/backend-start/db identity + backend disappearance; exactly ONE actual HTTP
   winner PLUS ONE source-supported classified loser — per tests/support/native/t15e-overlap-protocol.ts:914–918
   the loser category must NEVER be inferred from HTTP 500, rollback, or snapshot state; unsupported outcomes
   stay UNKNOWN. Two HTTP responses alone do not satisfy this. 3000ms hard acquisition → rollback ACK /
   500ms reserve; no Promise.all proof; endpoint FinalApproval/PENDING/two-pending-groups (not T15A Completed).

## 4. T11B / T16A current seams (no invented causes; source-contract gates first)

**T16A whole restoration (HUMAN-GATED; no approved design yet).** Current exposure (R11): mutation and
old-port capture are both inside setEmailSmtpPortViaUi; `originalPort` reaches the caller only on full helper
success, after save+reload, and the outer `finally` restores only `if (originalPort)`. **Mandatory obligations**
(any future design must satisfy ALL of these; a post-suite capture cannot substitute for in-test capture/readback):
(1) a FRESH authoritative read of the default email-settings row **ID + owned port** BEFORE the first mutating
Save, compared against the owned expected scalar; a polluted-9 / wrong-ID / mismatched / missing row REFUSES
with **zero Save**, no broken body, and no invented-2525 ownership; (2) the restoration obligation is ARMED
before any mutation and GUARDS both the break and body phases — it survives setter return, Save, reload,
evidence and sign-in failures, and is not cleared merely because the helper returned the old port; (3) EACH
restoration attempt gets an INDEPENDENT fresh same-ID+port verification, including when the setter itself
throws; (4) a VERIFIED already-restored state is a NON-ABORTING informational checkpoint (explicit policy for
setter-failure-vs-state-proof); (5) an independently latched outer BODY primary (presence + exact identity,
including all falsy values, never inspected or wrapped) WINS over restoration/verification/report failures;
with no primary, required secondary failures fail CLOSED in fixed owned categories. **Primitive bridge GAP
(proposed architecture, NOT an approved channel):** the existing admin getter is not it — it returns no row ID,
exposes SMTP username/host/sender/admin configuration, and falls back to ENV for a missing row (password
withheld ≠ approved credential-free projection). Browser/Playwright must not receive DATABASE_URL, SMTP
credentials, standard transport, or private OwnedRuntime authority; the accepted `BUSINESS_MAIL_PORT` scalar is
the only existing publication; atomic app-role URL adoption is T15E-only. **Required sequence before any
implementation:** separately authorized 172-report recovery/fresh facts review → human conversational choice
and design approval → written SPEC (review + human approval) → written PLAN (review + execution choice) →
safety-gated GENUINE behavior RED (missing APIs/options/projections are not RED) → fix/review → isolated
native retest. No bridge/API/transport is chosen by this document.

**T11B.** The only unresolved full-suite failure without a scoped acceptance. Its H19 seam is a sign-in
ERR_CONNECTION_RESET (business-flow-helpers.ts:267) inside setProductionSectionSharing — new, not the
historical Manage-click/hydration seam (that history is real but is NOT assumed to be this cause). Plan:
isolation repro AFTER native readiness and AFTER the T16A restoration gate; no broad run before that;
diagnose only on fresh reproduction evidence. T11C is green in H19; R4/R6 worksheet gaps are handled in M-COV.

Runner facts stay source-anchored: full command
`npx tsx tests/support/native/run-native-business-tests.ts --mode=full --routes-config=<all-defaults|
solution-exception|final-exception|solution-and-final-exceptions>` (run-native-business-tests.ts:58;
business-runner-cli.ts validates the four named configs); budgets read from runner source, never guessed.

## 5. Milestones (dependency-ordered)

- **M-A — whole-T16A restoration: HUMAN-GATED design → SPEC → PLAN → safety-gated genuine behavior RED →
  fix/review → isolated native retest** (FIRST deliverable; blocks every broad run). The old direct
  "contract → minimal repair/test" mandate is SUPERSEDED: Task172's options report is FACTS/SPEC/QUALITY/
  DISCUSSION BLOCK, Task173 recovery setup failed prelaunch (owner paused), and no architecture choice,
  bridge, or source edit is authorized until the human conversational design approval, written SPEC (review +
  human approval), and written PLAN (review + execution choice) exist (§4). Until then no direct repair is
  authorized from this roadmap.
- **M-B — tail/stderr/shared-caps contract + fake implementation** (§3.1) on the Task134 cleared readback;
  Task131/134 pattern (contract review → fake-only implementation → Sol review → focused evidence).
- **M2/M3/M4/M5 — B1a2c controller → B1b factory/handshake/independent monitor → B2 issuer + T15E-only
  atomic app URL + measured overlap** (§3.2–3.5), with the §3 fences as acceptance criteria; native PG15/16
  actually verified (installed/auth/SQL/tags/actual COMMIT/backend disappearance).
- **M-COV — pre-full coverage expansion (before M7; contracts reviewable any time, runtime only after
  gates).** Deliverable format: a requirement → applicable-profile → existing assertion/source → fresh-evidence
  matrix per item; each future interface behind its own bounded contract (no invented upload/action wire APIs
  now):
  1. Full actor/checkpoint/share-state worksheet (all checkpoint rows × applicable profiles incl.
     OFF-state Department-manager) owner-reviewed, then spec assertions (R6).
  2. Attachments: upload, authorized file access, and denied server/file/direct-URL (`/requests?requestId=`)
     access for denied actors (R5).
  3. Missing notification transitions: rejection/resubmission recipient/link/multiplicity checks and
     superseded-step negatives, bell + mail (R7; canonical T12 recipient matrix).
  4. Authenticated DIRECT solution/action/configuration denials: UI + server-action solution denial
     (canonical:60); direct unauthorized publish/actions (canonical:140); explicit disposition of the
     historical bounded exclusions (e.g. business-config-guards.spec.ts:25–45 code-level substitutes).
  Classification rule: legitimate profile-inapplicable skips are classified with rationale, never counted as
  coverage; required-but-BLOCKED/omitted cases prevent final acceptance. No silent drops; no demand that every
  profile duplicate inapplicable cases.
- **M7 — full matrix execution**: T01–T20 across all four route profiles with T15E wired+selected; T11B
  resolved or explicitly blocked; explicit-skip policy enforced; evidence index complete; repeated-run
  reliability incl. a rerun of a previously timed-out full run.
- **M8 — final audit + report + parent milestone commit only when actual evidence meets the plan** (no
  evaluator weakening; no blanket drops).

## 6. Next 1–2 bounded deliverables (concrete)

1. **Whole-T16A restoration — HUMAN-GATED sequence first (supersedes the old direct-repair item):**
   separately authorized 172-report recovery/fresh facts review → human conversational choice/design
   approval → written SPEC (review + human approval) → written PLAN (review + execution choice) →
   safety-gated GENUINE behavior RED (missing APIs/options/projections are not RED) → fix/review → isolated
   native retest with independent restored-ID+port verification (all §4 obligations). No spec/plan/source
   artifact is created by this roadmap document.
2. **tail/stderr/shared-caps collector contract + fake implementation** (§3.1/M-B) on the Task134 cleared
   readback, carrying the STDERR_PRESENT/4 KiB/512 KiB-all-phase fences and the controller-side obligations
   verbatim.

Removed from the plan (superseded by current source, §1): the old R2/R8 evaluator-repair first slice and the
R4/R7 harness-repair slice — their targets are already fixed; any newly reproduced evaluator defect needs its
own fresh evidence and bounded contract. M0 owner-decision gate removed: R1/R3/R9 are implemented/policy-
aligned with historical passing evidence (fresh matrix verification pending); parent decision remains
necessary only for genuinely NEW scope or ambiguity.

## 7. Evidence and honesty rules (carry into every slice)

Preserve all prior green evidence; every final claim needs FRESH runs. Explicit skips are never coverage; a
50-test default run without T15E wired cannot prove completion; profile/scenario skips recorded per run with
applicability rationale. Scoped acceptances (§2) are single-run evidence: never aggregate them into
full-suite or reliability claims. Final acceptance requires the full T01–T20 matrix across all four profiles
with repeated-run reliability, browser DB/in-app/test-SMTP/cleanup evidence audited independently, restored
fixtures, and no evaluator weakening or blanket drops. Budgets read from real runner source, not guessed.
Data/artifact authority NONE; no raw SQL/stdin/stdout/JSON/stderr/error/env/credential dumps anywhere; no raw
captured SMTP/wire/traces read into artifacts. Runtime effects stay off until parent readiness gates.
