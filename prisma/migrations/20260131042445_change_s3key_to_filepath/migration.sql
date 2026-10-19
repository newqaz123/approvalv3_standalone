/*
  Warnings:

  - You are about to drop the column `s3Key` on the `file_attachments` table. All the data in the column will be lost.
  - Added the required column `filePath` to the `file_attachments` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "file_attachments" DROP COLUMN "s3Key",
ADD COLUMN     "filePath" TEXT NOT NULL;
