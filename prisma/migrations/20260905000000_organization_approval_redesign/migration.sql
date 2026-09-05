-- Additive organization, route, and approval-instance schema for the
-- organization approval redesign, plus the explicit legacy routing
-- discriminator.
--
-- The DDL portion below was generated offline with:
--   npx prisma migrate diff \
--     --from-schema-datamodel <base prisma/schema.prisma> \
--     --to-schema-datamodel prisma/schema.prisma \
--     --script
-- and is followed by the compatibility operations Prisma cannot express.
--
-- Applying this migration is a controlled release operation; this task must
-- not execute it against any database. It creates no organization units,
-- assigns no positions, maps no departments, and reinterprets no legacy
-- levels: existing numeric fields and rows remain unchanged except for the
-- custom discriminator initialization below.

-- CreateEnum
CREATE TYPE "OrganizationUnitType" AS ENUM ('FACTORY', 'DIVISION', 'DEPARTMENT', 'SECTION');

-- CreateEnum
CREATE TYPE "OrganizationPositionCode" AS ENUM ('STAFF', 'SUPERVISOR', 'SECTION_MANAGER', 'DEPARTMENT_MANAGER', 'DIVISION_MANAGER', 'FACTORY_MANAGER');

-- CreateEnum
CREATE TYPE "ApprovalPhase" AS ENUM ('REQUEST', 'SOLUTION', 'FINAL');

-- CreateEnum
CREATE TYPE "ApprovalRouteStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'RETIRED');

-- CreateEnum
CREATE TYPE "ApprovalRoutingMode" AS ENUM ('LEGACY_LEVEL', 'SNAPSHOT_GROUP', 'CUSTOM_PERSON');

-- CreateEnum
CREATE TYPE "ApprovalInstanceState" AS ENUM ('PENDING', 'AUTO_APPROVED', 'COMPLETED_NO_ELIGIBLE_STEPS', 'APPROVED', 'REJECTED', 'CANCELLED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "ApprovalSkipReason" AS ENUM ('VACANT_POSITION');

-- AlterTable
ALTER TABLE "request_approvals" ADD COLUMN     "candidateGroupId" TEXT,
ADD COLUMN     "instanceId" TEXT,
ADD COLUMN     "requiredPosition" "OrganizationPositionCode",
ADD COLUMN     "routingMode" "ApprovalRoutingMode" NOT NULL DEFAULT 'LEGACY_LEVEL',
ALTER COLUMN "requiredLevel" DROP NOT NULL;

-- AlterTable
ALTER TABLE "requests" ADD COLUMN     "organizationUnitId" TEXT,
ALTER COLUMN "departmentId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "solution_approvals" ADD COLUMN     "candidateGroupId" TEXT,
ADD COLUMN     "instanceId" TEXT,
ADD COLUMN     "requiredPosition" "OrganizationPositionCode",
ADD COLUMN     "routingMode" "ApprovalRoutingMode" NOT NULL DEFAULT 'LEGACY_LEVEL';

-- CreateTable
CREATE TABLE "organization_units" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unitType" "OrganizationUnitType" NOT NULL,
    "parentId" TEXT,
    "legacyDepartmentId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "operationalType" "DepartmentType" NOT NULL DEFAULT 'GENERAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_position_assignments" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "positionCode" "OrganizationPositionCode" NOT NULL,
    "reportingGroupId" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_position_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reporting_groups" (
    "id" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "parentGroupId" TEXT,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reporting_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reporting_group_members" (
    "reportingGroupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reporting_group_members_pkey" PRIMARY KEY ("reportingGroupId","userId")
);

-- CreateTable
CREATE TABLE "approval_route_versions" (
    "id" TEXT NOT NULL,
    "scopeUnitId" TEXT NOT NULL,
    "phase" "ApprovalPhase" NOT NULL,
    "version" INTEGER NOT NULL,
    "maximumPositionLevel" INTEGER NOT NULL,
    "status" "ApprovalRouteStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "approval_route_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_route_steps" (
    "id" TEXT NOT NULL,
    "routeVersionId" TEXT NOT NULL,
    "stepOrder" INTEGER NOT NULL,
    "positionCode" "OrganizationPositionCode" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_route_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_instances" (
    "id" TEXT NOT NULL,
    "requestId" TEXT,
    "solutionId" TEXT,
    "phase" "ApprovalPhase" NOT NULL,
    "routeVersionId" TEXT,
    "originUserId" TEXT NOT NULL,
    "originUnitId" TEXT NOT NULL,
    "originContext" JSONB NOT NULL,
    "routingMode" "ApprovalRoutingMode" NOT NULL,
    "state" "ApprovalInstanceState" NOT NULL DEFAULT 'PENDING',
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "completionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersededAt" TIMESTAMP(3),

    CONSTRAINT "approval_instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_instance_skips" (
    "id" TEXT NOT NULL,
    "approvalInstanceId" TEXT NOT NULL,
    "routeStepId" TEXT,
    "requiredPosition" "OrganizationPositionCode" NOT NULL,
    "reason" "ApprovalSkipReason" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_instance_skips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_candidate_groups" (
    "id" TEXT NOT NULL,
    "approvalInstanceId" TEXT NOT NULL,
    "requiredPosition" "OrganizationPositionCode" NOT NULL,
    "scopeUnitId" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_candidate_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_candidate_group_members" (
    "candidateGroupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "capturedDisplayName" TEXT NOT NULL,

    CONSTRAINT "approval_candidate_group_members_pkey" PRIMARY KEY ("candidateGroupId","userId")
);

-- CreateTable
CREATE TABLE "organization_import_runs" (
    "id" TEXT NOT NULL,
    "mappingDigest" TEXT NOT NULL,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedBy" TEXT NOT NULL,
    "targetIdentity" TEXT NOT NULL,
    "counts" JSONB NOT NULL,

    CONSTRAINT "organization_import_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organization_units_legacyDepartmentId_key" ON "organization_units"("legacyDepartmentId");

-- CreateIndex
CREATE INDEX "organization_units_parentId_idx" ON "organization_units"("parentId");

-- CreateIndex
CREATE INDEX "organization_units_unitType_isActive_idx" ON "organization_units"("unitType", "isActive");

-- CreateIndex
CREATE INDEX "organization_position_assignments_unitId_positionCode_isAct_idx" ON "organization_position_assignments"("unitId", "positionCode", "isActive");

-- CreateIndex
CREATE INDEX "organization_position_assignments_userId_isPrimary_isActive_idx" ON "organization_position_assignments"("userId", "isPrimary", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "organization_position_assignments_userId_unitId_positionCod_key" ON "organization_position_assignments"("userId", "unitId", "positionCode");

-- CreateIndex
CREATE INDEX "reporting_groups_parentGroupId_idx" ON "reporting_groups"("parentGroupId");

-- CreateIndex
CREATE UNIQUE INDEX "reporting_groups_unitId_name_key" ON "reporting_groups"("unitId", "name");

-- CreateIndex
CREATE INDEX "reporting_group_members_userId_idx" ON "reporting_group_members"("userId");

-- CreateIndex
CREATE INDEX "approval_route_versions_scopeUnitId_phase_status_idx" ON "approval_route_versions"("scopeUnitId", "phase", "status");

-- CreateIndex
CREATE UNIQUE INDEX "approval_route_versions_scopeUnitId_phase_version_key" ON "approval_route_versions"("scopeUnitId", "phase", "version");

-- CreateIndex
CREATE UNIQUE INDEX "approval_route_steps_routeVersionId_stepOrder_key" ON "approval_route_steps"("routeVersionId", "stepOrder");

-- CreateIndex
CREATE UNIQUE INDEX "approval_route_steps_routeVersionId_positionCode_key" ON "approval_route_steps"("routeVersionId", "positionCode");

-- CreateIndex
CREATE INDEX "approval_instances_requestId_phase_supersededAt_idx" ON "approval_instances"("requestId", "phase", "supersededAt");

-- CreateIndex
CREATE INDEX "approval_instances_solutionId_phase_supersededAt_idx" ON "approval_instances"("solutionId", "phase", "supersededAt");

-- CreateIndex
CREATE INDEX "approval_instances_routeVersionId_idx" ON "approval_instances"("routeVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "approval_instances_requestId_phase_attempt_key" ON "approval_instances"("requestId", "phase", "attempt");

-- CreateIndex
CREATE UNIQUE INDEX "approval_instances_solutionId_phase_attempt_key" ON "approval_instances"("solutionId", "phase", "attempt");

-- CreateIndex
CREATE UNIQUE INDEX "approval_instance_skips_approvalInstanceId_requiredPosition_key" ON "approval_instance_skips"("approvalInstanceId", "requiredPosition");

-- CreateIndex
CREATE INDEX "approval_candidate_groups_scopeUnitId_idx" ON "approval_candidate_groups"("scopeUnitId");

-- CreateIndex
CREATE UNIQUE INDEX "approval_candidate_groups_approvalInstanceId_requiredPositi_key" ON "approval_candidate_groups"("approvalInstanceId", "requiredPosition");

-- CreateIndex
CREATE INDEX "approval_candidate_group_members_userId_idx" ON "approval_candidate_group_members"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "organization_import_runs_mappingDigest_key" ON "organization_import_runs"("mappingDigest");

-- CreateIndex
CREATE INDEX "request_approvals_instanceId_idx" ON "request_approvals"("instanceId");

-- CreateIndex
CREATE INDEX "request_approvals_candidateGroupId_idx" ON "request_approvals"("candidateGroupId");

-- CreateIndex
CREATE INDEX "requests_organizationUnitId_idx" ON "requests"("organizationUnitId");

-- CreateIndex
CREATE INDEX "solution_approvals_instanceId_idx" ON "solution_approvals"("instanceId");

-- CreateIndex
CREATE INDEX "solution_approvals_candidateGroupId_idx" ON "solution_approvals"("candidateGroupId");

-- AddForeignKey
ALTER TABLE "request_approvals" ADD CONSTRAINT "request_approvals_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "approval_instances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_approvals" ADD CONSTRAINT "request_approvals_candidateGroupId_fkey" FOREIGN KEY ("candidateGroupId") REFERENCES "approval_candidate_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requests" ADD CONSTRAINT "requests_organizationUnitId_fkey" FOREIGN KEY ("organizationUnitId") REFERENCES "organization_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solution_approvals" ADD CONSTRAINT "solution_approvals_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "approval_instances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solution_approvals" ADD CONSTRAINT "solution_approvals_candidateGroupId_fkey" FOREIGN KEY ("candidateGroupId") REFERENCES "approval_candidate_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_units" ADD CONSTRAINT "organization_units_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "organization_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_units" ADD CONSTRAINT "organization_units_legacyDepartmentId_fkey" FOREIGN KEY ("legacyDepartmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_position_assignments" ADD CONSTRAINT "organization_position_assignments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_position_assignments" ADD CONSTRAINT "organization_position_assignments_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "organization_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_position_assignments" ADD CONSTRAINT "organization_position_assignments_reportingGroupId_fkey" FOREIGN KEY ("reportingGroupId") REFERENCES "reporting_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reporting_groups" ADD CONSTRAINT "reporting_groups_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "organization_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reporting_groups" ADD CONSTRAINT "reporting_groups_parentGroupId_fkey" FOREIGN KEY ("parentGroupId") REFERENCES "reporting_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reporting_group_members" ADD CONSTRAINT "reporting_group_members_reportingGroupId_fkey" FOREIGN KEY ("reportingGroupId") REFERENCES "reporting_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reporting_group_members" ADD CONSTRAINT "reporting_group_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_route_versions" ADD CONSTRAINT "approval_route_versions_scopeUnitId_fkey" FOREIGN KEY ("scopeUnitId") REFERENCES "organization_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_route_versions" ADD CONSTRAINT "approval_route_versions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_route_steps" ADD CONSTRAINT "approval_route_steps_routeVersionId_fkey" FOREIGN KEY ("routeVersionId") REFERENCES "approval_route_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_instances" ADD CONSTRAINT "approval_instances_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_instances" ADD CONSTRAINT "approval_instances_solutionId_fkey" FOREIGN KEY ("solutionId") REFERENCES "solutions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_instances" ADD CONSTRAINT "approval_instances_routeVersionId_fkey" FOREIGN KEY ("routeVersionId") REFERENCES "approval_route_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_instances" ADD CONSTRAINT "approval_instances_originUserId_fkey" FOREIGN KEY ("originUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_instances" ADD CONSTRAINT "approval_instances_originUnitId_fkey" FOREIGN KEY ("originUnitId") REFERENCES "organization_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_instance_skips" ADD CONSTRAINT "approval_instance_skips_approvalInstanceId_fkey" FOREIGN KEY ("approvalInstanceId") REFERENCES "approval_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_instance_skips" ADD CONSTRAINT "approval_instance_skips_routeStepId_fkey" FOREIGN KEY ("routeStepId") REFERENCES "approval_route_steps"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_candidate_groups" ADD CONSTRAINT "approval_candidate_groups_approvalInstanceId_fkey" FOREIGN KEY ("approvalInstanceId") REFERENCES "approval_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_candidate_group_members" ADD CONSTRAINT "approval_candidate_group_members_candidateGroupId_fkey" FOREIGN KEY ("candidateGroupId") REFERENCES "approval_candidate_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ------------------------------------------------------------------
-- Compatibility operations (Prisma cannot express these).
-- ------------------------------------------------------------------

-- The generated DDL has already added both routingMode columns with
-- NOT NULL DEFAULT 'LEGACY_LEVEL'. Existing rows remain legacy by default.
UPDATE "request_approvals"
SET "routingMode" = 'CUSTOM_PERSON'
WHERE "isCustomChain" = true;

UPDATE "solution_approvals"
SET "routingMode" = 'CUSTOM_PERSON'
WHERE "isCustomChain" = true;

CREATE UNIQUE INDEX "approval_routes_one_published_scope_phase"
  ON "approval_route_versions" ("scopeUnitId", "phase")
  WHERE "status" = 'PUBLISHED';

CREATE UNIQUE INDEX "organization_assignments_one_active_primary"
  ON "organization_position_assignments" ("userId")
  WHERE "isPrimary" = true AND "isActive" = true;

CREATE UNIQUE INDEX "approval_instances_current_request_phase"
  ON "approval_instances" ("requestId", "phase")
  WHERE "requestId" IS NOT NULL AND "supersededAt" IS NULL;

CREATE UNIQUE INDEX "approval_instances_current_solution_phase"
  ON "approval_instances" ("solutionId", "phase")
  WHERE "solutionId" IS NOT NULL AND "supersededAt" IS NULL;

ALTER TABLE "approval_instances"
  ADD CONSTRAINT "approval_instances_one_document_owner"
  CHECK (
    ("phase" = 'SOLUTION' AND "solutionId" IS NOT NULL AND "requestId" IS NULL)
    OR ("phase" IN ('REQUEST', 'FINAL') AND "requestId" IS NOT NULL AND "solutionId" IS NULL)
  );

-- NEW parent-unit-owned requests may omit the legacy department, but every
-- request must keep exactly one present origin owner. Existing rows all keep
-- their original non-null legacy department.
ALTER TABLE "requests"
  ADD CONSTRAINT "requests_one_origin_owner"
  CHECK ("departmentId" IS NOT NULL OR "organizationUnitId" IS NOT NULL);

-- Row-mode integrity: the routing discriminator must agree with the row
-- metadata. Snapshot rows are linked to their instance and required position;
-- a pending snapshot row must carry its captured candidate group, while
-- approved auto self-rows legitimately have no pending candidate group and
-- are identified through their instance state, never a fabricated pool.
-- Custom rows keep their explicit required approver and chain flag.
-- Legacy rows retain their required level.
ALTER TABLE "request_approvals"
  ADD CONSTRAINT "request_approvals_row_mode_integrity"
  CHECK (
    ("routingMode" = 'LEGACY_LEVEL' AND "requiredLevel" IS NOT NULL)
    OR ("routingMode" = 'CUSTOM_PERSON' AND "isCustomChain" = true AND "requiredApproverId" IS NOT NULL)
    OR (
      "routingMode" = 'SNAPSHOT_GROUP'
      AND "instanceId" IS NOT NULL
      AND "requiredPosition" IS NOT NULL
      AND ("candidateGroupId" IS NOT NULL OR "status" <> 'pending')
    )
  );

ALTER TABLE "solution_approvals"
  ADD CONSTRAINT "solution_approvals_row_mode_integrity"
  CHECK (
    ("routingMode" = 'LEGACY_LEVEL' AND "requiredLevel" IS NOT NULL)
    OR ("routingMode" = 'CUSTOM_PERSON' AND "isCustomChain" = true AND "requiredApproverId" IS NOT NULL)
    OR (
      "routingMode" = 'SNAPSHOT_GROUP'
      AND "instanceId" IS NOT NULL
      AND "requiredPosition" IS NOT NULL
      AND ("candidateGroupId" IS NOT NULL OR "status" <> 'pending')
    )
  );
