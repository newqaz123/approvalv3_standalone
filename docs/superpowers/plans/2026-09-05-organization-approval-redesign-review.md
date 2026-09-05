# Parent review — organization approval implementation plan

Date: 2026-09-05
Reviewer: parent assistant, personally (not delegated)
Disposition: Plan reviewed and corrected; ready for owner execution decision. This is a documentation review, not verification of implemented code.

## Review evidence

Read the entire delegated 16-task draft and approved specification. Queried graphify and checked source for final initiation/notification semantics (`src/server-actions/solutions.ts:1283–1439`), required legacy request department and nullable user department (`prisma/schema.prisma:276–312,423–460`), current scripts (`package.json`), and existing admin/user/API paths. Did not accept the delegate's completion statement as proof of correctness.

## Findings and resolutions

| Finding | Resolution in final plan |
|---|---|
| Task 1 intentionally left a test failing until another task | Removed future import; each task must close its own test cycle and pass check |
| Route preview depended on a later engine task | Explicit dependency order runs Task 7 before Task 6; draft preview uses same read-only resolver |
| Reusable route validation contradicted higher-level auto-approval | Validate definition ordering/ceiling; filter lower/equal positions per initiator at resolution |
| Missing promised publication index, historical context and terminal states | Added SQL publication/primary indexes, ownership and attempt constraints, immutable origin context, terminal outcomes |
| Mapping fixture had an invalid Factory→Section relationship and lacked primary assignment | Corrected full ancestry and primary flags; explicit fake-manager-container and external-assignment dispositions |
| Engine lacked enough branch/position context and mixed read resolution with writes | Added branch/position/context contracts, typed adapters and separate persistence |
| Legacy adapter was reduced to numeric equality | Requires full existing phase-specific eligibility, including department/external/custom/status checks |
| Retained history could leak into pending queries | Legacy-attempt wrapping on first NEW resubmit and current-instance filtering across action/notification queries |
| Claimed concurrency evidence was a serial fake test | Added actual concurrent disposable-CI PostgreSQL test gate, request locking and phase-aware compare-and-set |
| Final custom notification was described as notify-all | Corrected: custom solution submit/resubmit notifies all; custom final initiation notifies first only, verified in source |
| Archived detail/download reads would fail | Archive hiding only on default lists; authorized direct/archive reads remain available |
| Visibility adapter names/types were inconsistent | Added explicit production adapter, empty-set deny predicate and server-derived capability actor |
| Attachment writes and privileged retention risked inheriting ordinary read rules | Retained write-specific checks and admin-only recovery/history semantics |
| Manager without a section could not own a request | User chose managed-unit ownership; nullable legacy request department, persisted origin unit and user-form support added |
| Dry-run mapping had no controlled application/backfill | Added release-only reviewed/idempotent importer, provenance record, historical origin backfill and persisted verification |
| Rollout modes were disconnected from attempt creation | Creation-only gate, non-mutating shadow, import/coverage verification and persisted-discriminator execution |
| Rollback would send parent-only users through legacy section requirements | Pause unsupported new creation instead of inventing a section; existing snapshots keep their execution semantics |
| Action examples omitted resubmit/file cases and could become a second permission policy | Expanded capability cases; adapt actual existing guards rather than infer rights from visibility/position |
| Overstated self-review checklist | Replaced with specific parent corrections, acceptance gates and explicit non-implementation status |

The relevant task acceptance additions are mandatory parts of the plan, not optional future cleanup. Implementation examples define contracts to implement and test; they are not claimed to compile before execution.

## New unit-owned request interpretation disclosed at handoff

The user explicitly selected managed-unit ownership for a manager's own request. The plan generalizes existing same-section membership to direct origin-unit membership for these new requests' same-unit actions and informational audiences. Descendant/ancestor read visibility is not membership, approval authority or a notification subscription. Existing section requests retain their current section-wide audiences and action restrictions. This interpretation is stated in both plan and spec for the owner's execution decision.

## Remaining execution/release gates

- Explicit authorization to implement; no application implementation has started.
- Reviewed real organization mapping and route ceilings; no fabricated production values.
- Isolated worktree, one writer, per-task checks and review checkpoints.
- Actual role/scope/status and notification behavioral tests, plus disposable CI migration/concurrency evidence.
- Owner-controlled deployment/data import; no production migration locally.
- All-inactive pending snapshot recovery remains outside scope: fail closed, no automatic replacement.

## Verification

Documentation whitespace checks were performed on tracked and new plan files. No `npm run check` or application tests are claimed: only documentation changed. Unrelated untracked attachment-planning and presentation files were preserved. The final response reports the actual documentation check/commit results separately.
