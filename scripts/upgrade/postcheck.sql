-- Organization upgrade POST-CHECK. Read-only. Run right after
-- `prisma migrate deploy` applied 20261019000000_organization_upgrade:
--
--   psql "$DATABASE_URL" -X -f scripts/upgrade/postcheck.sql
--   (docker) docker exec -i approval-db psql -U <user> -d <db> -X < scripts/upgrade/postcheck.sql
\pset footer on
\pset null '(null)'

\echo '== Summary counts'
SELECT
  (SELECT count(*) FROM "organization_units")                                   AS units,
  (SELECT count(*) FROM "organization_units" WHERE "parentId" IS NULL)          AS root_units,
  (SELECT count(*) FROM "company_settings")                                     AS company_settings,
  (SELECT count(*) FROM "positions")                                            AS positions,
  (SELECT count(*) FROM "organization_assignments" WHERE "isActive")            AS active_assignments,
  (SELECT count(*) FROM "users" u WHERE u."isActive" AND NOT EXISTS (
     SELECT 1 FROM "organization_assignments" a
      WHERE a."userId" = u."id" AND a."isActive"))                              AS active_users_without_assignment,
  (SELECT count(*) FROM "requests" WHERE "organizationUnitId" IS NULL)          AS requests_without_unit,
  (SELECT count(*) FROM "approval_route_versions" WHERE "status" = 'PUBLISHED') AS published_routes,
  (SELECT count(*) FROM "organization_units" WHERE "isActive" AND "parentId" IS NOT NULL
     AND "managerUserId" IS NULL)                                               AS units_without_manager;

\echo '== Units (id = old department id), manager and people'
SELECT ou."id", ou."name", (ou."parentId" IS NULL) AS is_root, ou."canWorkOnSolutions",
       ou."shareRequests", m."email" AS manager,
       (SELECT count(*) FROM "organization_assignments" a
         WHERE a."unitId" = ou."id" AND a."isActive") AS people
  FROM "organization_units" ou
  LEFT JOIN "users" m ON m."id" = ou."managerUserId"
 ORDER BY (ou."parentId" IS NOT NULL), ou."name";

\echo '== Positions'
SELECT p."name", p."rank", p."isActive",
       (SELECT count(*) FROM "organization_assignments" a
         WHERE a."positionId" = p."id" AND a."isActive") AS people
  FROM "positions" p
 ORDER BY p."rank";

\echo '== Published routes (company default per phase) and steps'
SELECT r."phase", r."version", su."name" AS scope, lp."name" AS approval_limit,
       string_agg(p."name", ' > ' ORDER BY s."stepOrder") AS steps
  FROM "approval_route_versions" r
  JOIN "organization_units" su ON su."id" = r."scopeUnitId"
  JOIN "positions" lp ON lp."id" = r."approvalLimitPositionId"
  LEFT JOIN "approval_route_steps" s ON s."routeVersionId" = r."id"
  LEFT JOIN "positions" p ON p."id" = s."positionId"
 WHERE r."status" = 'PUBLISHED'
 GROUP BY r."id", r."phase", r."version", su."name", lp."name"
 ORDER BY r."phase";

\echo '== Active users WITHOUT an assignment (assign them in Organization & Approvals)'
SELECT u."id", u."email", u."name", u."role"
  FROM "users" u
 WHERE u."isActive"
   AND NOT EXISTS (SELECT 1 FROM "organization_assignments" a
                    WHERE a."userId" = u."id" AND a."isActive")
 ORDER BY u."email";

\echo '== Requests without a unit (should be 0)'
SELECT r."id", r."title", r."status" FROM "requests" r WHERE r."organizationUnitId" IS NULL;

\echo '== Audit trail protection (expect 2 triggers)'
SELECT tgname FROM pg_trigger
 WHERE tgrelid = 'request_activities'::regclass AND NOT tgisinternal
 ORDER BY tgname;
