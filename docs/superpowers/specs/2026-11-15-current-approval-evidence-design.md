# Current approval evidence PDF

## Intent
The ordinary exported PDF is approval evidence for another workflow, not an audit-history report. This supersedes the ordinary-export history and department-source decisions in the earlier PDF approval-columns design.

## Selected approach
- Retain the existing initial, solution, and final phase sections, but include only approvals belonging to the current, non-superseded instance in each phase. Use existing current-instance semantics; legacy rows without an instance continue to count as current. Do not select the latest row globally by step number or borrow approvals from prior attempts.
- Remove attempt/history subheadings from ordinary exports. Preserve Step, Approver, Position, Department, Status, Decision date, and Comments.
- Department comes exclusively from the actual approver's active assigned organization unit. If there is no actual approver, use the required person's assigned unit. If the actual approver exists but has no assignment, show `—`, never another person's department.
- Do not use the approval-routing scope, parent/root unit, role codes, or hard-coded Engineering as the department. If a person is actually assigned to FACTORY, do not invent a narrower unit; accurate organization assignment data is required.
- Keep the existing completed/current-approvals eligibility and permissions unchanged. Do not silently hide unresolved current decisions to manufacture approval evidence.
- Keep administrative backup history and existing activity logs unchanged; this revision concerns ordinary export approval-chain tables. Admin backups retain attempt grouping and history, but also use the corrected assigned-unit department source.

## Approaches
1. Current chain + assigned unit (selected): concise evidence identifying who approved each current step and where they work.
2. Full attempt history: appropriate for audit review, not the requested evidence table.
3. Parent department: user declined in favor of specific assigned unit.

## Scope / verification
Update report mapping and ordinary-versus-backup rendering metadata, plus regression tests. Verify superseded rows are excluded only from ordinary chain tables, all current phases survive, old steps are not mixed into a new chain, assigned unit wins over FACTORY routing scope, missing-assignment handling remains honest, and admin backups retain history. Run npm run check and regression suite; update graphify. No migrations, organization-data edits, or unrelated dependency changes.
