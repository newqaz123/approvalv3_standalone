# Rejection and Recovery Matrix — Approved Test Scope

## Owner decision
Owner requested rejection testing “in all scenarios” and explicitly selected **Full matrix + recovery**: REQUEST, SOLUTION and FINAL; rejection at each approver position; default/custom chains across all four route profiles; correct, resubmit and reapprove afterward. Continue the existing delegated GLM worker method with parent evidence review. No product behavior changes are authorized by this testing request.

## Intent
Verify legitimate rejection, safe handback to the permitted reviser, new approval attempts, complete reapproval to Completed, and preservation of history/permissions. Do not call profile skips or a merely live resubmitted attempt full recovery success.

## Matrix axes
- Profiles: `all-defaults`, `solution-exception`, `final-exception`, `solution-and-final-exceptions`.
- Phases: REQUEST, SOLUTION, FINAL.
- Chain kinds: selected profile rank route; separately UI-supported CUSTOM_PERSON chains.
- Rejection position: every eligible active step, each on a different fresh request. Approve only preceding steps before rejecting that target.
- Actor origin: native fixture requester A and Engineering submitter A; custom approvers must have active valid assignments and be selected/reordered through the UI, not injected into the DB.
- Each profile gets a newly owned isolated fixture/runtime. Do not change the current corrected demo's config, routes, sharing, accounts or existing requests.

## Expected policy
Existing product policy is authoritative; do not weaken it to pass tests. Rejection requires a nonempty reason. REQUEST rejection returns to original-requester revision/resubmission. SOLUTION rejection requires permitted Engineering revision/resubmission. FINAL rejection returns to Engineering for solution redesign and reapproval, then a fresh Final initiation and reapproval; do not bypass Engineering with a direct restart.

For each fresh case: verify required-reason UI guard before submitting a unique reason; persist rejection once; inspect correct phase state, rejecting actor, reason, instance and audit rows; verify permitted reviser control and read-only absence for an unauthorized viewer; revise visible content (and solution estimate when applicable); submit a new attempt; verify approvals restart at the intended first step, no prior approval silently carries over, old attempt remains historical/nonactionable, then finish REQUEST/SOLUTION/FINAL through the real UI to Completed. Verify current/future/excluded actor controls and terminal visibility where fixture supports it. Cross-department loaded-list absence is not direct-link denial.

Stale/replayed rejection denials are additional explicit negative cases where supported by a real held UI dialog. They require a documented expected-denial predicate before execution; expected guard denial is not an unexpected business failure. Never submit a stale rejection while it could target a legitimate new current approval. No API/DB approval workaround.

## Coverage inventory and applicability
The existing `business-reject-resubmit.spec.ts` T14 tests are all-defaults-only, mostly first-step and end at live resubmission, not Completed. They are reference policy/evidence, not the complete requested matrix.

Native fixture default route lengths appear REQUEST=3, SOLUTION=3, FINAL=2; exceptions shorten SOLUTION to2 and FINAL to1. With two-person custom SOLUTION and FINAL chains, provisional primary count is 12+11+11+10 = **44**. Confirm this inventory against actual fixture and UI before any mutation. Never assume the six-rank corrected demo has these native-fixture lengths.

Investigate whether REQUEST CUSTOM_PERSON is exposed by the creation UI. If it is unsupported, document source/live evidence and mark that UI combination not-applicable/unsupported, not passed; ask parent if this changes the scope materially. Do not implement new product features or force unsupported UI cases through API calls. Enumerate negative cases and expected coverage separately from primary recovery cases. All coverage claims must refer to concrete inventory IDs.

## Evidence and safety
- Preserve current dirty source tree and all earlier failed evidence. No commits, resets, stashes or index changes.
- No production/shared DB or SMTP; no production migration. Bootstrap/seed only a freshly allocated, identity-verified, empty owned test cluster, using the test fixture and native safety harness. Never reseed/migrate the existing corrected demo.
- No `.env` edits, package changes, shared Next cache invalidation, broad process kills, or launcher restart without clearance. New profile runtimes must have noncolliding ports and isolated build/cache directories.
- Headed Chromium: 1500ms slowMo, 1440x1000 viewport, 6000ms checkpoint pauses; readable actual modal/header/card screenshots, traces, logs and isolated loopback mail capture.
- Durable attempting ledger BEFORE every UI business Submit/Confirm; fresh persisted verification before confirmed. No internal approval retries (`approveSolutionStepViaUi` is unsuitable), Playwright retries0, one writer/worker, sequential cases/profiles.
- Any unexpected assertion/page/business/runtime error stops all subsequent mutations across the matrix. Preserve original failure and ledger, read-only diagnose ambiguous actions, ask supervisor before a separate continuation. Never replay a persisted action.
- Test-only harness changes require behavior regressions where applicable, `npm run check`, graph update and parent patch clearance. Application bugs found during testing are blockers requiring a separate owner fix decision.
- Delivery: concrete passed/failed/blocked/not-applicable counts, per-case recovery and DB/UI evidence, screenshots and remaining gaps. Parent visual review is separate from native independent review and full release acceptance.
