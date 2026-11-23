ALTER TABLE "users"
  ADD COLUMN "preferredLocale" TEXT NOT NULL DEFAULT 'en',
  ADD CONSTRAINT "users_preferredLocale_check" CHECK ("preferredLocale" IN ('en', 'th'));
