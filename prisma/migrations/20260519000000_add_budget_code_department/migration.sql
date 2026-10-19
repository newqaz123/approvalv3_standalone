-- Link budget codes to the department budget they belong to.
ALTER TABLE "budget_codes" ADD COLUMN "departmentId" TEXT;

ALTER TABLE "budget_codes"
ADD CONSTRAINT "budget_codes_departmentId_fkey"
FOREIGN KEY ("departmentId") REFERENCES "departments"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "budget_codes_departmentId_idx" ON "budget_codes"("departmentId");
