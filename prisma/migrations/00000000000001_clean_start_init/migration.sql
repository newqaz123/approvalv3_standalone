-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('approval_needed', 'approval_granted', 'approval_rejected', 'status_changed', 'request_assigned', 'solution_ready', 'final_approval_needed');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('ImprovementRequest', 'SentToEngineer', 'SendBackToRequester', 'Completed', 'Cancelled', 'DesignCostEstimationApproval', 'FinalApproval');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('admin', 'general_dept', 'engineering');

-- CreateEnum
CREATE TYPE "ApprovalPhase" AS ENUM ('REQUEST', 'SOLUTION', 'FINAL');

-- CreateEnum
CREATE TYPE "ApprovalRouteStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'RETIRED');

-- CreateEnum
CREATE TYPE "ApprovalRoutingMode" AS ENUM ('SNAPSHOT_GROUP', 'CUSTOM_PERSON');

-- CreateEnum
CREATE TYPE "ApprovalInstanceState" AS ENUM ('PENDING', 'AUTO_APPROVED', 'COMPLETED_NO_ELIGIBLE_STEPS', 'APPROVED', 'REJECTED', 'CANCELLED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "ApprovalSkipReason" AS ENUM ('VACANT_POSITION');

-- CreateTable
CREATE TABLE "file_attachments" (
    "id" TEXT NOT NULL,
    "requestId" TEXT,
    "fileName" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "description" TEXT,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "filePath" TEXT NOT NULL,
    "solutionId" TEXT,

    CONSTRAINT "file_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inline_description_images" (
    "id" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "uploadSessionId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "originalSize" INTEGER NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "filePath" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "deletionPendingAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inline_description_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inline_description_image_references" (
    "id" TEXT NOT NULL,
    "imageId" TEXT NOT NULL,
    "requestId" TEXT,
    "solutionId" TEXT,
    "templateId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inline_description_image_references_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "requestId" TEXT,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "request_activities" (
    "id" TEXT NOT NULL,
    "requestId" TEXT,
    "action" TEXT NOT NULL,
    "fromStatus" "RequestStatus",
    "toStatus" "RequestStatus",
    "comments" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "request_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "request_approvals" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "approverId" TEXT,
    "order" INTEGER NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'pending',
    "comments" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isFinalApproval" BOOLEAN NOT NULL DEFAULT false,
    "requiredApproverId" TEXT,
    "instanceId" TEXT,
    "requiredPositionId" TEXT,
    "candidateGroupId" TEXT,
    "routingMode" "ApprovalRoutingMode" NOT NULL DEFAULT 'SNAPSHOT_GROUP',

    CONSTRAINT "request_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "request_engineer_assignments" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "engineerId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedById" TEXT,

    CONSTRAINT "request_engineer_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sub_task_stages" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT true,
    "isOthers" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sub_task_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sub_contractors" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "sub_contractors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "request_sub_tasks" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "subContractorId" TEXT,
    "stageId" TEXT NOT NULL,
    "customStageText" TEXT,
    "isCompleted" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),
    "completedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "request_sub_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_codes" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "displayCode" TEXT NOT NULL,
    "name" TEXT,
    "budgetAmount" DECIMAL(15,2),
    "unitId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "budget_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "requests" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "RequestStatus" NOT NULL DEFAULT 'ImprovementRequest',
    "requesterId" TEXT NOT NULL,
    "organizationUnitId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "engineeringCostEstimate" DECIMAL(15,2),
    "engineeringSolution" TEXT,
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "budgetCodeId" TEXT,
    "projectEstimateCost" DECIMAL(15,2),
    "workRequisitionReceived" BOOLEAN NOT NULL DEFAULT false,
    "workRequisitionReceivedAt" TIMESTAMP(3),
    "workRequisitionReceivedById" TEXT,

    CONSTRAINT "requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "solution_approvals" (
    "id" TEXT NOT NULL,
    "solutionId" TEXT NOT NULL,
    "requiredApproverId" TEXT,
    "approverId" TEXT,
    "order" INTEGER NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'pending',
    "comments" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "instanceId" TEXT,
    "requiredPositionId" TEXT,
    "candidateGroupId" TEXT,
    "routingMode" "ApprovalRoutingMode" NOT NULL DEFAULT 'SNAPSHOT_GROUP',

    CONSTRAINT "solution_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "solutions" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "costEstimate" DECIMAL(15,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'THB',
    "timeline" TEXT,
    "conceptDesign" TEXT,
    "submittedById" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "solutions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "retention_settings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "archiveEnabled" BOOLEAN NOT NULL DEFAULT true,
    "archiveAfterDays" INTEGER NOT NULL DEFAULT 90,
    "archiveStatuses" JSONB NOT NULL,
    "cleanupAfterDays" INTEGER NOT NULL DEFAULT 365,
    "archiveHour" INTEGER NOT NULL DEFAULT 2,
    "archiveMinute" INTEGER NOT NULL DEFAULT 0,
    "lastArchiveRunOn" TEXT,
    "storageAlertThresholdPct" INTEGER NOT NULL DEFAULT 0,
    "lastStorageAlertOn" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "retention_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "storage_plan_events" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "plannedDate" DATE NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "storage_plan_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_settings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "provider" TEXT NOT NULL DEFAULT 'custom',
    "host" TEXT NOT NULL,
    "port" INTEGER NOT NULL DEFAULT 587,
    "username" TEXT,
    "passwordEncrypted" TEXT,
    "fromAddress" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'general_dept',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "forcePasswordChange" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_units" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "shareRequests" BOOLEAN NOT NULL DEFAULT true,
    "canWorkOnSolutions" BOOLEAN NOT NULL DEFAULT false,
    "managerUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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

-- CreateTable
CREATE TABLE "approval_route_steps" (
    "id" TEXT NOT NULL,
    "routeVersionId" TEXT NOT NULL,
    "stepOrder" INTEGER NOT NULL,
    "positionId" TEXT NOT NULL,
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

-- CreateTable
CREATE TABLE "approval_instance_skips" (
    "id" TEXT NOT NULL,
    "approvalInstanceId" TEXT NOT NULL,
    "routeStepId" TEXT,
    "requiredPositionId" TEXT NOT NULL,
    "reason" "ApprovalSkipReason" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_instance_skips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_candidate_groups" (
    "id" TEXT NOT NULL,
    "approvalInstanceId" TEXT NOT NULL,
    "scopeUnitId" TEXT NOT NULL,
    "requiredPositionId" TEXT NOT NULL,
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
CREATE TABLE "company_settings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "name" TEXT NOT NULL,
    "rootUnitId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "positions" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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

-- CreateTable
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

-- CreateIndex
CREATE INDEX "file_attachments_requestId_idx" ON "file_attachments"("requestId");

-- CreateIndex
CREATE INDEX "file_attachments_solutionId_idx" ON "file_attachments"("solutionId");

-- CreateIndex
CREATE INDEX "file_attachments_uploadedById_idx" ON "file_attachments"("uploadedById");

-- CreateIndex
CREATE INDEX "inline_description_images_uploadedById_idx" ON "inline_description_images"("uploadedById");

-- CreateIndex
CREATE INDEX "inline_description_images_uploadSessionId_idx" ON "inline_description_images"("uploadSessionId");

-- CreateIndex
CREATE INDEX "inline_description_images_createdAt_idx" ON "inline_description_images"("createdAt");

-- CreateIndex
CREATE INDEX "inline_description_images_deletionPendingAt_idx" ON "inline_description_images"("deletionPendingAt");

-- CreateIndex
CREATE INDEX "inline_description_image_references_imageId_idx" ON "inline_description_image_references"("imageId");

-- CreateIndex
CREATE INDEX "inline_description_image_references_requestId_idx" ON "inline_description_image_references"("requestId");

-- CreateIndex
CREATE INDEX "inline_description_image_references_solutionId_idx" ON "inline_description_image_references"("solutionId");

-- CreateIndex
CREATE INDEX "inline_description_image_references_templateId_idx" ON "inline_description_image_references"("templateId");

-- CreateIndex
CREATE UNIQUE INDEX "inline_description_image_references_imageId_requestId_key" ON "inline_description_image_references"("imageId", "requestId");

-- CreateIndex
CREATE UNIQUE INDEX "inline_description_image_references_imageId_solutionId_key" ON "inline_description_image_references"("imageId", "solutionId");

-- CreateIndex
CREATE UNIQUE INDEX "inline_description_image_references_imageId_templateId_key" ON "inline_description_image_references"("imageId", "templateId");

-- CreateIndex
CREATE INDEX "notifications_createdAt_idx" ON "notifications"("createdAt");

-- CreateIndex
CREATE INDEX "notifications_isRead_idx" ON "notifications"("isRead");

-- CreateIndex
CREATE INDEX "notifications_userId_idx" ON "notifications"("userId");

-- CreateIndex
CREATE INDEX "request_activities_createdAt_idx" ON "request_activities"("createdAt");

-- CreateIndex
CREATE INDEX "request_activities_requestId_idx" ON "request_activities"("requestId");

-- CreateIndex
CREATE INDEX "request_activities_userId_idx" ON "request_activities"("userId");

-- CreateIndex
CREATE INDEX "request_approvals_approverId_idx" ON "request_approvals"("approverId");

-- CreateIndex
CREATE INDEX "request_approvals_requestId_idx" ON "request_approvals"("requestId");

-- CreateIndex
CREATE INDEX "request_approvals_requiredApproverId_idx" ON "request_approvals"("requiredApproverId");

-- CreateIndex
CREATE INDEX "request_approvals_status_idx" ON "request_approvals"("status");

-- CreateIndex
CREATE INDEX "request_approvals_instanceId_idx" ON "request_approvals"("instanceId");

-- CreateIndex
CREATE INDEX "request_approvals_candidateGroupId_idx" ON "request_approvals"("candidateGroupId");

-- CreateIndex
CREATE INDEX "request_approvals_requiredPositionId_idx" ON "request_approvals"("requiredPositionId");

-- CreateIndex
CREATE INDEX "request_engineer_assignments_engineerId_idx" ON "request_engineer_assignments"("engineerId");

-- CreateIndex
CREATE INDEX "request_engineer_assignments_requestId_idx" ON "request_engineer_assignments"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "sub_task_stages_name_key" ON "sub_task_stages"("name");

-- CreateIndex
CREATE INDEX "sub_task_stages_isActive_idx" ON "sub_task_stages"("isActive");

-- CreateIndex
CREATE INDEX "sub_task_stages_isOthers_idx" ON "sub_task_stages"("isOthers");

-- CreateIndex
CREATE INDEX "sub_task_stages_sortOrder_idx" ON "sub_task_stages"("sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "sub_contractors_name_key" ON "sub_contractors"("name");

-- CreateIndex
CREATE INDEX "sub_contractors_createdById_idx" ON "sub_contractors"("createdById");

-- CreateIndex
CREATE INDEX "sub_contractors_isActive_idx" ON "sub_contractors"("isActive");

-- CreateIndex
CREATE INDEX "sub_contractors_updatedById_idx" ON "sub_contractors"("updatedById");

-- CreateIndex
CREATE INDEX "request_sub_tasks_completedById_idx" ON "request_sub_tasks"("completedById");

-- CreateIndex
CREATE INDEX "request_sub_tasks_createdById_idx" ON "request_sub_tasks"("createdById");

-- CreateIndex
CREATE INDEX "request_sub_tasks_isCompleted_idx" ON "request_sub_tasks"("isCompleted");

-- CreateIndex
CREATE INDEX "request_sub_tasks_requestId_idx" ON "request_sub_tasks"("requestId");

-- CreateIndex
CREATE INDEX "request_sub_tasks_stageId_idx" ON "request_sub_tasks"("stageId");

-- CreateIndex
CREATE INDEX "request_sub_tasks_subContractorId_idx" ON "request_sub_tasks"("subContractorId");

-- CreateIndex
CREATE INDEX "request_sub_tasks_updatedAt_idx" ON "request_sub_tasks"("updatedAt");

-- CreateIndex
CREATE INDEX "request_sub_tasks_updatedById_idx" ON "request_sub_tasks"("updatedById");

-- CreateIndex
CREATE UNIQUE INDEX "budget_codes_code_key" ON "budget_codes"("code");

-- CreateIndex
CREATE INDEX "budget_codes_createdById_idx" ON "budget_codes"("createdById");

-- CreateIndex
CREATE INDEX "budget_codes_displayCode_idx" ON "budget_codes"("displayCode");

-- CreateIndex
CREATE INDEX "budget_codes_unitId_idx" ON "budget_codes"("unitId");

-- CreateIndex
CREATE INDEX "requests_budgetCodeId_idx" ON "requests"("budgetCodeId");

-- CreateIndex
CREATE INDEX "requests_createdAt_idx" ON "requests"("createdAt");

-- CreateIndex
CREATE INDEX "requests_isDeleted_idx" ON "requests"("isDeleted");

-- CreateIndex
CREATE INDEX "requests_organizationUnitId_idx" ON "requests"("organizationUnitId");

-- CreateIndex
CREATE INDEX "requests_requesterId_idx" ON "requests"("requesterId");

-- CreateIndex
CREATE INDEX "requests_status_idx" ON "requests"("status");

-- CreateIndex
CREATE INDEX "requests_workRequisitionReceived_idx" ON "requests"("workRequisitionReceived");

-- CreateIndex
CREATE INDEX "requests_workRequisitionReceivedById_idx" ON "requests"("workRequisitionReceivedById");

-- CreateIndex
CREATE INDEX "solution_approvals_approverId_idx" ON "solution_approvals"("approverId");

-- CreateIndex
CREATE INDEX "solution_approvals_order_idx" ON "solution_approvals"("order");

-- CreateIndex
CREATE INDEX "solution_approvals_requiredApproverId_idx" ON "solution_approvals"("requiredApproverId");

-- CreateIndex
CREATE INDEX "solution_approvals_solutionId_idx" ON "solution_approvals"("solutionId");

-- CreateIndex
CREATE INDEX "solution_approvals_status_idx" ON "solution_approvals"("status");

-- CreateIndex
CREATE INDEX "solution_approvals_instanceId_idx" ON "solution_approvals"("instanceId");

-- CreateIndex
CREATE INDEX "solution_approvals_candidateGroupId_idx" ON "solution_approvals"("candidateGroupId");

-- CreateIndex
CREATE INDEX "solution_approvals_requiredPositionId_idx" ON "solution_approvals"("requiredPositionId");

-- CreateIndex
CREATE INDEX "solutions_createdAt_idx" ON "solutions"("createdAt");

-- CreateIndex
CREATE INDEX "solutions_requestId_idx" ON "solutions"("requestId");

-- CreateIndex
CREATE INDEX "solutions_submittedById_idx" ON "solutions"("submittedById");

-- CreateIndex
CREATE INDEX "templates_isActive_idx" ON "templates"("isActive");

-- CreateIndex
CREATE INDEX "templates_isDefault_idx" ON "templates"("isDefault");

-- CreateIndex
CREATE INDEX "storage_plan_events_createdById_idx" ON "storage_plan_events"("createdById");

-- CreateIndex
CREATE INDEX "storage_plan_events_plannedDate_idx" ON "storage_plan_events"("plannedDate");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_isActive_idx" ON "users"("isActive");

-- CreateIndex
CREATE INDEX "organization_units_parentId_idx" ON "organization_units"("parentId");

-- CreateIndex
CREATE INDEX "organization_units_isActive_idx" ON "organization_units"("isActive");

-- CreateIndex
CREATE INDEX "organization_units_managerUserId_idx" ON "organization_units"("managerUserId");

-- CreateIndex
CREATE INDEX "approval_route_versions_scopeUnitId_phase_status_idx" ON "approval_route_versions"("scopeUnitId", "phase", "status");

-- CreateIndex
CREATE INDEX "approval_route_versions_approvalLimitPositionId_idx" ON "approval_route_versions"("approvalLimitPositionId");

-- CreateIndex
CREATE UNIQUE INDEX "approval_route_versions_scopeUnitId_phase_version_key" ON "approval_route_versions"("scopeUnitId", "phase", "version");

-- CreateIndex
CREATE INDEX "approval_route_steps_positionId_idx" ON "approval_route_steps"("positionId");

-- CreateIndex
CREATE UNIQUE INDEX "approval_route_steps_routeVersionId_stepOrder_key" ON "approval_route_steps"("routeVersionId", "stepOrder");

-- CreateIndex
CREATE UNIQUE INDEX "approval_route_steps_routeVersionId_positionId_key" ON "approval_route_steps"("routeVersionId", "positionId");

-- CreateIndex
CREATE INDEX "approval_instances_requestId_phase_supersededAt_idx" ON "approval_instances"("requestId", "phase", "supersededAt");

-- CreateIndex
CREATE INDEX "approval_instances_solutionId_phase_supersededAt_idx" ON "approval_instances"("solutionId", "phase", "supersededAt");

-- CreateIndex
CREATE INDEX "approval_instances_routeVersionId_idx" ON "approval_instances"("routeVersionId");

-- CreateIndex
CREATE INDEX "approval_instances_originAssignmentId_idx" ON "approval_instances"("originAssignmentId");

-- CreateIndex
CREATE INDEX "approval_instances_originPositionId_idx" ON "approval_instances"("originPositionId");

-- CreateIndex
CREATE INDEX "approval_instances_restartOfInstanceId_idx" ON "approval_instances"("restartOfInstanceId");

-- CreateIndex
CREATE INDEX "approval_instances_restartedById_idx" ON "approval_instances"("restartedById");

-- CreateIndex
CREATE UNIQUE INDEX "approval_instances_requestId_phase_attempt_key" ON "approval_instances"("requestId", "phase", "attempt");

-- CreateIndex
CREATE UNIQUE INDEX "approval_instances_solutionId_phase_attempt_key" ON "approval_instances"("solutionId", "phase", "attempt");

-- CreateIndex
CREATE INDEX "approval_instance_skips_requiredPositionId_idx" ON "approval_instance_skips"("requiredPositionId");

-- CreateIndex
CREATE UNIQUE INDEX "approval_instance_skips_approvalInstanceId_requiredPosition_key" ON "approval_instance_skips"("approvalInstanceId", "requiredPositionId");

-- CreateIndex
CREATE INDEX "approval_candidate_groups_scopeUnitId_idx" ON "approval_candidate_groups"("scopeUnitId");

-- CreateIndex
CREATE INDEX "approval_candidate_groups_requiredPositionId_idx" ON "approval_candidate_groups"("requiredPositionId");

-- CreateIndex
CREATE UNIQUE INDEX "approval_candidate_groups_approvalInstanceId_requiredPositi_key" ON "approval_candidate_groups"("approvalInstanceId", "requiredPositionId");

-- CreateIndex
CREATE INDEX "approval_candidate_group_members_userId_idx" ON "approval_candidate_group_members"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "company_settings_rootUnitId_key" ON "company_settings"("rootUnitId");

-- CreateIndex
CREATE UNIQUE INDEX "positions_name_key" ON "positions"("name");

-- CreateIndex
CREATE INDEX "organization_assignments_userId_idx" ON "organization_assignments"("userId");

-- CreateIndex
CREATE INDEX "organization_assignments_unitId_idx" ON "organization_assignments"("unitId");

-- CreateIndex
CREATE INDEX "organization_assignments_positionId_idx" ON "organization_assignments"("positionId");

-- CreateIndex
CREATE INDEX "organization_assignments_teamId_idx" ON "organization_assignments"("teamId");

-- CreateIndex
CREATE INDEX "teams_unitId_idx" ON "teams"("unitId");

-- CreateIndex
CREATE INDEX "teams_reportsToAssignmentId_idx" ON "teams"("reportsToAssignmentId");

-- AddForeignKey
ALTER TABLE "file_attachments" ADD CONSTRAINT "file_attachments_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_attachments" ADD CONSTRAINT "file_attachments_solutionId_fkey" FOREIGN KEY ("solutionId") REFERENCES "solutions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_attachments" ADD CONSTRAINT "file_attachments_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inline_description_images" ADD CONSTRAINT "inline_description_images_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inline_description_image_references" ADD CONSTRAINT "inline_description_image_references_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "inline_description_images"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inline_description_image_references" ADD CONSTRAINT "inline_description_image_references_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inline_description_image_references" ADD CONSTRAINT "inline_description_image_references_solutionId_fkey" FOREIGN KEY ("solutionId") REFERENCES "solutions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inline_description_image_references" ADD CONSTRAINT "inline_description_image_references_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_activities" ADD CONSTRAINT "request_activities_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_activities" ADD CONSTRAINT "request_activities_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_approvals" ADD CONSTRAINT "request_approvals_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_approvals" ADD CONSTRAINT "request_approvals_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_approvals" ADD CONSTRAINT "request_approvals_requiredApproverId_fkey" FOREIGN KEY ("requiredApproverId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_approvals" ADD CONSTRAINT "request_approvals_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "approval_instances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_approvals" ADD CONSTRAINT "request_approvals_candidateGroupId_fkey" FOREIGN KEY ("candidateGroupId") REFERENCES "approval_candidate_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_approvals" ADD CONSTRAINT "request_approvals_requiredPositionId_fkey" FOREIGN KEY ("requiredPositionId") REFERENCES "positions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_engineer_assignments" ADD CONSTRAINT "request_engineer_assignments_engineerId_fkey" FOREIGN KEY ("engineerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_engineer_assignments" ADD CONSTRAINT "request_engineer_assignments_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sub_contractors" ADD CONSTRAINT "sub_contractors_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sub_contractors" ADD CONSTRAINT "sub_contractors_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_sub_tasks" ADD CONSTRAINT "request_sub_tasks_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_sub_tasks" ADD CONSTRAINT "request_sub_tasks_subContractorId_fkey" FOREIGN KEY ("subContractorId") REFERENCES "sub_contractors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_sub_tasks" ADD CONSTRAINT "request_sub_tasks_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "sub_task_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_sub_tasks" ADD CONSTRAINT "request_sub_tasks_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_sub_tasks" ADD CONSTRAINT "request_sub_tasks_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_sub_tasks" ADD CONSTRAINT "request_sub_tasks_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_codes" ADD CONSTRAINT "budget_codes_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_codes" ADD CONSTRAINT "budget_codes_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "organization_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requests" ADD CONSTRAINT "requests_budgetCodeId_fkey" FOREIGN KEY ("budgetCodeId") REFERENCES "budget_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requests" ADD CONSTRAINT "requests_deletedBy_fkey" FOREIGN KEY ("deletedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requests" ADD CONSTRAINT "requests_organizationUnitId_fkey" FOREIGN KEY ("organizationUnitId") REFERENCES "organization_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requests" ADD CONSTRAINT "requests_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requests" ADD CONSTRAINT "requests_workRequisitionReceivedById_fkey" FOREIGN KEY ("workRequisitionReceivedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solution_approvals" ADD CONSTRAINT "solution_approvals_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solution_approvals" ADD CONSTRAINT "solution_approvals_requiredApproverId_fkey" FOREIGN KEY ("requiredApproverId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solution_approvals" ADD CONSTRAINT "solution_approvals_solutionId_fkey" FOREIGN KEY ("solutionId") REFERENCES "solutions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solution_approvals" ADD CONSTRAINT "solution_approvals_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "approval_instances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solution_approvals" ADD CONSTRAINT "solution_approvals_candidateGroupId_fkey" FOREIGN KEY ("candidateGroupId") REFERENCES "approval_candidate_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solution_approvals" ADD CONSTRAINT "solution_approvals_requiredPositionId_fkey" FOREIGN KEY ("requiredPositionId") REFERENCES "positions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solutions" ADD CONSTRAINT "solutions_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solutions" ADD CONSTRAINT "solutions_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storage_plan_events" ADD CONSTRAINT "storage_plan_events_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_units" ADD CONSTRAINT "organization_units_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "organization_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_units" ADD CONSTRAINT "organization_units_managerUserId_fkey" FOREIGN KEY ("managerUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_route_versions" ADD CONSTRAINT "approval_route_versions_scopeUnitId_fkey" FOREIGN KEY ("scopeUnitId") REFERENCES "organization_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_route_versions" ADD CONSTRAINT "approval_route_versions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_route_versions" ADD CONSTRAINT "approval_route_versions_approvalLimitPositionId_fkey" FOREIGN KEY ("approvalLimitPositionId") REFERENCES "positions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_route_steps" ADD CONSTRAINT "approval_route_steps_routeVersionId_fkey" FOREIGN KEY ("routeVersionId") REFERENCES "approval_route_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_route_steps" ADD CONSTRAINT "approval_route_steps_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "positions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

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
ALTER TABLE "approval_instances" ADD CONSTRAINT "approval_instances_originAssignmentId_fkey" FOREIGN KEY ("originAssignmentId") REFERENCES "organization_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_instances" ADD CONSTRAINT "approval_instances_originPositionId_fkey" FOREIGN KEY ("originPositionId") REFERENCES "positions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_instances" ADD CONSTRAINT "approval_instances_restartOfInstanceId_fkey" FOREIGN KEY ("restartOfInstanceId") REFERENCES "approval_instances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_instances" ADD CONSTRAINT "approval_instances_restartedById_fkey" FOREIGN KEY ("restartedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_instance_skips" ADD CONSTRAINT "approval_instance_skips_approvalInstanceId_fkey" FOREIGN KEY ("approvalInstanceId") REFERENCES "approval_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_instance_skips" ADD CONSTRAINT "approval_instance_skips_routeStepId_fkey" FOREIGN KEY ("routeStepId") REFERENCES "approval_route_steps"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_instance_skips" ADD CONSTRAINT "approval_instance_skips_requiredPositionId_fkey" FOREIGN KEY ("requiredPositionId") REFERENCES "positions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_candidate_groups" ADD CONSTRAINT "approval_candidate_groups_approvalInstanceId_fkey" FOREIGN KEY ("approvalInstanceId") REFERENCES "approval_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_candidate_groups" ADD CONSTRAINT "approval_candidate_groups_requiredPositionId_fkey" FOREIGN KEY ("requiredPositionId") REFERENCES "positions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_candidate_group_members" ADD CONSTRAINT "approval_candidate_group_members_candidateGroupId_fkey" FOREIGN KEY ("candidateGroupId") REFERENCES "approval_candidate_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_settings" ADD CONSTRAINT "company_settings_rootUnitId_fkey" FOREIGN KEY ("rootUnitId") REFERENCES "organization_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_assignments" ADD CONSTRAINT "organization_assignments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_assignments" ADD CONSTRAINT "organization_assignments_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "organization_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_assignments" ADD CONSTRAINT "organization_assignments_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "positions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_assignments" ADD CONSTRAINT "organization_assignments_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "organization_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_reportsToAssignmentId_fkey" FOREIGN KEY ("reportsToAssignmentId") REFERENCES "organization_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ------------------------------------------------------------------
-- Partial unique indexes Prisma cannot express (hand-appended).
-- Identifiers quoted to match Prisma camelCase columns.
-- ------------------------------------------------------------------

CREATE UNIQUE INDEX one_active_assignment_per_user
  ON "organization_assignments" ("userId") WHERE "isActive";

CREATE UNIQUE INDEX one_active_company_root
  ON "organization_units" ((1)) WHERE "parentId" IS NULL AND "isActive";

CREATE UNIQUE INDEX one_published_route_per_scope_phase
  ON "approval_route_versions" ("scopeUnitId", "phase") WHERE "status" = 'PUBLISHED';

CREATE UNIQUE INDEX one_active_team_name_per_unit
  ON "teams" ("unitId", "name") WHERE "isActive";

-- Row-mode integrity: SNAPSHOT_GROUP rows carry instance + requiredPositionId;
-- CUSTOM_PERSON rows carry requiredApproverId.
ALTER TABLE "request_approvals"
  ADD CONSTRAINT "request_approvals_row_mode_integrity"
  CHECK (
    ("routingMode" = 'CUSTOM_PERSON' AND "requiredApproverId" IS NOT NULL)
    OR ("routingMode" = 'SNAPSHOT_GROUP' AND "instanceId" IS NOT NULL AND "requiredPositionId" IS NOT NULL)
  );

ALTER TABLE "solution_approvals"
  ADD CONSTRAINT "solution_approvals_row_mode_integrity"
  CHECK (
    ("routingMode" = 'CUSTOM_PERSON' AND "requiredApproverId" IS NOT NULL)
    OR ("routingMode" = 'SNAPSHOT_GROUP' AND "instanceId" IS NOT NULL AND "requiredPositionId" IS NOT NULL)
  );

ALTER TABLE "approval_instances"
  ADD CONSTRAINT "approval_instances_one_document_owner"
  CHECK (
    ("phase" = 'SOLUTION' AND "solutionId" IS NOT NULL AND "requestId" IS NULL)
    OR ("phase" IN ('REQUEST', 'FINAL') AND "requestId" IS NOT NULL AND "solutionId" IS NULL)
  );

ALTER TABLE "inline_description_image_references"
  ADD CONSTRAINT "inline_description_image_references_one_owner"
  CHECK (num_nonnulls("requestId", "solutionId", "templateId") = 1);
