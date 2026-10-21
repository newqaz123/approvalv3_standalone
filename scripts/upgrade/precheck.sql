-- Organization upgrade PRE-CHECK. Read-only. Run against the PRODUCTION
-- database BEFORE deploying the release that contains migration
-- 20261019000000_organization_upgrade (the database is still on main's
-- department model):
--
--   psql "$DATABASE_URL" -X -f scripts/upgrade/precheck.sql
--   (docker) docker exec -i approval-db psql -U <user> -d <db> -X < scripts/upgrade/precheck.sql
--
-- Section 1 MUST be empty or the migration aborts (owner decision Q2).
-- Sections 2-5 are informational: they tell the admin what to fix in the
-- Organization & Approvals workspace after the upgrade.
\pset footer on
\pset null '(null)'

\echo '== 1. BLOCKING: open requests with pending approvals (finish or cancel each one first)'
SELECT r."id", r."title", r."status", r."isDeleted", u."email" AS requester,
       (SELECT count(*) FROM "request_approvals" ra
         WHERE ra."requestId" = r."id" AND ra."status" = 'pending') AS pending_request_approvals,
       (SELECT count(*) FROM "solution_approvals" sa
          JOIN "solutions" s ON s."id" = sa."solutionId"
         WHERE s."requestId" = r."id" AND sa."status" = 'pending') AS pending_solution_approvals
  FROM "requests" r
  JOIN "users" u ON u."id" = r."requesterId"
 WHERE r."status" NOT IN ('Completed', 'Cancelled')
   AND (EXISTS (SELECT 1 FROM "request_approvals" ra
                 WHERE ra."requestId" = r."id" AND ra."status" = 'pending')
        OR EXISTS (SELECT 1 FROM "solution_approvals" sa
                     JOIN "solutions" s ON s."id" = sa."solutionId"
                    WHERE s."requestId" = r."id" AND sa."status" = 'pending'))
 ORDER BY r."createdAt";

\echo '== 2. Active users WITHOUT a department (will be unassigned; admin assigns them after the upgrade)'
SELECT u."id", u."email", u."name", u."role"
  FROM "users" u
 WHERE u."departmentId" IS NULL AND u."isActive"
 ORDER BY u."email";

\echo '== 3. Active users with a department but NO level (will get the lowest position)'
SELECT u."id", u."email", u."name", d."name" AS department
  FROM "users" u
  JOIN "departments" d ON d."id" = u."departmentId"
 WHERE u."level" IS NULL AND u."isActive"
 ORDER BY d."name", u."email";

\echo '== 4. Department approvers that will NOT become an assignment (one active assignment per person)'
SELECT da."id", u."email" AS approver, d."name" AS department, da."approverLevel",
       CASE
         WHEN NOT u."isActive" THEN 'approver inactive'
         WHEN u."departmentId" IS NOT NULL THEN 'approver already assigned to own department'
         ELSE 'approver has a higher-level / earlier approver row that wins'
       END AS reason
  FROM "department_approvers" da
  JOIN "users" u ON u."id" = da."approverId"
  JOIN "departments" d ON d."id" = da."departmentId"
 WHERE NOT u."isActive"
    OR u."departmentId" IS NOT NULL
    OR da."id" <> (
         SELECT da2."id" FROM "department_approvers" da2
           JOIN "departments" d2 ON d2."id" = da2."departmentId"
          WHERE da2."approverId" = da."approverId"
          ORDER BY da2."approverLevel" DESC, d2."name", da2."departmentId"
          LIMIT 1)
 ORDER BY u."email", da."approverLevel" DESC;

\echo '== 5. Levels in use (become positions "Level N") and people per department/level'
SELECT d."name" AS department, d."type", u."level", count(*) AS active_users
  FROM "users" u
  JOIN "departments" d ON d."id" = u."departmentId"
 WHERE u."isActive"
 GROUP BY d."name", d."type", u."level"
 ORDER BY d."name", u."level" NULLS FIRST;

\echo '== 6. hierarchy_change_logs rows (dropped by the upgrade; export them first, see docs/upgrade-runbook.md)'
SELECT count(*) AS hierarchy_change_logs FROM "hierarchy_change_logs";
