---
phase: quick-017
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/server-actions/solutions.ts
autonomous: true
must_haves:
  truths:
    - "Files uploaded with initial request only appear in Initial Request section"
    - "Files uploaded during solution submission only appear in Engineering Solution section"
    - "Existing duplicate data in database is cleaned up"
  artifacts:
    - path: "src/server-actions/solutions.ts"
      provides: "Fixed submitSolution() function"
      changes: "Lines 96-103 no longer add solutionId to ALL request attachments"
    - path: "scripts/fix-attachment-duplicates.ts"
      provides: "Database cleanup script"
      exports: ["fixAttachmentDuplicates()"]
    - path: "src/server-actions/files.ts"
      provides: "Enhanced file upload for solution-specific files"
      exports: ["confirmSolutionFileUpload()"]
  key_links:
    - from: "src/server-actions/solutions.ts"
      to: "src/server-actions/files.ts"
      via: "confirmSolutionFileUpload import"
      pattern: "confirmSolutionFileUpload"
---

<objective>
Fix attachment duplication bug where files appear in both Initial Request and Engineering Solution sections.

**Purpose:** The current implementation incorrectly adds `solutionId` to ALL files with a given `requestId` when a solution is submitted, causing the same file to appear in both sections. This creates confusion and data integrity issues.

**Root Cause:** In `solutions.ts` lines 96-103, the `updateMany` query sets `solutionId` on ALL files with that `requestId`, including the original request files that should only have `requestId` set.

**Desired Behavior:**
- Initial request files: `requestId` set, `solutionId` null
- Solution-specific files: `solutionId` set, `requestId` null
- Schema supports polymorphic relations (one file belongs to EITHER request OR solution, not both)

**Output:**
1. Fixed `submitSolution()` to NOT modify existing request attachments
2. New `confirmSolutionFileUpload()` for solution-specific file uploads
3. Database cleanup script to fix existing duplicates
</objective>

<execution_context>
@./.clue/get-shit-done/workflows/execute-plan.md
@./.clue/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@prisma/schema.prisma
@src/server-actions/solutions.ts
@src/server-actions/files.ts
@scripts/check-attachment-duplicates.ts
</context>

<tasks>

<task type="auto">
  <name>Fix submitSolution() to preserve request attachment ownership</name>
  <files>src/server-actions/solutions.ts</files>
  <action>
    Remove lines 92-103 (the problematic updateMany that adds solutionId to ALL request attachments).

    The submitSolution function should NOT link file attachments to solutions at all. File linking happens during upload via confirmFileUpload or the new confirmSolutionFileUpload.

    Delete this block from the transaction:
    ```typescript
    // Link file attachments to this solution
    // This includes:
    // 1. New files uploaded for this submission (solutionId: null)
    // 2. Files from previous solution that weren't deleted (for resubmission)
    await tx.fileAttachment.updateMany({
      where: {
        requestId: validated.requestId,
      },
      data: {
        solutionId: solution.id,
      },
    })
    ```

    This ensures:
    - Request attachments keep only `requestId` set
    - Solution attachments will be uploaded with only `solutionId` set (via new function)
    - No files have both fields set (eliminates duplication)
  </action>
  <verify>
  Run `grep -n "solutionId: solution.id" src/server-actions/solutions.ts` and confirm no updateMany exists that sets solutionId based on requestId.
  </verify>
  <done>
  The submitSolution() function no longer modifies file attachment ownership. Request files remain with requestId only.
  </done>
</task>

<task type="auto">
  <name>Add confirmSolutionFileUpload() for solution-specific file uploads</name>
  <files>src/server-actions/files.ts</files>
  <action>
    Add a new function `confirmSolutionFileUpload()` after `confirmFileUpload()` (around line 183).

    This function is similar to confirmFileUpload but sets `solutionId` instead of `requestId`:

    ```typescript
    interface ConfirmSolutionFileUploadInput {
      solutionId: string
      fileId: string
      fileName: string
      fileType: string
      fileSize: number
      filePath: string
      description?: string
    }

    /**
     * Confirm file upload for engineering solution
     * Sets solutionId instead of requestId (prevents duplication)
     */
    export async function confirmSolutionFileUpload(input: ConfirmSolutionFileUploadInput) {
      const { userId } = await auth()

      if (!userId) {
        throw new Error('Unauthorized')
      }

      // Verify solution exists
      const solution = await prisma.solution.findUnique({
        where: { id: input.solutionId },
        select: { requestId: true },
      })

      if (!solution) {
        throw new Error('Solution not found')
      }

      // Save file metadata to database with solutionId (NOT requestId)
      const fileAttachment = await prisma.fileAttachment.create({
        data: {
          id: input.fileId,
          solutionId: input.solutionId,  // Set solutionId, not requestId
          requestId: null,  // Explicitly null to prevent duplication
          fileName: input.fileName,
          fileType: input.fileType,
          fileSize: input.fileSize,
          filePath: input.filePath,
          description: input.description,
          uploadedById: userId,
        },
      })

      // Log file attachment in audit trail
      await prisma.requestActivity.create({
        data: {
          requestId: solution.requestId,
          action: 'file_attached',
          comments: `Solution file attached: ${input.fileName}`,
          userId,
        },
      })

      // Revalidate to refresh UI
      const { revalidatePath } = await import('next/cache')
      revalidatePath('/requests')
      revalidatePath('/engineering')

      return { success: true, fileAttachment }
    }
    ```

    This ensures solution files have `solutionId` set and `requestId` null, preventing them from appearing in the request's file list.
  </action>
  <verify>
  Run `grep -n "confirmSolutionFileUpload" src/server-actions/files.ts` and confirm function exists.
  Run `grep -n "solutionId: input.solutionId" src/server-actions/files.ts` and confirm it sets solutionId with requestId: null.
  </verify>
  <done>
  New confirmSolutionFileUpload() function creates file attachments with solutionId set and requestId null, preventing duplication.
  </done>
</task>

<task type="auto">
  <name>Create database cleanup script to fix existing duplicates</name>
  <files>scripts/fix-attachment-duplicates.ts</files>
  <action>
    Create a new script `scripts/fix-attachment-duplicates.ts` that:

    1. Identifies all files with both `requestId` AND `solutionId` set
    2. For each duplicate, determines whether it's a request file or solution file:
       - If uploaded BEFORE the solution was created: it's a request file (clear solutionId)
       - If uploaded AFTER the solution was created: it's a solution file (clear requestId)
    3. Updates the database to remove the duplicate field
    4. Logs all changes made

    Script structure:
    ```typescript
    import { PrismaClient } from '@prisma/client'

    const prisma = new PrismaClient()

    async function fixAttachmentDuplicates() {
      console.log('Finding and fixing duplicate attachments...\n')

      // Find all attachments with both requestId and solutionId set
      const duplicates = await prisma.fileAttachment.findMany({
        where: {
          AND: [
            { requestId: { not: null } },
            { solutionId: { not: null } },
          ],
        },
        include: {
          solution: {
            select: {
              id: true,
              createdAt: true,
            },
          },
        },
      })

      console.log(`Found ${duplicates.length} duplicate attachments to fix\n`)

      let fixedCount = 0

      for (const attachment of duplicates) {
        const fileCreatedAt = attachment.createdAt
        const solutionCreatedAt = attachment.solution!.createdAt

        // If file was uploaded before solution, it's a request file
        // If file was uploaded after solution, it's a solution file
        const isRequestFile = fileCreatedAt < solutionCreatedAt

        if (isRequestFile) {
          // Clear solutionId to make it a request-only file
          await prisma.fileAttachment.update({
            where: { id: attachment.id },
            data: { solutionId: null },
          })
          console.log(`✅ Fixed: ${attachment.fileName} (request file, cleared solutionId)`)
        } else {
          // Clear requestId to make it a solution-only file
          await prisma.fileAttachment.update({
            where: { id: attachment.id },
            data: { requestId: null },
          })
          console.log(`✅ Fixed: ${attachment.fileName} (solution file, cleared requestId)`)
        }

        fixedCount++
      }

      console.log(`\n✅ Fixed ${fixedCount} duplicate attachments`)
    }

    fixAttachmentDuplicates()
      .then(() => {
        console.log('\n✅ Cleanup complete')
        process.exit(0)
      })
      .catch((error) => {
        console.error('❌ Error:', error)
        process.exit(1)
      })
      .finally(async () => {
        await prisma.$disconnect()
      })
    ```

    After creating the script, run it with: `npx tsx scripts/fix-attachment-duplicates.ts`
  </action>
  <verify>
  1. Run `npx tsx scripts/check-attachment-duplicates.ts` and confirm "Attachments with BOTH requestId AND solutionId: 0"
  2. Check the fix script output shows "Fixed X duplicate attachments" where X > 0
  </verify>
  <done>
  All existing duplicate attachments are cleaned up. Files now have either requestId OR solutionId set, never both.
  </done>
</task>

</tasks>

<verification>
1. Run `npx tsx scripts/check-attachment-duplicates.ts` - should show 0 attachments with both requestId and solutionId
2. Test solution submission workflow:
   - Create a request with files
   - Submit solution with NEW files (not the request files)
   - Verify request files appear only in "Initial Request" section
   - Verify solution files appear only in "Engineering Solution" section
3. Run the cleanup script on existing data: `npx tsx scripts/fix-attachment-duplicates.ts`
4. Verify no files appear in both sections in the UI
</verification>

<success_criteria>
- submitSolution() no longer modifies existing file attachments
- confirmSolutionFileUpload() creates solution-only file attachments
- Database cleanup script fixes all existing duplicates
- All files have exactly ONE owner (requestId OR solutionId, never both)
- No duplicate files appear in the request detail modal
</success_criteria>

<output>
After completion, create `.planning/quick/017-fix-attachment-duplication-bug/017-SUMMARY.md`
</output>
