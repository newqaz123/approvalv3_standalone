---
phase: quick-019
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/server-actions/solutions.ts
autonomous: true
user_setup: []

must_haves:
  truths:
    - "Solution file linking uses actual SentToEngineer status change timestamp"
    - "Files uploaded AFTER first SentToEngineer status change are linked to solution"
    - "Files uploaded BEFORE first SentToEngineer status change remain with request"
    - "Multiple status changes do not break file linking logic"
  artifacts:
    - path: "src/server-actions/solutions.ts"
      provides: "submitSolution() with activity log timestamp query"
      contains: "requestActivity.findFirst with toStatus: 'SentToEngineer'"
  key_links:
    - from: "submitSolution()"
      to: "RequestActivity table"
      via: "findFirst with orderBy: { createdAt: 'asc' }"
      pattern: "requestActivity.*toStatus.*SentToEngineer"
---

<objective>
Fix the file linking logic in submitSolution() to properly determine when status changed to SentToEngineer. Currently uses request.updatedAt which is wrong when there are multiple status changes. Instead, query the activity log to find the FIRST status change to SentToEngineer.

Purpose: Ensure solution files are correctly identified even when request has multiple status changes (e.g., auto-approval → requester uploads file → solution submission)
Output: Activity log-based timestamp query for accurate file categorization
</objective>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/quick/018-properly-fix-attachment-linking-in-submi/018-SUMMARY.md
@src/server-actions/solutions.ts

# The Bug

In quick task 018, we modified submitSolution() to use `request.updatedAt` to determine when status changed to "SentToEngineer". This works for most cases, but fails when:

1. Request is auto-approved by top-level user (status changes to SentToEngineer within 1 second)
2. Requester uploads file AFTER auto-approval but BEFORE solution submission
3. Status changes again (e.g., to SendBackToRequester) when solution is submitted

**Example from database:**
- Request "test attach" created at 09:37:11
- Auto-approved → status changed to SentToEngineer at 09:37:12 (1 second later!)
- Pattawat uploaded IMG_7108.jpeg at 09:37:14 (thinking it was still initial stage)
- Solution submitted at 09:39:47
- Status changed to SendBackToRequester at 09:39:47

**Current buggy code (lines 78-112):**
```typescript
// Get the request to check when status changed to SentToEngineer
const requestData = await tx.request.findUnique({
  where: { id: validated.requestId },
  select: { updatedAt: true },
})

// Uses requestData.updatedAt (09:39:47 - the LAST status change!)
```

**The Fix:**
Query the activity log to find the ACTUAL timestamp when status first changed to "SentToEngineer":

```typescript
// Find when status first changed to SentToEngineer
const statusChangeActivity = await tx.requestActivity.findFirst({
  where: {
    requestId: validated.requestId,
    action: 'status_changed',
    toStatus: 'SentToEngineer',
  },
  select: {
    createdAt: true,
  },
  orderBy: {
    createdAt: 'asc', // Get the FIRST status change to SentToEngineer
  },
})

const sentToEngineerAt = statusChangeActivity?.createdAt
```

Then use `sentToEngineerAt` instead of `requestData.updatedAt` for the comparison.
</context>

<tasks>

<task type="auto">
  <name>Modify submitSolution() to use activity log for SentToEngineer timestamp</name>
  <files>src/server-actions/solutions.ts</files>
  <action>
    In submitSolution() function, in the transaction block (after line 77):

    1. REMOVE the existing code that queries request.updatedAt (lines 78-82):
    ```typescript
    const requestData = await tx.request.findUnique({
      where: { id: validated.requestId },
      select: { updatedAt: true },
    })
    ```

    2. ADD new query to find the FIRST status change to SentToEngineer from activity log:
    ```typescript
    // Find when status first changed to SentToEngineer (from activity log)
    const statusChangeActivity = await tx.requestActivity.findFirst({
      where: {
        requestId: validated.requestId,
        action: 'status_changed',
        toStatus: 'SentToEngineer',
      },
      select: {
        createdAt: true,
      },
      orderBy: {
        createdAt: 'asc', // Get the FIRST status change to SentToEngineer
      },
    })

    const sentToEngineerAt = statusChangeActivity?.createdAt
    ```

    3. UPDATE the file linking query (lines 100-112) to use `sentToEngineerAt`:
    ```typescript
    // Link files uploaded AFTER status changed to SentToEngineer to the solution
    if (sentToEngineerAt) {
      await tx.fileAttachment.updateMany({
        where: {
          requestId: validated.requestId,
          solutionId: null,
          createdAt: { gt: sentToEngineerAt },
        },
        data: {
          solutionId: solution.id,
          requestId: null,
        },
      })
    }
    ```

    This ensures we use the ACTUAL timestamp when status first changed to SentToEngineer, not the latest request.updatedAt which changes on every status update.
  </action>
  <verify>
    Check that:
    1. Code compiles: `npm run build`
    2. No TypeScript errors in solutions.ts
    3. Query uses requestActivity table with action: 'status_changed' and toStatus: 'SentToEngineer'
    4. Query orders by createdAt: 'asc' to get FIRST occurrence
    5. File linking uses sentToEngineerAt instead of requestData.updatedAt
  </verify>
  <done>
    File linking logic correctly identifies when status first changed to SentToEngineer, even with multiple status changes. Solution files uploaded after SentToEngineer status are properly linked to solution.
  </done>
</task>

</tasks>

<verification>
- Code compiles without TypeScript errors
- Activity log query is correctly structured with action, toStatus, and orderBy
- sentToEngineerAt timestamp is used for file comparison
- Edge case handled: if statusChangeActivity is null, sentToEngineerAt is undefined and no files are linked (correct behavior)
</verification>

<success_criteria>
- submitSolution() queries requestActivity table for SentToEngineer status change
- Activity log query finds FIRST occurrence (orderBy createdAt: 'asc')
- File linking uses sentToEngineerAt timestamp instead of request.updatedAt
- Files uploaded after actual SentToEngineer timestamp are linked to solution
- Multiple status changes no longer break file linking logic
</success_criteria>

<output>
After completion, create `.planning/quick/019-fix-file-linking-use-activity-log-timest/019-SUMMARY.md`
</output>
