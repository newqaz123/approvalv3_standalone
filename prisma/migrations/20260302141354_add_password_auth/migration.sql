-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('approval_needed', 'approval_granted', 'approval_rejected', 'status_changed', 'request_assigned', 'solution_ready', 'final_approval_needed');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "RequestStatus" ADD VALUE 'Cancelled';
ALTER TYPE "RequestStatus" ADD VALUE 'FinalApproval';

-- AlterTable
ALTER TABLE "file_attachments" ADD COLUMN     "solutionId" TEXT,
ALTER COLUMN "requestId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "request_activities" ALTER COLUMN "requestId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "requests" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "deletedBy" TEXT,
ADD COLUMN     "engineeringCostEstimate" DECIMAL(15,2),
ADD COLUMN     "engineeringSolution" TEXT,
ADD COLUMN     "isDeleted" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "forcePasswordChange" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "passwordHash" TEXT;

-- CreateTable
CREATE TABLE "hierarchy_change_logs" (
    "id" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "adminUserId" TEXT NOT NULL,
    "targetUserId" TEXT NOT NULL,
    "oldLevel" INTEGER,
    "newLevel" INTEGER NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hierarchy_change_logs_pkey" PRIMARY KEY ("id")
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
CREATE TABLE "request_approvals" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "approverId" TEXT,
    "requiredLevel" INTEGER NOT NULL,
    "order" INTEGER NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'pending',
    "comments" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isCustomChain" BOOLEAN NOT NULL DEFAULT false,
    "isFinalApproval" BOOLEAN NOT NULL DEFAULT false,
    "requiredApproverId" TEXT,

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
CREATE TABLE "solution_approvals" (
    "id" TEXT NOT NULL,
    "solutionId" TEXT NOT NULL,
    "requiredLevel" INTEGER,
    "requiredApproverId" TEXT,
    "approverId" TEXT,
    "order" INTEGER NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'pending',
    "comments" TEXT,
    "isCustomChain" BOOLEAN NOT NULL DEFAULT false,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

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

-- CreateIndex
CREATE INDEX "hierarchy_change_logs_adminUserId_idx" ON "hierarchy_change_logs"("adminUserId");

-- CreateIndex
CREATE INDEX "hierarchy_change_logs_createdAt_idx" ON "hierarchy_change_logs"("createdAt");

-- CreateIndex
CREATE INDEX "hierarchy_change_logs_departmentId_idx" ON "hierarchy_change_logs"("departmentId");

-- CreateIndex
CREATE INDEX "hierarchy_change_logs_targetUserId_idx" ON "hierarchy_change_logs"("targetUserId");

-- CreateIndex
CREATE INDEX "notifications_createdAt_idx" ON "notifications"("createdAt");

-- CreateIndex
CREATE INDEX "notifications_isRead_idx" ON "notifications"("isRead");

-- CreateIndex
CREATE INDEX "notifications_userId_idx" ON "notifications"("userId");

-- CreateIndex
CREATE INDEX "request_approvals_approverId_idx" ON "request_approvals"("approverId");

-- CreateIndex
CREATE INDEX "request_approvals_requestId_idx" ON "request_approvals"("requestId");

-- CreateIndex
CREATE INDEX "request_approvals_requiredApproverId_idx" ON "request_approvals"("requiredApproverId");

-- CreateIndex
CREATE INDEX "request_approvals_requiredLevel_idx" ON "request_approvals"("requiredLevel");

-- CreateIndex
CREATE INDEX "request_approvals_status_idx" ON "request_approvals"("status");

-- CreateIndex
CREATE INDEX "request_engineer_assignments_engineerId_idx" ON "request_engineer_assignments"("engineerId");

-- CreateIndex
CREATE INDEX "request_engineer_assignments_requestId_idx" ON "request_engineer_assignments"("requestId");

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
CREATE INDEX "file_attachments_solutionId_idx" ON "file_attachments"("solutionId");

-- CreateIndex
CREATE INDEX "requests_isDeleted_idx" ON "requests"("isDeleted");

-- CreateIndex
CREATE INDEX "users_level_idx" ON "users"("level");

-- AddForeignKey
ALTER TABLE "file_attachments" ADD CONSTRAINT "file_attachments_solutionId_fkey" FOREIGN KEY ("solutionId") REFERENCES "solutions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hierarchy_change_logs" ADD CONSTRAINT "hierarchy_change_logs_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hierarchy_change_logs" ADD CONSTRAINT "hierarchy_change_logs_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hierarchy_change_logs" ADD CONSTRAINT "hierarchy_change_logs_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_approvals" ADD CONSTRAINT "request_approvals_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_approvals" ADD CONSTRAINT "request_approvals_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_approvals" ADD CONSTRAINT "request_approvals_requiredApproverId_fkey" FOREIGN KEY ("requiredApproverId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_engineer_assignments" ADD CONSTRAINT "request_engineer_assignments_engineerId_fkey" FOREIGN KEY ("engineerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_engineer_assignments" ADD CONSTRAINT "request_engineer_assignments_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requests" ADD CONSTRAINT "requests_deletedBy_fkey" FOREIGN KEY ("deletedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solution_approvals" ADD CONSTRAINT "solution_approvals_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solution_approvals" ADD CONSTRAINT "solution_approvals_requiredApproverId_fkey" FOREIGN KEY ("requiredApproverId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solution_approvals" ADD CONSTRAINT "solution_approvals_solutionId_fkey" FOREIGN KEY ("solutionId") REFERENCES "solutions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solutions" ADD CONSTRAINT "solutions_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solutions" ADD CONSTRAINT "solutions_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
