# Upgrade Migration: main (departments) → organization redesign

Date: 2026-10-19 · Owner decision: existing production must upgrade in place (not fresh-install only).

## Problem
The branch replaced main's 18 migrations with one squashed `00000000000001_clean_start_init`. On an existing DB `prisma migrate deploy` runs that init, fails on `CREATE TYPE "ApprovalStatus"` (already exists) and records P3009, blocking every later deploy. The squash also dropped the audit-trail append-only trigger, and nothing maps old data (departments, levels) to the new model.

## Approach
1. **Restore main's 18 migrations unchanged** and delete the squashed init. Existing DBs already have them applied → no-op. Fresh DBs replay them.
2. **Append one migration** `2026101900000x_organization_upgrade`:
   - DDL = `prisma migrate diff` (main schema → branch schema), **re-ordered** so new tables/columns are created and filled *before* old columns/tables are dropped.
   - Plus every raw-SQL piece of the squashed init that Prisma can't express (CHECK constraints, partial unique indexes, etc. from B13), diffed against the generated DDL.
   - Data steps (below) run inside the same migration (one transaction).
3. **Audit trigger** is kept from main's migrations (never dropped) — test asserts it exists after migrate.
4. **Prod bootstrap seed** split from the dev fixture (fresh installs).
5. Verified on a disposable Postgres: (a) fresh DB → all migrations → app check; (b) DB at main's last migration + realistic fixture data → upgrade → row-count + mapping assertions; (c) clean-start constraints integration suite.

## Data mapping
| Old (main) | New | Rule |
|---|---|---|
| — | `organization_units` root + `company_settings.rootUnitId` | One root unit "Company" |
| `departments` | `organization_units` (child of root) | **Same id reused**, same name; `canWorkOnSolutions` = type ENGINEERING; `shareRequests` = false |
| levels 1–10 in use | `positions` | One position per used level, `rank` = level, name `Level N` (see Q1) |
| `users.departmentId` + `users.level` | `organization_assignments` | Active assignment in that unit at that level's position. Users with dept but no level → lowest position (`Level 1`? see Q1). No dept → no assignment (admin assigns later; listed in upgrade report) |
| `department_approvers` (external approver of dept D at level L) | extra `organization_assignments` | Assignment of that user in unit D at `Level L` |
| `departments.managerUserId`-like data | `organization_units.managerUserId` | Highest-level user of the dept, if exactly one |
| `requests.departmentId` | `requests.organizationUnitId` | Same id (reused) |
| `budget_codes.departmentId` | `budget_codes.unitId` | Same id |
| — | default `approval_route_versions` + steps | One PUBLISHED company-wide route per phase (REQUEST, SOLUTION, FINAL) mirroring the old level ladder |
| `hierarchy_change_logs` | dropped | Copied into `request_activities`? No — exported to a CSV in the upgrade runbook before drop |
| `request_approvals/solution_approvals.requiredLevel`, `isCustomChain` | dropped | Historical rows keep approver/status/comments; see Q2 for open approvals |

## Owner decisions (2026-10-19)
- **Q1 — Positions:** one company-wide position per used level, named `Level N`, `rank = N`, **higher level = more senior**; chains climb 1 → N. Admin can rename positions in the UI later.
- **Q2 — Requests mid-approval:** **block the upgrade until none are open.** The pre-check lists open requests; the migration itself also aborts (RAISE EXCEPTION) if any approval row is still pending, so it can never run half-mapped.
- Also include: `organization_units.shareRequests` default → false (schema already changed in `3dcf617`).

## Runbook (production)
1. Backup DB. 2. Run pre-check script (open approvals per Q2, users without dept, level gaps). 3. Deploy → `migrate deploy` applies only the upgrade migration. 4. Post-check script prints mapping report. 5. Admin reviews org tree, assigns unassigned users.
