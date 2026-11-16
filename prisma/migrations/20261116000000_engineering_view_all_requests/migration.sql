-- Opt-in, read-only Engineering visibility for an organization branch.
ALTER TABLE "organization_units"
ADD COLUMN "engineeringCanViewAllRequests" BOOLEAN NOT NULL DEFAULT false;
