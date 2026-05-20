-- AlterTable
ALTER TABLE "budget_codes" ADD COLUMN "createdById" TEXT;

-- CreateIndex
CREATE INDEX "budget_codes_createdById_idx" ON "budget_codes"("createdById");

-- AddForeignKey
ALTER TABLE "budget_codes" ADD CONSTRAINT "budget_codes_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
