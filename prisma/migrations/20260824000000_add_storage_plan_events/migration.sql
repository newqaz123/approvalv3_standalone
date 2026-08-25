-- CreateTable
CREATE TABLE "storage_plan_events" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "plannedDate" DATE NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "storage_plan_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "storage_plan_events_createdById_idx" ON "storage_plan_events"("createdById");

-- CreateIndex
CREATE INDEX "storage_plan_events_plannedDate_idx" ON "storage_plan_events"("plannedDate");

-- AddForeignKey
ALTER TABLE "storage_plan_events" ADD CONSTRAINT "storage_plan_events_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
