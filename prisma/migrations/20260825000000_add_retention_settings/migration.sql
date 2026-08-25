-- CreateTable
CREATE TABLE "retention_settings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "archiveEnabled" BOOLEAN NOT NULL DEFAULT true,
    "archiveAfterDays" INTEGER NOT NULL DEFAULT 90,
    "archiveStatuses" JSONB NOT NULL,
    "cleanupAfterDays" INTEGER NOT NULL DEFAULT 365,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "retention_settings_pkey" PRIMARY KEY ("id")
);
