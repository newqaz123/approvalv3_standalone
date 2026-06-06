-- AlterTable
ALTER TABLE "requests"
ADD COLUMN "workRequisitionReceived" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "workRequisitionReceivedAt" TIMESTAMP(3),
ADD COLUMN "workRequisitionReceivedById" TEXT;

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

-- CreateIndex
CREATE UNIQUE INDEX "sub_task_stages_name_key" ON "sub_task_stages"("name");
CREATE INDEX "sub_task_stages_isActive_idx" ON "sub_task_stages"("isActive");
CREATE INDEX "sub_task_stages_isOthers_idx" ON "sub_task_stages"("isOthers");
CREATE INDEX "sub_task_stages_sortOrder_idx" ON "sub_task_stages"("sortOrder");
CREATE UNIQUE INDEX "sub_contractors_name_key" ON "sub_contractors"("name");
CREATE INDEX "sub_contractors_createdById_idx" ON "sub_contractors"("createdById");
CREATE INDEX "sub_contractors_isActive_idx" ON "sub_contractors"("isActive");
CREATE INDEX "sub_contractors_updatedById_idx" ON "sub_contractors"("updatedById");
CREATE INDEX "request_sub_tasks_completedById_idx" ON "request_sub_tasks"("completedById");
CREATE INDEX "request_sub_tasks_createdById_idx" ON "request_sub_tasks"("createdById");
CREATE INDEX "request_sub_tasks_isCompleted_idx" ON "request_sub_tasks"("isCompleted");
CREATE INDEX "request_sub_tasks_requestId_idx" ON "request_sub_tasks"("requestId");
CREATE INDEX "request_sub_tasks_stageId_idx" ON "request_sub_tasks"("stageId");
CREATE INDEX "request_sub_tasks_subContractorId_idx" ON "request_sub_tasks"("subContractorId");
CREATE INDEX "request_sub_tasks_updatedAt_idx" ON "request_sub_tasks"("updatedAt");
CREATE INDEX "request_sub_tasks_updatedById_idx" ON "request_sub_tasks"("updatedById");
CREATE INDEX "requests_workRequisitionReceived_idx" ON "requests"("workRequisitionReceived");
CREATE INDEX "requests_workRequisitionReceivedById_idx" ON "requests"("workRequisitionReceivedById");

-- AddForeignKey
ALTER TABLE "requests" ADD CONSTRAINT "requests_workRequisitionReceivedById_fkey" FOREIGN KEY ("workRequisitionReceivedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sub_contractors" ADD CONSTRAINT "sub_contractors_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sub_contractors" ADD CONSTRAINT "sub_contractors_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "request_sub_tasks" ADD CONSTRAINT "request_sub_tasks_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "request_sub_tasks" ADD CONSTRAINT "request_sub_tasks_subContractorId_fkey" FOREIGN KEY ("subContractorId") REFERENCES "sub_contractors"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "request_sub_tasks" ADD CONSTRAINT "request_sub_tasks_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "sub_task_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "request_sub_tasks" ADD CONSTRAINT "request_sub_tasks_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "request_sub_tasks" ADD CONSTRAINT "request_sub_tasks_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "request_sub_tasks" ADD CONSTRAINT "request_sub_tasks_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed default global stages
INSERT INTO "sub_task_stages" ("id", "name", "sortOrder", "isDefault", "isOthers", "isActive", "updatedAt")
VALUES
  (gen_random_uuid()::text, 'Design', 10, true, false, true, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Site survey', 20, true, false, true, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Waiting user data', 30, true, false, true, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Waiting quotation', 40, true, false, true, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Waiting WR', 50, true, false, true, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Completed', 60, true, false, true, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Others', 70, true, true, true, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO NOTHING;
