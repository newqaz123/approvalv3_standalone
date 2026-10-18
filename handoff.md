# Handoff: blocked approval-clock fixture lifecycle repair

## Immediate task

Fix the remaining test-fixture lifecycle defects using a fresh approach. **Do not treat prior worker completion or green test totals as acceptance.** The latest independent review is BLOCK. The user requested this handoff to use another model; this document itself grants no new execution, delegation, runtime or scope authority.

No background work remains from the latest workflow; last supervisor check found no pending requests. Process cleanup has NOT been independently verified by the parent. Do not infer that no fixture processes remain, or indiscriminately scan/kill processes to investigate.

## Repository and source boundaries

The chat root is `/Users/red-copperpot/Documents/MyProjects/ApprovalAppV3_Standalone`, but **all implementation work belongs in**:

```
/Users/red-copperpot/Documents/MyProjects/ApprovalAppV3_Standalone/.worktrees/organization-approval-redesign
```

- Branch: `pi-subagents/setup-preflight-7aabdf7-b8d5-s0-t0`
- HEAD: `1ff079401040e17d6532e449327e80ae88fc8a41`
- Intentionally dirty workspace. Preserve the exact tracked dirty set, empty index and HEAD/branch; do not reset, stash, stage, commit, push or clean it.
- The narrow pending repair is **test-only**, inside the newly added B suffix of `tests/regression/rejection-recovery-matrix.test.ts` (T).
- Fixture helper is approximately T:6602–6800; lifecycle tests approximately T:7297–7507. Inspect current locations rather than relying on line numbers.
- Freeze the complete accepted **838-test prefix: first 427,470 bytes**, SHA-256 `8a180e950fd4b97c5a555b72809faf5b598c1648b45b3827f68219b93a7336f4`.
- That includes the original 803-test/357,284-byte prefix and accepted Stage A clock math/tests.
- Fully freeze S: `tests/support/rejection-recovery-matrix.ts`, R: `tests/support/native/rejection-recovery-runtime.ts`, and M: `tests/manual/rejection-recovery-matrix.ts` during a fixture-only repair.
- Preserve original observer wrappers, outcome/privacy fences, journal append/ID properties, compiler/AST transforms, shared launcher/stop helpers, outbound preload, product source, dependencies and configuration.

## Current source pins (parent checked after latest review)

| File | SHA-256 |
|---|---|
| S | `76296398bcde0d209c85648af7cb6adcad0d994a5e47c52c3b7b8c3646a4111f` |
| R | `016d85b4d067326b30eeb2af288b214d0369ccf0edca5f87d6def50e4afc0fcf` |
| M | `8098c25d00254013337265eb8ac4c10d1442b3322af88c9e9a704dcd4062effc` |
| T | `02a890487dde237cd4380efe999313a064dd66326347c1728f7f9cff3d05e8ad` |

Final T: 528,640 bytes. Parent checked these four pins, but did not rerun tests or verify process cleanup after the latest review.

## Evidence navigation — read these first

Paths below are relative to the worktree. Define:

```
E=test-results/rejection-recovery-20261011/assurance-20261013/implementation-20261013T233333Z/offline-integration-20261015T233108Z/clock-only-implementation-20261017T153007Z
F=$E/fixture-native-followup-20261018T152616Z
```

1. **`$F/independent-fixture-review.md`** — latest authoritative independent findings; read completely.
2. `$F/parent-disposition.json` — parent retained BLOCK, current pins, safety deviation and authority boundary.
3. `$F/authority.md` — exact latest repair authority and restrictions.
4. `$F/worker-report.md`, `plan.md`, `evidence-corrections.md`, handoff/implementation evidence — claims must be checked against the review and logs.
5. `$F/parent-current-tracked.diff` — captured current dirty diff, NOT solely this repair.
6. `$F/before-tests__regression__rejection-recovery-matrix.test.ts.txt` and final snapshots/diffs under its attempt directories.

Earlier relevant reviews:

- `$E/fixture-native-repair-20261018T145009Z/independent-fixture-review.md`
- `$E/fixture-claude-repair-20261018T143618Z/independent-fixture-review.md`
- `$E/stage-B-step1-gpt-repair-20261018T132918Z/independent-repair-review.md`

Latest workflow: `0338a4b1-e7d9-4ce9-b59c-45e477fbd786`.
- Native worker: `cfbbaa70-4f02-4170-83ba-75ede9238f0c`
- Independent reviewer: `b9802f62-9ff7-4fa4-8f3b-b811001221ba`
- Both completed; review verdict **BLOCK**, not accepted.

## Remaining defects — do not repeat the same patch loop

### 1. Child completion still depends on the fixture parent surviving

The extra stdout channel is written by the fixture parent's child-exit callback. If that parent dies after spawning its child but before that callback, the harness has no independently surviving completion observer or owned cleanup capability for the child.

Current tests evade this case:
- `parent-exit-before-ready` exits before spawning a child.
- `parent-disconnect-before-ready` keeps the parent alive until the child exits.

Missing child evidence becomes an assertion failure after parent exit; it does not complete child accounting. The review does not allege a lingering orphan in current GREEN, but the guarantee remains absent.

### 2. Parent error falsely becomes observed exit

Every parent `error` sets `parentExit = {code:null, signal:null}` and marks terminal. Later `parentExitObserved` becomes true without an exit event. The failed-spawn test incorrectly expects this.

Distinguish:
- Positive failed-to-start evidence / no actual spawned child;
- Errors after successful spawn;
- Actual terminal exit/close observations.

An error is not an exit, and a post-spawn error must not suppress later exit facts.

### 3. Final escalation does not settle actual termination

After requesting SIGKILL, the helper immediately records `unresolvedOwnership: {stillAlive:true}` before an exit event can run. That snapshot is never reconciled. It then waits indefinitely for stdout termination.

A PID/boolean is not an actionable transfer of ownership. Memoized settlement prevents subsequent `stop()` calls from continuing cleanup. SIGKILL intent is not reap proof; neither pipe close nor timeout proves child exit.

The existing stall test exits on SIGTERM and does not cover this final-ladder path.

### 4. Current RED violated explicit execution restrictions

The follow-up's RED ran the old real branch `process.disconnect(); process.exit(5)` after child readiness but before child reap. Its log records the descendant's `ERR_IPC_DISCONNECTED`.

This was explicitly prohibited. Later EOF-driven child termination does not make the test compliant. Preserve/disclose it; do not replay it, claim it was safe, or retroactively authorize it.

Parent-loss falsification must use a safe deterministic injected lifecycle model before any permitted real fixture validation. The last parent recommendation was **read-only ownership redesign before another execution attempt**; that redesign was not launched.

### 5. Evidence wording correction still needed

Combined RED cancellations were attributed to the IPC exception. However, isolated failed-spawn RED reproduces pending-promise/event-loop cancellation without that error. Record these as separate observations, not an established causal chain.

## What improved and should be retained

- All ten lifecycle tests now protect assertions through immediate cleanup capture and `try/finally`.
- IPC operations are guarded; current GREEN logs contain no recorded `ERR_IPC_DISCONNECTED`.
- Raw acknowledgement and separately reported child-exit data are distinguished, although the latter still depends on the parent's survival.
- SIGTERM stall coverage observes real parent termination.
- Latest evidence includes per-mutant diffs/hashes/restoration comparisons and broad preservation checks.

Do not discard useful fixes or rewrite unrelated code. Seek a minimal ownership/state-machine design that genuinely covers failure, rather than more timers and passing-mode substitutions.

## Validation and preservation facts

Latest recorded results, NOT rerun by parent:

- Focused B: **42/42, exit 0**.
- Final lifecycle: **10/10, exit 0**.
- Full matrix file: **880 tests / 877 pass / 3 fail, exit 1**.
- `npm run check`: initial typecheck failure retained; corrected run **4080 tests / 4076 pass / 3 fail / 1 skip, exit 1**.
- `graphify update .`: recorded exit 0 with warnings.

Exactly three inherited failures remain outside fixture/clock repair scope:

1. Registered capture-hook/idempotent stop: `EEXIST` at `/tmp/retained-root/runtime/owned-stop.json`.
2. Deferred readiness/opener/submission: `form.locator(...).first(...).getAttribute is not a function`.
3. Pre-opened resubmit: same `getAttribute` cause.

Do not delete retained artifacts or change fixtures to make these pass. Full check is **NOT GREEN**. Compare failure names and complete causes, not just totals.

Broad latest worker preservation evidence reports:
- 20,553 protected-content hashes.
- 5,607 opaque size/mtime-only records — **never read their contents**.
- Exact tracked dirty-set, empty index, HEAD/branch and auto-resume pin unchanged.
- R/S/M and accepted T prefix unchanged.

Primary preservation inputs: `$E/preflight.json`, `$E/opaque-exact-expected-stats.json`; preflight points to original protected baseline. Use exact integer nanosecond metadata, not rounded JavaScript numbers.

Keep `.pi/keep-going.json` unchanged; historical SHA:
`28506bb3bb197930388683ffe02af9d52e7be2e1b67e6dc4b628e15c6f4fd34d`.

## Safe continuation requirements

Obtain explicit owner authorization for the next bounded action. Latest user requested handoff, not another automatic repair.

If repair is authorized:
- Native pi worker/reviewer only unless owner explicitly changes that instruction. **No external CLI fallback.**
- One writer in this worktree; independent read-only reviewer before completion; parent must read the real verdict.
- No automatic repair/retry loops or next-stage progression after BLOCK.
- T fixture/B suffix only; freeze R/S/M and accepted prefix.
- No actual app/browser/PG/mail/network/native runtime allocation/start/probe, SQL, original handler/auth/Prisma initialization, historical/arbitrary PID queries or above-owned-root walks.
- No process scanning or broad process-group signals. Only positively captured fresh fixture ownership may support cleanup. A lack of ownership is a stop condition, not permission to guess.
- Real failure tests must not deliberately orphan descendants. Use deterministic injected terminal-event sequences for dangerous failures; a timeout is not cleanup proof.
- Cleanup must remain available even when readiness, acknowledgement validation, assertions or cancellation fail. Preserve primary test errors without hiding cleanup failures.
- Treat failed spawn, post-spawn error, observed child exit and unresolved live ownership as distinct states.
- No unhandled errors hidden inside passing TAP logs; inspect subprocess stderr too.
- TDD: genuine behavioral RED, safe GREEN, targeted mutants with actual mutation diff/source hash, exact restoration verification and restored GREEN per mutant.
- Each attempt gets unique append-only logs/statuses/snapshots. Never overwrite prior attempts or reconstruct missing historical exits.
- Run `npm run check` after changes; full-file/focused validation and `graphify update .` remain required. Preserve graph warnings; no dependency installs to repair tooling.
- No native verifier execution or `native-*` output creation; gate retry requires separate permission.
- Bound work to 60 minutes with final validation/partial checkpoint beginning by 45 minutes; stop honestly if incomplete.

## Broader project context — not current implementation scope

Goal: validate four approval profiles and a 44-case rejection/recovery inventory through two fresh independently verified passes (88 executions). Historical coverage remains **29/44**, fresh **0/88**. No live execution is cleared.

Stage A clock math was technically accepted after repair and independent review. Stage B metadata/observer work is partial and blocked. Step 1 bridge repair had seven implementation issues corrected; the fixture lifecycle blocker prevented its acceptance. Steps 2–6, Stage C consumers, native gates, formal acceptance and operational release remain separate and unreleased.

Design references under `$E/parent-B-gate-failure-20261018T052717Z/`:
- `independent-B-audit.md`
- `stage-B-repair-plan.md`
- `stage-B-contract-checkpoint-revision-1.md`
- `independent-contract-revision-1-rereview.md` — OK_WITH_NOTES for consistency only.
- `three-design-holds-resolution-proposal.md` — user approved design directions, NOT blanket execution.

These propose separate source-approval/runtime observation artifacts, truthful asynchronous host proof dispatch, and every-lease cleanup-index/final-receipt semantics. They do not supply authentic missing Task5 predecessors or authorize C/S/M changes now.

Original V3 timing/design documents:

```
test-results/rejection-recovery-20261011/assurance-20261013/implementation-20261013T233333Z/offline-integration-20261015T233108Z/clock-calibration-plan-20261017T095918Z/revision-2/
```

Preserve 15,000ms held-stale / 30,000ms positive result waits after the one confirm click, separate 5,000ms drain, and the observer-local 1,000ms admissibility limit. No timeout implies actual termination or noncommit.

## Tooling lessons

A prior Claude CLI attempt performed no repair:
- Builtin `claude-code` was no-tools and returned literal unexecuted tool-call text instead of a plan.
- `claude-code-writer` only exposed Read/Write/Edit/Glob/Grep, not command execution.
- Process completion was mistakenly allowed to advance the workflow despite missing semantic output.
- User subsequently explicitly chose native pi worker/reviewer and prohibited external CLI.

Do not confuse native completion, writer attestation, reviewer verdict, parent technical acceptance, formal acceptance and live clearance.

## Final handoff status

**BLOCKED.** Current candidate/evidence are preserved. No automatic work is running or authorized by this handoff. Historical evidence loss, unsafe RED execution and budget breaches remain retained facts. Do not label the fixture, Step 1, Stage B or the overall approval harness complete until the applicable independent review and parent disposition actually support that claim.
