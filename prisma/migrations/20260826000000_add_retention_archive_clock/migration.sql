-- AlterTable
ALTER TABLE "retention_settings" ADD COLUMN "archiveHour" INTEGER NOT NULL DEFAULT 2;
ALTER TABLE "retention_settings" ADD COLUMN "archiveMinute" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "retention_settings" ADD COLUMN "lastArchiveRunOn" TEXT;
