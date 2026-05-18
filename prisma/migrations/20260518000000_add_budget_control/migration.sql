-- CreateTable
CREATE TABLE "budget_codes" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "displayCode" TEXT NOT NULL,
    "budgetAmount" DECIMAL(15,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "budget_codes_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "requests" ADD COLUMN "budgetCodeId" TEXT;
ALTER TABLE "requests" ADD COLUMN "projectEstimateCost" DECIMAL(15,2);

-- CreateIndex
CREATE UNIQUE INDEX "budget_codes_code_key" ON "budget_codes"("code");
CREATE INDEX "budget_codes_displayCode_idx" ON "budget_codes"("displayCode");
CREATE INDEX "requests_budgetCodeId_idx" ON "requests"("budgetCodeId");

-- AddForeignKey
ALTER TABLE "requests" ADD CONSTRAINT "requests_budgetCodeId_fkey" FOREIGN KEY ("budgetCodeId") REFERENCES "budget_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
