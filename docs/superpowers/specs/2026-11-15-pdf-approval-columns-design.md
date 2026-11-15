# PDF approval-chain columns

## Intent
Make exported approval history understandable: show department names instead of account-role codes, distinguish approval sequence from organizational position, and separate repeated attempts.

## Approved approach
The user selected clear labels with attempt grouping.

Columns: **Step | Approver | Position | Department | Status | Decision date | Comments**.

- Keep existing phase sections (initial review, engineering solution, final approval).
- Within each phase, group by persisted approval instance/attempt, ordered by attempt then step. Label groups `Attempt N — Superseded` or `Attempt N — Current` using supersededAt. Legacy rows without an instance appear in `Legacy history`, without inventing an attempt number.
- Step uses persisted approval order (`Step 1`, etc.), not the row index across attempts.
- Position uses the required approval position name, not order or account role. Missing position displays `—`.
- Department uses the approval candidate group's scope organization-unit name when available. For person-specific/legacy rows, use the actual approver's active organization assignment, falling back to the required approver's assignment only when no actual approver exists. If unavailable, display `—`; never substitute a role code, the requester's department, or hard-coded Engineering. Assignment fallback reflects current organization data, not a claimed historical snapshot.
- Approver uses the actual decision maker, or the required person when no decision maker exists. For unresolved group rows, use an explicit `Not recorded` placeholder rather than attributing a decision to the requester or generic Engineering.
- Rename Approved to Decision date; render the stored decision timestamp for approved or rejected rows, and `—` when absent. Do not invent dates or reinterpret stored statuses.
- Retain superseded approval history, comments, and statuses. Keep export eligibility and permissions unchanged.

## Approaches considered
1. **Clear labels and attempt grouping (selected):** fixes misleading semantics and makes rejections/retries understandable.
2. Keep Stage/Level headings and use organizational rank: less visual change, but numeric levels remain less informative than position names.
3. Department only: smallest patch, leaves misleading stage numbering and mixed attempts.

## Scope and verification
Small PDF reporting change: server-side report data, PDF table rendering, and regression tests. No database migration, workflow changes, or unrelated editor/package fixes. Verify department resolution, step/position mapping, attempt separation, legacy/missing data, preserved history, and rendered HTML; run npm run check and update graphify. Report existing check blockers separately.
