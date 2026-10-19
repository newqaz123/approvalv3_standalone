-- =====================================================================
-- Organization upgrade: main (departments + numeric levels) -> clean-start
-- organization model (units, positions, assignments, versioned routes).
--
-- Design: docs/superpowers/specs/2026-10-19-upgrade-migration-design.md
-- Runbook: docs/upgrade-runbook.md (backup, precheck, deploy, postcheck)
--
-- Runs as ONE transaction: prisma migrate deploy sends the file as a single
-- multi-statement script, which PostgreSQL executes atomically, so a failure
-- anywhere -- including the open-request guard below -- leaves the database
-- exactly as it was (verified by scripts/upgrade/verify-upgrade.sh, scenario
-- C). No explicit BEGIN/COMMIT on purpose: with one, Prisma reports
-- "current transaction is aborted" instead of the guard's message. Prisma then records this migration as failed;
-- after fixing the cause run
--   npx prisma migrate resolve --rolled-back 20261019000000_organization_upgrade
-- and deploy again.
--
-- Order:
--   0. Guard: abort while any approval is still pending on an open request.
--   1. New enums, tables, indexes, columns (old structures untouched).
--   2. Data mapping (only when legacy users/departments exist).
--   3. New foreign keys + raw-SQL objects Prisma cannot model.
--   4. Drop legacy FKs, indexes, columns, tables and the DepartmentType enum.
-- The append-only audit trigger on request_activities (from migrations
-- 20260207160239 / 20260303140000) is intentionally NOT touched here.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Guard (owner decision Q2): block while requests are mid-approval.
-- Terminal request statuses on main: Completed, Cancelled. Every other
-- status (ImprovementRequest, SentToEngineer, SendBackToRequester,
-- DesignCostEstimationApproval, FinalApproval) is open. Soft-deleted
-- requests are included on purpose: a pending legacy row can never be
-- decided by the new engine.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  open_request_approvals  integer;
  open_solution_approvals integer;
  open_requests           integer;
BEGIN
  SELECT count(*) INTO open_request_approvals
    FROM "request_approvals" ra
    JOIN "requests" r ON r."id" = ra."requestId"
   WHERE ra."status" = 'pending'
     AND r."status" NOT IN ('Completed', 'Cancelled');

  SELECT count(*) INTO open_solution_approvals
    FROM "solution_approvals" sa
    JOIN "solutions" s ON s."id" = sa."solutionId"
    JOIN "requests" r ON r."id" = s."requestId"
   WHERE sa."status" = 'pending'
     AND r."status" NOT IN ('Completed', 'Cancelled');

  SELECT count(DISTINCT r."id") INTO open_requests
    FROM "requests" r
   WHERE r."status" NOT IN ('Completed', 'Cancelled')
     AND (
       EXISTS (SELECT 1 FROM "request_approvals" ra
                WHERE ra."requestId" = r."id" AND ra."status" = 'pending')
       OR EXISTS (SELECT 1 FROM "solution_approvals" sa
                    JOIN "solutions" s ON s."id" = sa."solutionId"
                   WHERE s."requestId" = r."id" AND sa."status" = 'pending')
     );

  IF open_request_approvals > 0 OR open_solution_approvals > 0 THEN
    RAISE EXCEPTION
      'ORGANIZATION UPGRADE BLOCKED: % open request(s) still have pending approvals (% pending request_approvals row(s), % pending solution_approvals row(s)).',
      open_requests, open_request_approvals, open_solution_approvals
      USING HINT = 'Finish (approve/reject to a terminal status) or cancel every open request first. Run scripts/upgrade/precheck.sql to list them, then: npx prisma migrate resolve --rolled-back 20261019000000_organization_upgrade && npx prisma migrate deploy';
  END IF;
END
$$;

-- ---------------------------------------------------------------------
-- 1. New enums
-- ---------------------------------------------------------------------
CREATE TYPE "ApprovalPhase" AS ENUM ('REQUEST', 'SOLUTION', 'FINAL');
CREATE TYPE "ApprovalRouteStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'RETIRED');
CREATE TYPE "ApprovalRoutingMode" AS ENUM ('SNAPSHOT_GROUP', 'CUSTOM_PERSON');
CREATE TYPE "ApprovalInstanceState" AS ENUM ('PENDING', 'AUTO_APPROVED', 'COMPLETED_NO_ELIGIBLE_STEPS', 'APPROVED', 'REJECTED', 'CANCELLED', 'SUPERSEDED');
CREATE TYPE "ApprovalSkipReason" AS ENUM ('VACANT_POSITION');

-- ---------------------------------------------------------------------
-- 1b. New tables
-- ---------------------------------------------------------------------
CREATE TABLE "organization_units" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "shareRequests" BOOLEAN NOT NULL DEFAULT false,
    "canWorkOnSolutions" BOOLEAN NOT NULL DEFAULT false,
    "managerUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_units_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "approval_route_versions" (
    "id" TEXT NOT NULL,
    "scopeUnitId" TEXT NOT NULL,
    "phase" "ApprovalPhase" NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "ApprovalRouteStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),
    "approvalLimitPositionId" TEXT NOT NULL,

    CONSTRAINT "approval_route_versions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "approval_route_steps" (
    "id" TEXT NOT NULL,
    "routeVersionId" TEXT NOT NULL,
    "stepOrder" INTEGER NOT NULL,
    "positionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_route_steps_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "approval_instances" (
    "id" TEXT NOT NULL,
    "requestId" TEXT,
    "solutionId" TEXT,
    "phase" "ApprovalPhase" NOT NULL,
    "routeVersionId" TEXT,
    "originUserId" TEXT NOT NULL,
    "originUnitId" TEXT NOT NULL,
    "routingMode" "ApprovalRoutingMode" NOT NULL,
    "state" "ApprovalInstanceState" NOT NULL DEFAULT 'PENDING',
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "completionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersededAt" TIMESTAMP(3),
    "originAssignmentId" TEXT NOT NULL,
    "originPositionId" TEXT NOT NULL,
    "restartOfInstanceId" TEXT,
    "restartReason" TEXT,
    "restartedById" TEXT,

    CONSTRAINT "approval_instances_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "approval_instance_skips" (
    "id" TEXT NOT NULL,
    "approvalInstanceId" TEXT NOT NULL,
    "routeStepId" TEXT,
    "requiredPositionId" TEXT NOT NULL,
    "reason" "ApprovalSkipReason" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_instance_skips_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "approval_candidate_groups" (
    "id" TEXT NOT NULL,
    "approvalInstanceId" TEXT NOT NULL,
    "scopeUnitId" TEXT NOT NULL,
    "requiredPositionId" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_candidate_groups_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "approval_candidate_group_members" (
    "candidateGroupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "capturedDisplayName" TEXT NOT NULL,

    CONSTRAINT "approval_candidate_group_members_pkey" PRIMARY KEY ("candidateGroupId","userId")
);

CREATE TABLE "company_settings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "name" TEXT NOT NULL,
    "rootUnitId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_settings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "positions" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "positions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "organization_assignments" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "teamId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deactivatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_assignments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "teams" (
    "id" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "reportsToAssignmentId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- ---------------------------------------------------------------------
-- 1c. Indexes on new tables
-- ---------------------------------------------------------------------
CREATE INDEX "organization_units_parentId_idx" ON "organization_units"("parentId");
CREATE INDEX "organization_units_isActive_idx" ON "organization_units"("isActive");
CREATE INDEX "organization_units_managerUserId_idx" ON "organization_units"("managerUserId");
CREATE INDEX "approval_route_versions_scopeUnitId_phase_status_idx" ON "approval_route_versions"("scopeUnitId", "phase", "status");
CREATE INDEX "approval_route_versions_approvalLimitPositionId_idx" ON "approval_route_versions"("approvalLimitPositionId");
CREATE UNIQUE INDEX "approval_route_versions_scopeUnitId_phase_version_key" ON "approval_route_versions"("scopeUnitId", "phase", "version");
CREATE INDEX "approval_route_steps_positionId_idx" ON "approval_route_steps"("positionId");
CREATE UNIQUE INDEX "approval_route_steps_routeVersionId_stepOrder_key" ON "approval_route_steps"("routeVersionId", "stepOrder");
CREATE UNIQUE INDEX "approval_route_steps_routeVersionId_positionId_key" ON "approval_route_steps"("routeVersionId", "positionId");
CREATE INDEX "approval_instances_requestId_phase_supersededAt_idx" ON "approval_instances"("requestId", "phase", "supersededAt");
CREATE INDEX "approval_instances_solutionId_phase_supersededAt_idx" ON "approval_instances"("solutionId", "phase", "supersededAt");
CREATE INDEX "approval_instances_routeVersionId_idx" ON "approval_instances"("routeVersionId");
CREATE INDEX "approval_instances_originAssignmentId_idx" ON "approval_instances"("originAssignmentId");
CREATE INDEX "approval_instances_originPositionId_idx" ON "approval_instances"("originPositionId");
CREATE INDEX "approval_instances_restartOfInstanceId_idx" ON "approval_instances"("restartOfInstanceId");
CREATE INDEX "approval_instances_restartedById_idx" ON "approval_instances"("restartedById");
CREATE UNIQUE INDEX "approval_instances_requestId_phase_attempt_key" ON "approval_instances"("requestId", "phase", "attempt");
CREATE UNIQUE INDEX "approval_instances_solutionId_phase_attempt_key" ON "approval_instances"("solutionId", "phase", "attempt");
CREATE INDEX "approval_instance_skips_requiredPositionId_idx" ON "approval_instance_skips"("requiredPositionId");
CREATE UNIQUE INDEX "approval_instance_skips_approvalInstanceId_requiredPosition_key" ON "approval_instance_skips"("approvalInstanceId", "requiredPositionId");
CREATE INDEX "approval_candidate_groups_scopeUnitId_idx" ON "approval_candidate_groups"("scopeUnitId");
CREATE INDEX "approval_candidate_groups_requiredPositionId_idx" ON "approval_candidate_groups"("requiredPositionId");
CREATE UNIQUE INDEX "approval_candidate_groups_approvalInstanceId_requiredPositi_key" ON "approval_candidate_groups"("approvalInstanceId", "requiredPositionId");
CREATE INDEX "approval_candidate_group_members_userId_idx" ON "approval_candidate_group_members"("userId");
CREATE UNIQUE INDEX "company_settings_rootUnitId_key" ON "company_settings"("rootUnitId");
CREATE UNIQUE INDEX "positions_name_key" ON "positions"("name");
CREATE INDEX "organization_assignments_userId_idx" ON "organization_assignments"("userId");
CREATE INDEX "organization_assignments_unitId_idx" ON "organization_assignments"("unitId");
CREATE INDEX "organization_assignments_positionId_idx" ON "organization_assignments"("positionId");
CREATE INDEX "organization_assignments_teamId_idx" ON "organization_assignments"("teamId");
CREATE INDEX "teams_unitId_idx" ON "teams"("unitId");
CREATE INDEX "teams_reportsToAssignmentId_idx" ON "teams"("reportsToAssignmentId");

-- Partial unique indexes Prisma cannot express (carried over verbatim from
-- the former squashed init 00000000000001_clean_start_init). Created BEFORE
-- the data mapping so the mapped rows are checked against them.
CREATE UNIQUE INDEX one_active_assignment_per_user
  ON "organization_assignments" ("userId") WHERE "isActive";

CREATE UNIQUE INDEX one_active_company_root
  ON "organization_units" ((1)) WHERE "parentId" IS NULL AND "isActive";

CREATE UNIQUE INDEX one_published_route_per_scope_phase
  ON "approval_route_versions" ("scopeUnitId", "phase") WHERE "status" = 'PUBLISHED';

CREATE UNIQUE INDEX one_active_team_name_per_unit
  ON "teams" ("unitId", "name") WHERE "isActive";

-- ---------------------------------------------------------------------
-- 1d. New columns on existing tables (old columns still present)
-- ---------------------------------------------------------------------
ALTER TABLE "budget_codes" ADD COLUMN "unitId" TEXT;

ALTER TABLE "requests" ADD COLUMN "organizationUnitId" TEXT;

ALTER TABLE "request_approvals"
ADD COLUMN "candidateGroupId" TEXT,
ADD COLUMN "instanceId" TEXT,
ADD COLUMN "requiredPositionId" TEXT,
ADD COLUMN "routingMode" "ApprovalRoutingMode" NOT NULL DEFAULT 'SNAPSHOT_GROUP';

ALTER TABLE "solution_approvals"
ADD COLUMN "candidateGroupId" TEXT,
ADD COLUMN "instanceId" TEXT,
ADD COLUMN "requiredPositionId" TEXT,
ADD COLUMN "routingMode" "ApprovalRoutingMode" NOT NULL DEFAULT 'SNAPSHOT_GROUP';

-- ---------------------------------------------------------------------
-- 2. Data mapping. Skipped entirely on an empty database (fresh install):
--    prisma/seed.ts then bootstraps the company root, positions and admin.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_now          TIMESTAMP(3) := CURRENT_TIMESTAMP;
  v_root_id      TEXT;
  v_creator_id   TEXT;
  v_limit_id     TEXT;
  v_min_level    INTEGER;
  v_phase        "ApprovalPhase";
  v_route_id     TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "departments") AND NOT EXISTS (SELECT 1 FROM "users") THEN
    RAISE NOTICE 'organization upgrade: empty database, no legacy data to map';
    RETURN;
  END IF;

  -- 2a. Company root unit + company_settings.
  v_root_id := gen_random_uuid()::text;
  INSERT INTO "organization_units" ("id", "name", "parentId", "isActive", "shareRequests", "canWorkOnSolutions", "managerUserId", "createdAt", "updatedAt")
  VALUES (v_root_id, 'Company', NULL, true, false, false, NULL, v_now, v_now);

  INSERT INTO "company_settings" ("id", "name", "rootUnitId", "createdAt", "updatedAt")
  VALUES ('default', 'Company', v_root_id, v_now, v_now);

  -- 2b. departments -> child units of the root, SAME id (requests,
  --     budget codes and bookmarks keep pointing at the same id).
  INSERT INTO "organization_units" ("id", "name", "parentId", "isActive", "shareRequests", "canWorkOnSolutions", "managerUserId", "createdAt", "updatedAt")
  SELECT d."id", d."name", v_root_id, true, false, (d."type" = 'ENGINEERING'), NULL, d."createdAt", v_now
    FROM "departments" d;

  -- 2c. Positions: one company-wide position per level in use, named
  --     'Level N', rank N (higher = more senior; owner decision Q1).
  --     Levels in use = levels held by users, by department approvers,
  --     and recorded on historical approval rows (so history keeps a
  --     position label). If someone has a department but no level and no
  --     level exists anywhere, 'Level 1' is created for them.
  CREATE TEMP TABLE _upgrade_levels ON COMMIT DROP AS
  SELECT DISTINCT lvl AS level FROM (
    SELECT "level" AS lvl FROM "users" WHERE "level" IS NOT NULL
    UNION SELECT "approverLevel" FROM "department_approvers"
    UNION SELECT "requiredLevel" FROM "request_approvals" WHERE "requiredLevel" IS NOT NULL
    UNION SELECT "requiredLevel" FROM "solution_approvals" WHERE "requiredLevel" IS NOT NULL
  ) used;

  IF NOT EXISTS (SELECT 1 FROM _upgrade_levels)
     AND EXISTS (SELECT 1 FROM "users" WHERE "departmentId" IS NOT NULL) THEN
    INSERT INTO _upgrade_levels (level) VALUES (1);
  END IF;

  INSERT INTO "positions" ("id", "name", "rank", "isActive", "createdAt", "updatedAt")
  SELECT gen_random_uuid()::text, 'Level ' || l.level, l.level, true, v_now, v_now
    FROM _upgrade_levels l;

  SELECT min("rank") INTO v_min_level FROM "positions";

  -- 2d. Assignments from users.departmentId + users.level (ACTIVE users
  --     only -- the app never assigns inactive accounts). Department but
  --     no level -> lowest position. No department -> unassigned (listed
  --     by scripts/upgrade/postcheck.sql).
  INSERT INTO "organization_assignments" ("id", "userId", "unitId", "positionId", "teamId", "isActive", "createdAt", "updatedAt")
  SELECT gen_random_uuid()::text, u."id", u."departmentId", p."id", NULL, true, v_now, v_now
    FROM "users" u
    JOIN "positions" p ON p."rank" = COALESCE(u."level", v_min_level)
   WHERE u."departmentId" IS NOT NULL
     AND u."isActive";

  -- 2e. department_approvers -> extra assignment in that unit at Level L.
  --     The new model allows exactly ONE active assignment per person
  --     (one_active_assignment_per_user), so this only applies to active
  --     approvers who have no assignment yet; for several such rows the
  --     highest level wins (then department name). Approver rows that
  --     cannot be mapped are listed by scripts/upgrade/precheck.sql.
  INSERT INTO "organization_assignments" ("id", "userId", "unitId", "positionId", "teamId", "isActive", "createdAt", "updatedAt")
  SELECT gen_random_uuid()::text, pick."approverId", pick."departmentId", p."id", NULL, true, v_now, v_now
    FROM (
      SELECT DISTINCT ON (da."approverId") da."approverId", da."departmentId", da."approverLevel"
        FROM "department_approvers" da
        JOIN "users" u ON u."id" = da."approverId" AND u."isActive"
        JOIN "departments" d ON d."id" = da."departmentId"
       WHERE NOT EXISTS (
         SELECT 1 FROM "organization_assignments" a
          WHERE a."userId" = da."approverId" AND a."isActive"
       )
       ORDER BY da."approverId", da."approverLevel" DESC, d."name", da."departmentId"
    ) pick
    JOIN "positions" p ON p."rank" = pick."approverLevel";

  -- 2f. Unit manager: the highest-ranked active assignee of the unit, only
  --     when exactly one person holds that top rank there. Otherwise left
  --     NULL for the admin to choose.
  UPDATE "organization_units" ou
     SET "managerUserId" = top."userId", "updatedAt" = v_now
    FROM (
      SELECT a."unitId", min(a."userId") AS "userId"
        FROM "organization_assignments" a
        JOIN "positions" p ON p."id" = a."positionId"
       WHERE a."isActive"
         AND p."rank" = (
           SELECT max(p2."rank")
             FROM "organization_assignments" a2
             JOIN "positions" p2 ON p2."id" = a2."positionId"
            WHERE a2."isActive" AND a2."unitId" = a."unitId"
         )
       GROUP BY a."unitId"
      HAVING count(*) = 1
    ) top
   WHERE ou."id" = top."unitId";

  -- 2g. Requests and budget codes keep their department id as unit id.
  UPDATE "requests" SET "organizationUnitId" = "departmentId";
  UPDATE "budget_codes" SET "unitId" = "departmentId" WHERE "departmentId" IS NOT NULL;

  -- 2h. Historical approval rows: keep approver/status/comments; carry the
  --     old level as requiredPositionId (display label) and the custom
  --     chain flag as routingMode. instanceId stays NULL (legacy row; see
  --     CURRENT_INSTANCE_ROW_FILTER in src/lib/approval-engine).
  UPDATE "request_approvals" ra
     SET "requiredPositionId" = p."id"
    FROM "positions" p
   WHERE p."rank" = ra."requiredLevel";
  UPDATE "request_approvals" SET "routingMode" = 'CUSTOM_PERSON' WHERE "isCustomChain";

  UPDATE "solution_approvals" sa
     SET "requiredPositionId" = p."id"
    FROM "positions" p
   WHERE p."rank" = sa."requiredLevel";
  UPDATE "solution_approvals" SET "routingMode" = 'CUSTOM_PERSON' WHERE "isCustomChain";

  -- 2i. Default company-wide routes: one PUBLISHED version per phase at the
  --     root scope (src/lib/approval-routes/selection.ts walks own unit ->
  --     ancestors -> root, so every unit inherits them). Steps climb every
  --     position above the lowest one; the approval limit is the highest
  --     position -- mirroring main's "all levels above the submitter up to
  --     the top level; top level auto-approves" chain. Needs a creator user
  --     (oldest active admin, else oldest admin, else oldest user).
  SELECT "id" INTO v_creator_id FROM "users"
   ORDER BY ("role" = 'admin' AND "isActive") DESC, ("role" = 'admin') DESC, "createdAt", "id"
   LIMIT 1;
  SELECT "id" INTO v_limit_id FROM "positions" ORDER BY "rank" DESC LIMIT 1;

  IF v_creator_id IS NOT NULL AND v_limit_id IS NOT NULL THEN
    FOREACH v_phase IN ARRAY ARRAY['REQUEST', 'SOLUTION', 'FINAL']::"ApprovalPhase"[] LOOP
      v_route_id := gen_random_uuid()::text;
      INSERT INTO "approval_route_versions" ("id", "scopeUnitId", "phase", "version", "status", "createdById", "createdAt", "publishedAt", "approvalLimitPositionId")
      VALUES (v_route_id, v_root_id, v_phase, 1, 'PUBLISHED', v_creator_id, v_now, v_now, v_limit_id);

      INSERT INTO "approval_route_steps" ("id", "routeVersionId", "stepOrder", "positionId", "createdAt")
      SELECT gen_random_uuid()::text, v_route_id, row_number() OVER (ORDER BY p."rank"), p."id", v_now
        FROM "positions" p
       WHERE p."rank" > v_min_level
          OR NOT EXISTS (SELECT 1 FROM "positions" p2 WHERE p2."rank" > v_min_level);
    END LOOP;
  END IF;
END
$$;

-- ---------------------------------------------------------------------
-- 3. New foreign keys
-- ---------------------------------------------------------------------
ALTER TABLE "request_approvals" ADD CONSTRAINT "request_approvals_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "approval_instances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "request_approvals" ADD CONSTRAINT "request_approvals_candidateGroupId_fkey" FOREIGN KEY ("candidateGroupId") REFERENCES "approval_candidate_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "request_approvals" ADD CONSTRAINT "request_approvals_requiredPositionId_fkey" FOREIGN KEY ("requiredPositionId") REFERENCES "positions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "budget_codes" ADD CONSTRAINT "budget_codes_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "organization_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "requests" ADD CONSTRAINT "requests_organizationUnitId_fkey" FOREIGN KEY ("organizationUnitId") REFERENCES "organization_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "solution_approvals" ADD CONSTRAINT "solution_approvals_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "approval_instances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "solution_approvals" ADD CONSTRAINT "solution_approvals_candidateGroupId_fkey" FOREIGN KEY ("candidateGroupId") REFERENCES "approval_candidate_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "solution_approvals" ADD CONSTRAINT "solution_approvals_requiredPositionId_fkey" FOREIGN KEY ("requiredPositionId") REFERENCES "positions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "organization_units" ADD CONSTRAINT "organization_units_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "organization_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "organization_units" ADD CONSTRAINT "organization_units_managerUserId_fkey" FOREIGN KEY ("managerUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "approval_route_versions" ADD CONSTRAINT "approval_route_versions_scopeUnitId_fkey" FOREIGN KEY ("scopeUnitId") REFERENCES "organization_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "approval_route_versions" ADD CONSTRAINT "approval_route_versions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "approval_route_versions" ADD CONSTRAINT "approval_route_versions_approvalLimitPositionId_fkey" FOREIGN KEY ("approvalLimitPositionId") REFERENCES "positions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "approval_route_steps" ADD CONSTRAINT "approval_route_steps_routeVersionId_fkey" FOREIGN KEY ("routeVersionId") REFERENCES "approval_route_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "approval_route_steps" ADD CONSTRAINT "approval_route_steps_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "positions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "approval_instances" ADD CONSTRAINT "approval_instances_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "approval_instances" ADD CONSTRAINT "approval_instances_solutionId_fkey" FOREIGN KEY ("solutionId") REFERENCES "solutions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "approval_instances" ADD CONSTRAINT "approval_instances_routeVersionId_fkey" FOREIGN KEY ("routeVersionId") REFERENCES "approval_route_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "approval_instances" ADD CONSTRAINT "approval_instances_originUserId_fkey" FOREIGN KEY ("originUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "approval_instances" ADD CONSTRAINT "approval_instances_originUnitId_fkey" FOREIGN KEY ("originUnitId") REFERENCES "organization_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "approval_instances" ADD CONSTRAINT "approval_instances_originAssignmentId_fkey" FOREIGN KEY ("originAssignmentId") REFERENCES "organization_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "approval_instances" ADD CONSTRAINT "approval_instances_originPositionId_fkey" FOREIGN KEY ("originPositionId") REFERENCES "positions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "approval_instances" ADD CONSTRAINT "approval_instances_restartOfInstanceId_fkey" FOREIGN KEY ("restartOfInstanceId") REFERENCES "approval_instances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "approval_instances" ADD CONSTRAINT "approval_instances_restartedById_fkey" FOREIGN KEY ("restartedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "approval_instance_skips" ADD CONSTRAINT "approval_instance_skips_approvalInstanceId_fkey" FOREIGN KEY ("approvalInstanceId") REFERENCES "approval_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "approval_instance_skips" ADD CONSTRAINT "approval_instance_skips_routeStepId_fkey" FOREIGN KEY ("routeStepId") REFERENCES "approval_route_steps"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "approval_instance_skips" ADD CONSTRAINT "approval_instance_skips_requiredPositionId_fkey" FOREIGN KEY ("requiredPositionId") REFERENCES "positions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "approval_candidate_groups" ADD CONSTRAINT "approval_candidate_groups_approvalInstanceId_fkey" FOREIGN KEY ("approvalInstanceId") REFERENCES "approval_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "approval_candidate_groups" ADD CONSTRAINT "approval_candidate_groups_requiredPositionId_fkey" FOREIGN KEY ("requiredPositionId") REFERENCES "positions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "approval_candidate_group_members" ADD CONSTRAINT "approval_candidate_group_members_candidateGroupId_fkey" FOREIGN KEY ("candidateGroupId") REFERENCES "approval_candidate_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "company_settings" ADD CONSTRAINT "company_settings_rootUnitId_fkey" FOREIGN KEY ("rootUnitId") REFERENCES "organization_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "organization_assignments" ADD CONSTRAINT "organization_assignments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "organization_assignments" ADD CONSTRAINT "organization_assignments_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "organization_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "organization_assignments" ADD CONSTRAINT "organization_assignments_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "positions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "organization_assignments" ADD CONSTRAINT "organization_assignments_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "teams" ADD CONSTRAINT "teams_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "organization_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "teams" ADD CONSTRAINT "teams_reportsToAssignmentId_fkey" FOREIGN KEY ("reportsToAssignmentId") REFERENCES "organization_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------
-- 3b. CHECK constraints Prisma cannot express (carried over from the former
--     squashed init). Row-mode integrity: SNAPSHOT_GROUP rows carry
--     instance + requiredPositionId; CUSTOM_PERSON rows carry
--     requiredApproverId. Historical (pre-upgrade) approval rows have no
--     approval instance, so the row-mode CHECKs are added NOT VALID: every
--     new or updated row is checked, legacy rows are left as history. When
--     no legacy row violates them (fresh install) they are VALIDATED, which
--     makes the result identical to the former squashed init.
-- ---------------------------------------------------------------------
ALTER TABLE "request_approvals"
  ADD CONSTRAINT "request_approvals_row_mode_integrity"
  CHECK (
    ("routingMode" = 'CUSTOM_PERSON' AND "requiredApproverId" IS NOT NULL)
    OR ("routingMode" = 'SNAPSHOT_GROUP' AND "instanceId" IS NOT NULL AND "requiredPositionId" IS NOT NULL)
  ) NOT VALID;

ALTER TABLE "solution_approvals"
  ADD CONSTRAINT "solution_approvals_row_mode_integrity"
  CHECK (
    ("routingMode" = 'CUSTOM_PERSON' AND "requiredApproverId" IS NOT NULL)
    OR ("routingMode" = 'SNAPSHOT_GROUP' AND "instanceId" IS NOT NULL AND "requiredPositionId" IS NOT NULL)
  ) NOT VALID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "request_approvals"
     WHERE NOT (("routingMode" = 'CUSTOM_PERSON' AND "requiredApproverId" IS NOT NULL)
             OR ("routingMode" = 'SNAPSHOT_GROUP' AND "instanceId" IS NOT NULL AND "requiredPositionId" IS NOT NULL))
  ) THEN
    ALTER TABLE "request_approvals" VALIDATE CONSTRAINT "request_approvals_row_mode_integrity";
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "solution_approvals"
     WHERE NOT (("routingMode" = 'CUSTOM_PERSON' AND "requiredApproverId" IS NOT NULL)
             OR ("routingMode" = 'SNAPSHOT_GROUP' AND "instanceId" IS NOT NULL AND "requiredPositionId" IS NOT NULL))
  ) THEN
    ALTER TABLE "solution_approvals" VALIDATE CONSTRAINT "solution_approvals_row_mode_integrity";
  END IF;
END
$$;

ALTER TABLE "approval_instances"
  ADD CONSTRAINT "approval_instances_one_document_owner"
  CHECK (
    ("phase" = 'SOLUTION' AND "solutionId" IS NOT NULL AND "requestId" IS NULL)
    OR ("phase" IN ('REQUEST', 'FINAL') AND "requestId" IS NOT NULL AND "solutionId" IS NULL)
  );

-- main's 20260828000000 created the same exactly-one-owner CHECK under a
-- different name; align it with the clean-start name (same predicate).
ALTER TABLE "inline_description_image_references"
  RENAME CONSTRAINT "inline_image_reference_exactly_one_owner" TO "inline_description_image_references_one_owner";

-- ---------------------------------------------------------------------
-- 4. Drop legacy structures (only after the data above was mapped).
--    hierarchy_change_logs is dropped: export it first (docs/upgrade-runbook.md).
-- ---------------------------------------------------------------------
ALTER TABLE "budget_codes" DROP CONSTRAINT "budget_codes_departmentId_fkey";
ALTER TABLE "department_approvers" DROP CONSTRAINT "department_approvers_approverId_fkey";
ALTER TABLE "department_approvers" DROP CONSTRAINT "department_approvers_departmentId_fkey";
ALTER TABLE "hierarchy_change_logs" DROP CONSTRAINT "hierarchy_change_logs_adminUserId_fkey";
ALTER TABLE "hierarchy_change_logs" DROP CONSTRAINT "hierarchy_change_logs_departmentId_fkey";
ALTER TABLE "hierarchy_change_logs" DROP CONSTRAINT "hierarchy_change_logs_targetUserId_fkey";
ALTER TABLE "requests" DROP CONSTRAINT "requests_departmentId_fkey";
ALTER TABLE "users" DROP CONSTRAINT "users_departmentId_fkey";

DROP INDEX "budget_codes_departmentId_idx";
DROP INDEX "request_approvals_requiredLevel_idx";
DROP INDEX "requests_departmentId_idx";
DROP INDEX "users_departmentId_idx";
DROP INDEX "users_level_idx";

ALTER TABLE "budget_codes" DROP COLUMN "departmentId";
ALTER TABLE "request_approvals" DROP COLUMN "isCustomChain", DROP COLUMN "requiredLevel";
ALTER TABLE "requests" DROP COLUMN "departmentId";
ALTER TABLE "solution_approvals" DROP COLUMN "isCustomChain", DROP COLUMN "requiredLevel";
ALTER TABLE "users" DROP COLUMN "departmentId", DROP COLUMN "level";

DROP TABLE "department_approvers";
DROP TABLE "departments";
DROP TABLE "hierarchy_change_logs";

DROP TYPE "DepartmentType";

-- ---------------------------------------------------------------------
-- 5. New indexes on existing tables
-- ---------------------------------------------------------------------
CREATE INDEX "budget_codes_unitId_idx" ON "budget_codes"("unitId");
CREATE INDEX "request_approvals_instanceId_idx" ON "request_approvals"("instanceId");
CREATE INDEX "request_approvals_candidateGroupId_idx" ON "request_approvals"("candidateGroupId");
CREATE INDEX "request_approvals_requiredPositionId_idx" ON "request_approvals"("requiredPositionId");
CREATE INDEX "requests_organizationUnitId_idx" ON "requests"("organizationUnitId");
CREATE INDEX "solution_approvals_instanceId_idx" ON "solution_approvals"("instanceId");
CREATE INDEX "solution_approvals_candidateGroupId_idx" ON "solution_approvals"("candidateGroupId");
CREATE INDEX "solution_approvals_requiredPositionId_idx" ON "solution_approvals"("requiredPositionId");
