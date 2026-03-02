---
phase: quick-018
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/server-actions/solutions.ts
autonomous: true

must_haves:
  truths:
    - "Original request files appear only in Initial Request section"
    - "Solution files uploaded during form submission appear in Engineering Solution section"
    - "Files are correctly categorized based on upload timestamp vs status change timestamp"
  artifacts:
    - path: "src/server-actions/solutions.ts"
      provides: "submitSolution() with timestamp-based file linking logic"
      contains: "linkSolutionFiles logic"
  key_links:
    - from: "submitSolution()"
      to: "fileAttachment.updateMany"
      via: "timestamp comparison (file.createdAt > request.updatedAt when status became SentToEngineer)"
      pattern: "fileAttachment.*updateMany.*solutionId"
---

<objective>
Properly fix attachment linking in submitSolution() to distinguish between original request files and solution files using timestamps

Purpose: In quick task 017, we removed the file linking code that was setting solutionId on ALL request attachments. This fixed duplication but created a new problem: solution files uploaded during form submission don't appear in the solution's file list anymore.

Output: submitSolution() modified to link only recently uploaded files (those uploaded after SentToEngineer status) to the solution
</objective>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/quick/017-fix-attachment-duplication-bug/017-SUMMARY.md

# Current workflow:
1. User fills solution form and uploads files via confirmFileUpload → files saved with requestId set
2. User submits form → submitSolution() creates solution
3. [MISSING] Files uploaded during solution submission should be linked to solution

# The distinction:
- Original request files: uploaded when request was created (BEFORE status changed to SentToEngineer)
- Solution files: uploaded during solution form submission (AFTER status changed to SentToEngineer)

# How to distinguish:
Use timestamps! Check when the request status changed to SentToEngineer. Files uploaded AFTER that are solution files.
- Files uploaded BEFORE status change → Keep as request files (requestId only)
- Files uploaded AFTER status change → Convert to solution files (solutionId set, requestId cleared)

@src/server-actions/solutions.ts
@src/server-actions/files.ts
</context>

<tasks>

<task type="auto">
  <name>Modify submitSolution() to link recently uploaded files to solution</name>
  <files>src/server-actions/solutions.ts</files>
  <action>
    After solution is created (line 90), add logic to link files uploaded during solution submission:

    1. Get the request's updatedAt timestamp (this is when status changed to SentToEngineer)
    2. Find all fileAttachments where:
       - requestId matches the request
       - createdAt is AFTER the request's updatedAt
       - solutionId is null (not already linked)

    3. Update those files to:
       - Set solutionId to the newly created solution.id
       - Set requestId to null (clear request association to prevent duplication)

    Add this code after line 90 (after solution.create):

    ```typescript
    // Link files uploaded during solution submission to the solution
    // Files uploaded AFTER status changed to SentToEngineer are solution files
    const request = await tx.request.findUnique({
      where: { id: validated.requestId },
      select: { updatedAt: true },
    })

    if (request) {
      await tx.fileAttachment.updateMany({
        where: {
          requestId: validated.requestId,
          solutionId: null,
          createdAt: { gt: request.updatedAt },
        },
        data: {
          solutionId: solution.id,
          requestId: null,
        },
      })
    }
    ```

    This ensures:
    - Original request files (uploaded before status change) keep requestId only
    - Solution files (uploaded after status change) get solutionId set and requestId cleared
  </action>
  <verify>
    Test the solution submission flow:
    1. Create a request with attachments (these should appear in Initial Request section)
    2. Submit a solution with new attachments (these should appear in Engineering Solution section)
    3. Verify in database: original files have requestId only, solution files have solutionId only
    4. Check UI: files are correctly grouped in their respective sections
  </verify>
  <done>
    Original request files appear only in Initial Request section, solution files appear only in Engineering Solution section
  </done>
</task>

</tasks>

<verification>
- Solution files uploaded during form submission appear in solution's file list
- Original request files are NOT duplicated in solution's file list
- Database query shows correct ownership: requestId-only for request files, solutionId-only for solution files
</verification>

<success_criteria>
- submitSolution() links recently uploaded files to solution based on timestamp
- No file duplication occurs
- Solution files appear in Engineering Solution section
- Request files appear only in Initial Request section
</success_criteria>

<output>
After completion, create `.planning/quick/018-properly-fix-attachment-linking-in-submi/018-SUMMARY.md`
</output>
