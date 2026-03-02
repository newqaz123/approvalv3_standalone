-- Phase 7: Add hierarchy configuration support
-- AlterTable: Add levelNames to departments
ALTER TABLE "departments" ADD COLUMN "levelNames" JSONB;

-- AlterTable: Add isArchived to requests
ALTER TABLE "requests" ADD COLUMN "isArchived" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable: DepartmentApprover for cross-department approver assignments
CREATE TABLE "department_approvers" (
    "id" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "approverId" TEXT NOT NULL,
    "approverLevel" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "department_approvers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "department_approvers_departmentId_idx" ON "department_approvers"("departmentId");

-- CreateIndex
CREATE INDEX "department_approvers_approverId_idx" ON "department_approvers"("approverId");

-- CreateUniqueIndex
CREATE UNIQUE INDEX "department_approvers_departmentId_approverId_approverLevel_key" ON "department_approvers"("departmentId", "approverId", "approverLevel");

-- AddForeignKey
ALTER TABLE "department_approvers" ADD CONSTRAINT "department_approvers_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "department_approvers" ADD CONSTRAINT "department_approvers_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
