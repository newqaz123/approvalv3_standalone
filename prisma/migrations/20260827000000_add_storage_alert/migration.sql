-- AlterTable
ALTER TABLE "retention_settings" ADD COLUMN "storageAlertThresholdPct" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "retention_settings" ADD COLUMN "lastStorageAlertOn" TEXT;
