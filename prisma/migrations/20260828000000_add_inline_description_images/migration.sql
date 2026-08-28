BEGIN;

CREATE TABLE "inline_description_images" (
  "id" TEXT NOT NULL,
  "uploadedById" TEXT NOT NULL,
  "uploadSessionId" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "fileType" TEXT NOT NULL,
  "originalSize" INTEGER NOT NULL,
  "fileSize" INTEGER NOT NULL,
  "filePath" TEXT NOT NULL,
  "width" INTEGER NOT NULL,
  "height" INTEGER NOT NULL,
  "deletionPendingAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inline_description_images_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "inline_description_image_references" (
  "id" TEXT NOT NULL,
  "imageId" TEXT NOT NULL,
  "requestId" TEXT,
  "solutionId" TEXT,
  "templateId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inline_description_image_references_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inline_image_reference_exactly_one_owner"
    CHECK (num_nonnulls("requestId", "solutionId", "templateId") = 1)
);

CREATE INDEX "inline_description_images_uploadedById_idx" ON "inline_description_images"("uploadedById");
CREATE INDEX "inline_description_images_uploadSessionId_idx" ON "inline_description_images"("uploadSessionId");
CREATE INDEX "inline_description_images_createdAt_idx" ON "inline_description_images"("createdAt");
CREATE INDEX "inline_description_images_deletionPendingAt_idx" ON "inline_description_images"("deletionPendingAt");
CREATE INDEX "inline_description_image_references_imageId_idx" ON "inline_description_image_references"("imageId");
CREATE INDEX "inline_description_image_references_requestId_idx" ON "inline_description_image_references"("requestId");
CREATE INDEX "inline_description_image_references_solutionId_idx" ON "inline_description_image_references"("solutionId");
CREATE INDEX "inline_description_image_references_templateId_idx" ON "inline_description_image_references"("templateId");
CREATE UNIQUE INDEX "inline_description_image_references_imageId_requestId_key" ON "inline_description_image_references"("imageId", "requestId");
CREATE UNIQUE INDEX "inline_description_image_references_imageId_solutionId_key" ON "inline_description_image_references"("imageId", "solutionId");
CREATE UNIQUE INDEX "inline_description_image_references_imageId_templateId_key" ON "inline_description_image_references"("imageId", "templateId");

ALTER TABLE "inline_description_images"
  ADD CONSTRAINT "inline_description_images_uploadedById_fkey"
  FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inline_description_image_references"
  ADD CONSTRAINT "inline_description_image_references_imageId_fkey"
  FOREIGN KEY ("imageId") REFERENCES "inline_description_images"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inline_description_image_references"
  ADD CONSTRAINT "inline_description_image_references_requestId_fkey"
  FOREIGN KEY ("requestId") REFERENCES "requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inline_description_image_references"
  ADD CONSTRAINT "inline_description_image_references_solutionId_fkey"
  FOREIGN KEY ("solutionId") REFERENCES "solutions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inline_description_image_references"
  ADD CONSTRAINT "inline_description_image_references_templateId_fkey"
  FOREIGN KEY ("templateId") REFERENCES "templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
