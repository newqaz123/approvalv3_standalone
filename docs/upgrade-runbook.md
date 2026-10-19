# Upgrade runbook: departments → organization model (in place)

Applies when you deploy the organization redesign onto an existing production
database that runs main (departments + numeric levels). The release adds one
migration, `20261019000000_organization_upgrade`, on top of main's 18. `prisma
migrate deploy` only applies that one. Design and owner decisions:
`docs/superpowers/specs/2026-10-19-upgrade-migration-design.md`.

The examples assume the production compose project (`approval-db` container,
`.env.production`). Replace `<user>` and `<db>` with `POSTGRES_USER` and
`POSTGRES_DB` from `.env.production`.

## 0. Rehearse (optional, recommended)

On a workstation with PostgreSQL 16 binaries, run the disposable verification
(fresh install, upgrade with legacy data, and the guard):

```bash
bash scripts/upgrade/verify-upgrade.sh     # or: npm run upgrade:verify
```

For a closer rehearsal, restore last night's backup into a throwaway database
and run steps 2–4 against it.

## 1. Back up

```bash
./scripts/db-backup.sh            # or:
docker exec approval-db pg_dump -U <user> -d <db> -Fc > backups/pre-org-upgrade-$(date +%Y%m%d-%H%M).dump
```

Keep this file until the admin has finished the follow-up in step 6.

## 2. Pre-check (old schema, read-only)

```bash
docker exec -i approval-db psql -U <user> -d <db> -X < scripts/upgrade/precheck.sql
```

- **Section 1 must be empty.** It lists open requests (any status other than
  Completed/Cancelled) that still have a pending request or solution approval.
  Finish each one (approve or reject until it reaches a terminal status) or
  cancel it. If any remain, the migration aborts (see step 4).
- Sections 2–5 are informational. They list users without a department, who
  will be unassigned. They list users with a department but no level, who
  get the lowest position. They list department approvers that cannot become
  an assignment, because the new model allows one active assignment per
  person. The last section shows the levels in use.

Announce a short freeze so no new requests are submitted between the
pre-check and the deploy.

## 3. Export `hierarchy_change_logs` (it is dropped by the upgrade)

```bash
docker exec -i approval-db psql -U <user> -d <db> -X \
  -c "\copy (SELECT h.*, d.name AS department_name, a.email AS admin_email, t.email AS target_email FROM hierarchy_change_logs h LEFT JOIN departments d ON d.id = h.\"departmentId\" LEFT JOIN users a ON a.id = h.\"adminUserId\" LEFT JOIN users t ON t.id = h.\"targetUserId\" ORDER BY h.\"createdAt\") TO STDOUT WITH (FORMAT csv, HEADER)" \
  > backups/hierarchy_change_logs-$(date +%Y%m%d).csv
```

With direct `psql` access to the database you can write the file locally:

```sql
\copy (SELECT * FROM hierarchy_change_logs ORDER BY "createdAt") TO 'hierarchy_change_logs.csv' WITH (FORMAT csv, HEADER)
```

## 4. Deploy

Deploy the release the usual way (`scripts/deploy.sh` or
`docker compose -p approval-app --env-file .env.production -f docker-compose.prod.yml up -d db migrate app`).
The `migrate` service runs `npx prisma migrate deploy`, which applies only
`20261019000000_organization_upgrade`. Do **not** run the first-install seed
profile. It is not needed, although it is harmless: `prisma/seed.ts` only
creates missing rows and never resets the admin.

The migration is a single transaction. It runs in this order:

1. Guard: abort if any approval is still pending on an open request.
2. Create the new enums, tables and columns.
3. Map the data:
   - A root unit "Company" and `company_settings` are created.
   - Each department becomes a unit under the root with the **same id**.
     `canWorkOnSolutions` is set for ENGINEERING departments, and request
     sharing is OFF.
   - Positions `Level N` (rank N) are created, one for each level in use.
   - Each active user with a department gets an assignment at their level. A
     user with no level gets the lowest position.
   - Department approvers without their own assignment get one in that unit.
   - The unit manager is the single highest-ranked person, if exactly one
     person holds that rank.
   - `requests.organizationUnitId` and `budget_codes.unitId` are set to the
     old department id.
   - Historical approval rows keep their level as `requiredPositionId`.
   - One PUBLISHED company-wide route is created per phase (REQUEST,
     SOLUTION, FINAL). Its steps are every level above the lowest, up to the
     highest.
4. Add foreign keys, partial unique indexes and CHECK constraints.
5. Drop `departments`, `department_approvers`, `hierarchy_change_logs` and the
   old columns.

The append-only audit trigger on `request_activities` is not touched.

### If the migrate container fails

The database is left unchanged, because the transaction is rolled back.
Prisma records the migration as failed, and every later deploy refuses with
P3009 until you resolve it. If the log shows `ORGANIZATION UPGRADE BLOCKED`:

1. Bring the old app version back if needed, and finish or cancel the listed
   requests (precheck section 1).
2. Mark the failed attempt as rolled back, then deploy again:

```bash
docker compose -p approval-app --env-file .env.production -f docker-compose.prod.yml \
  run --rm migrate npx prisma migrate resolve --rolled-back 20261019000000_organization_upgrade
docker compose -p approval-app --env-file .env.production -f docker-compose.prod.yml up -d db migrate app
```

For any other error, resolve it the same way and keep the backup from step 1
at hand.

## 5. Post-check

```bash
docker exec -i approval-db psql -U <user> -d <db> -X < scripts/upgrade/postcheck.sql
```

Check the following:

- `root_units = 1` and `company_settings = 1`.
- `requests_without_unit = 0`.
- `published_routes = 3`.
- Two audit triggers are listed.
- `active_assignments` matches the expected number of people.

Then log in as an admin and open **Organization & Approvals**. The readiness
banner should not report blockers. Fewer than two positions does raise one: in
that case, add a position.

## 6. Admin follow-up (same day)

1. **Unit managers.** Approval candidates come from the reporting path: the
   team reports-to person, the unit manager, then the ancestor-unit managers,
   at the exact position each route step names. The upgrade sets a manager
   only where one person clearly holds the top level. A step with nobody
   eligible is **skipped as vacant**, and if all steps are vacant the phase
   completes without an approver. For each unit, use postcheck
   `units_without_manager` and the unit list to:
   - pick the Unit manager, and
   - create teams with a reports-to person where several levels must
     approve inside one unit.
2. **Unassigned people.** Assign every person listed under "Active users
   WITHOUT an assignment", such as admins, accounts with no department, and
   external approvers who were skipped. Unassigned users cannot submit
   requests.
3. **Positions and routes.** Rename `Level N` to real titles if wanted (main's
   `departments.levelNames` held them). Review the company default routes and
   add unit exceptions where departments had different ladders.
4. **Solution work.** Only the former ENGINEERING departments have Can work
   on solutions. Set the flag on any other unit that needs it. The
   `users.role = engineering` value no longer grants solution work by itself.
5. **Request sharing** is OFF for every migrated unit. Turn it on where
   sister departments should see each other's requests.

## Rollback

There is no down migration. To roll back, restore the step 1 backup (for
example `scripts/restore.sh` or `pg_restore --clean`). Then redeploy the
previous release images (`approval-app:rollback` / `approval-migrate:rollback`).
