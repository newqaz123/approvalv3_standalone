# Legacy upgrade: departments → organization model

Use this procedure only for an existing departments database with
`20261019000000_organization_upgrade` still pending. This is not a first
installation or the routine procedure for a database already using organization
units. Read the [production deployment guide](../DEPLOY.md) first.

Run production commands as an authorized deployment administrator with
effective UID 0 and a trusted administrator `PATH`. Use a trusted checkout or
extracted package. For an online upgrade, use the production `main` checkout for
the coordinator, with Git access and any required trust scoped to that exact
checkout. If the legacy checkout does not have the unified coordinator, use the
approved offline archive rather than copying scripts across releases.

Record the full commit SHA of the approved, rehearsed release. For online
preparation, run the SQL and backup script from a clean, trusted release source
checkout whose `git rev-parse HEAD` equals that SHA, not from an older production
checkout. Confirm with the release owner that the `origin/main` hold in step 4
can be enforced; otherwise prepare and deploy from the approved offline archive.
Preserve the existing `.env.production`, PostgreSQL and uploads volumes, and
`backups/`.

**Offline preparation:** From the extracted package root, read `VERSION` as
text and verify that it identifies the approved release. Run the block below
before using any packaged SQL or scripts. Stop if it fails. The stock checksum
verifier only checks listed paths; this block first requires the three upgrade
artifacts and the backup script, each with its exact manifest path. Checksums
detect corruption, not package provenance.

```bash
(
  set -eu
  for path in docs/upgrade-runbook.md scripts/upgrade/precheck.sql \
              scripts/upgrade/postcheck.sql scripts/backup.sh; do
    if [ ! -f "$path" ]; then
      printf 'Stop: missing package file: %s\n' "$path" >&2
      exit 1
    fi
    if ! LC_ALL=C awk -v path="$path" '
      length($1) == 64 && $1 !~ /[^a-fA-F0-9]/ &&
        substr($0, 65, 2) ~ /^ [ *]$/ && substr($0, 67) == path { found = 1; exit }
      END { exit !found }
    ' SHA256SUMS; then
      printf 'Stop: no exact checksum entry for: %s\n' "$path" >&2
      exit 1
    fi
  done
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum -c SHA256SUMS
  else
    shasum -a 256 -c SHA256SUMS
  fi
)
```

These production examples assume the Compose project `approval-app` with
container `approval-db`. Set and export `POSTGRES_USER` and `POSTGRES_DB` in the
operator shell to the values from the existing production configuration. Confirm
you are checking the intended database. Do not print credentials or copy them
into the change record.

## 1. Confirm migration state and rehearse

Compare the live schema and Prisma migration history to the approved release:

```bash
docker exec -i -e 'PGOPTIONS=-c default_transaction_read_only=on' approval-db \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -X -v ON_ERROR_STOP=1 <<'SQL'
SELECT to_regclass('public.departments') AS departments,
       to_regclass('public.organization_units') AS organization_units;
SELECT migration_name, started_at, finished_at, rolled_back_at
FROM public._prisma_migrations ORDER BY started_at;
SQL
```

- **Pending on the legacy schema:** `departments` exists, `organization_units`
  does not, the legacy migration history matches the expected baseline, and
  there is neither a successful organization-upgrade record nor an unresolved
  failure. Continue below only when those facts agree.
- **Already applied:** a finished, non-rolled-back organization-upgrade record
  agrees with the organization schema. Use the routine production guide, not the
  legacy precheck or export. A later failed migration still requires diagnosis.
- **Failed or unclear:** an unfinished, non-rolled-back attempt, drift between
  history and schema, or a missing or unreadable history requires investigation.
  Stop; do not rerun or mark a migration resolved based on this runbook.

**Source-checkout rehearsal only:** With dependencies and PostgreSQL binaries
installed, run `bash scripts/upgrade/verify-upgrade.sh` (or
`npm run upgrade:verify`) in the release source checkout. It runs fresh, legacy,
and blocked-upgrade scenarios on a disposable cluster; it is not shipped in the
archive. Before production, rehearse the upgrade and restore plan against an
isolated, protected copy in staging, including approval routing and attachments.

## 2. Freeze writes and run the legacy precheck

Schedule a maintenance window. Finish or cancel blocking requests in the legacy
app before the freeze. Then block user traffic and pause background jobs and other
writers while leaving the existing app and database containers available to the
coordinator. Keep the freeze in place through sign-off. After the freeze starts,
reconfirm migration state and run the read-only [precheck SQL](../scripts/upgrade/precheck.sql):

```bash
docker exec -i -e 'PGOPTIONS=-c default_transaction_read_only=on' approval-db \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -X -v ON_ERROR_STOP=1 \
  < scripts/upgrade/precheck.sql
```

**Section 1 must return zero rows.** It lists open requests with pending request
or solution approvals. If any remain, stop the upgrade; have the owners finish
or cancel them on the legacy system in a controlled window, then reestablish the
freeze and repeat the precheck. A SQL error is also a stop. Review sections 2–5
for the expected assignment and position mapping, and record the hierarchy-log
row count from section 6.

## 3. Back up and export hierarchy history

While frozen, use the [canonical backup script](../scripts/backup.sh) from the
release checkout or package:

```bash
umask 077
bash scripts/backup.sh
```

Require a nonzero-size PostgreSQL dump and uploads archive at the reported
`DB_BACKUP_PATH` and `UPLOADS_BACKUP_PATH`. Recompute each SHA-256 digest and
compare it to `DB_BACKUP_SHA256` and `UPLOADS_BACKUP_SHA256` respectively. Stop if
either artifact is missing, empty, or mismatched. Record both paths and hashes,
copy both to separate protected storage, and verify the copies. Keep this pair
and the previous release available for recovery. The coordinator also makes and
verifies its own backup before updating services.

Export `hierarchy_change_logs` before deploying; the migration drops the table.
Use a restricted destination because the export can include names and email
addresses:

```bash
history_csv="backups/hierarchy_change_logs-$(date -u +%Y%m%dT%H%M%SZ).csv"
docker exec -i -e 'PGOPTIONS=-c default_transaction_read_only=on' approval-db \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -X -v ON_ERROR_STOP=1 \
  -c '\copy (SELECT h.*, d.name AS department_name, a.email AS admin_email, t.email AS target_email FROM hierarchy_change_logs h LEFT JOIN departments d ON d.id = h."departmentId" LEFT JOIN users a ON a.id = h."adminUserId" LEFT JOIN users t ON t.id = h."targetUserId" ORDER BY h."createdAt") TO STDOUT WITH (FORMAT csv, HEADER)' \
  > "$history_csv"
```

Require a successful export, a readable CSV with a header, and the expected
number of data records from precheck section 6. Store it with the protected
backup pair. Stop if it cannot be verified.

## 4. Deploy the approved release

Use the [deployment coordinator](../scripts/deploy.sh). Do not bypass it by
starting Compose services manually.

**Online:** Have the release owner enforce a hold on all updates to
`origin/main`, including automated updates, before the SHA check below. Keep
it in place through the coordinator's source acquisition (keep the hold until
it exits if you cannot observe acquisition). Keep other operators and jobs from
changing the production checkout in that interval. The coordinator fetches and
pulls again, so a matching preflight SHA alone is not a pin. If the hold cannot
be guaranteed, use the approved offline archive instead.

In the clean production `main` checkout, set and export `APPROVED_SHA` to the
full SHA from the approved change record, not from Git's current output. While
holding the release, run this block immediately before acquisition; it compares
freshly fetched `main` (not a cached remote-tracking ref) and checks that the
checkout can fast-forward to it before invoking the coordinator:

```bash
(
  set -eu
  : "${APPROVED_SHA:?Set APPROVED_SHA to the full approved release SHA}"
  git fetch origin main
  fetched_sha=$(git rev-parse --verify 'FETCH_HEAD^{commit}')
  if [ "$fetched_sha" != "$APPROVED_SHA" ]; then
    printf 'Stop: origin/main is %s; approved SHA is %s.\n' "$fetched_sha" "$APPROVED_SHA" >&2
    exit 1
  fi
  if ! git merge-base --is-ancestor HEAD "$APPROVED_SHA"; then
    printf 'Stop: production HEAD cannot fast-forward to the approved SHA.\n' >&2
    exit 1
  fi
  DEPLOY_ROOT="$PWD" bash scripts/deploy.sh --online
)
```

**Offline:** Run `bash scripts/deploy.sh --offline .` from the approved extracted
package, using its own coordinator. If switching from online, first validate the
archive as described above; keep the maintenance freeze and verify that the
archive is for the same rehearsed release. Do not substitute an unapproved SHA
or rerun the online command just because `main` moved.

The coordinator starts only `db migrate app`. Prisma applies **all pending
migrations in order**, including `20261019000000_organization_upgrade` and any
later migrations in the release. Do not run the first-install seed during an
update. The organization migration maps departments to units (keeping IDs),
levels to positions, and eligible users to active assignments. It preserves
historical approval references, creates default routes when it has a creator
and positions, and drops the old hierarchy tables.

If the migration or any other deployment check fails, keep the freeze and go to
[recovery and rollback](#recovery-and-rollback). Do not run the deploy again as
an experiment.

## 5. Postcheck and sign off before reopening

Once the coordinator succeeds, confirm that the applied migration history
matches the approved release. Run the read-only [postcheck SQL](../scripts/upgrade/postcheck.sql)
from the release directory while normal traffic is still blocked:

```bash
docker exec -i -e 'PGOPTIONS=-c default_transaction_read_only=on' approval-db \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -X -v ON_ERROR_STOP=1 \
  < scripts/upgrade/postcheck.sql
```

Expect `root_units = 1`, `company_settings = 1`, `requests_without_unit = 0`,
and two audit triggers. Compare units and `active_assignments` to the expected
mapping. Expect a published company default for each of REQUEST, SOLUTION, and
FINAL when the legacy data supports it; investigate missing or unexpected
routes rather than opening the system without them.

In **Organization & Approvals**, have the organization admin and workflow owner
review and sign off:

1. **Managers and teams:** the migration sets a unit manager only if exactly
   one active assignee holds its highest rank. Review `units_without_manager`,
   choose managers, and configure teams and their reports-to assignments.
2. **Assignments:** reconcile active users who have no assignment and the legacy
   approvers that could not be mapped. Confirm each expected requester and
   approver has the correct active unit and position.
3. **Routes:** verify REQUEST, SOLUTION, and FINAL routes and any unit exceptions.
   Test representative requesters and approvers: candidates must hold the exact
   required position on the reporting path or in the requester's team. A vacant
   step can be skipped and an entirely vacant phase can complete automatically;
   confirm any such outcome is intended. Resolve readiness blockers, including
   missing positions or routes, before reopening.
4. **Access and data:** confirm users can sign in, historical requests and sample
   attachments still open with the intended permissions, and solution-work and
   request-sharing settings match policy (migrated units start with sharing off).

Keep traffic frozen until these checks and any controlled corrections are
signed off. Record the release, backup pair and history export, and sign-off
before reopening traffic and re-enabling jobs.

## Recovery and rollback

On failure keep the maintenance freeze. Preserve migration logs, recorded
state, the pre-upgrade artifacts, and the previous images. Diagnose the actual
migration history and schema before choosing a forward fix or a restore. The
organization migration is transactional, but Prisma can record a failed
attempt and any other pending migration may have run. Do not use a generic
`migrate resolve` or retry; require a separately reviewed recovery plan for the
specific failure and verify its assumptions in staging.

There is no down migration. Do not use app-only rollback after an incompatible
schema change, or while compatibility is uncertain. To return to the previous
release after an incompatible upgrade, restore the verified pre-upgrade database
**and** uploads pair to the existing volumes under the approved restore plan,
and run the matching previous release. The [packaged restore script](../scripts/restore.sh)
is destructive and can restart the app; rehearse the sequence with the previous
images and keep all writers isolated. For disconnected recovery, stage and verify
any required local images or approved restore tooling in advance (the uploads
restore helper uses `alpine:latest`, which is not bundled). Confirm the restored
migration history, data, attachments, and app health before reopening traffic.
