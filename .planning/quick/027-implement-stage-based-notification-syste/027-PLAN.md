---
phase: quick-027
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/server-actions/notifications.ts
  - src/server-actions/approvals.ts
  - src/server-actions/requests.ts
  - src/server-actions/solutions.ts
autonomous: true

must_haves:
  truths:
    - "Requester receives notification when their request is rejected with reason"
    - "All engineering users receive notification when request is approved and sent to engineering"
    - "Assigned engineers receive notification when they are assigned as PIC"
    - "All users in requester's department receive notification when solution is ready for final review"
    - "All users in requester's department receive notification when request is completed"
    - "All engineering users receive notification when final approval is rejected with reason"
  artifacts:
    - path: "src/server-actions/notifications.ts"
      provides: "notifyUsersInDepartment helper function"
      contains: "export async function notifyUsersInDepartment"
    - path: "src/server-actions/approvals.ts"
      provides: "ImprovementRequest and SentToEngineer notifications"
      contains: "await createNotification"
    - path: "src/server-actions/requests.ts"
      provides: "Engineer PIC assignment notifications"
      contains: "await createNotification"
    - path: "src/server-actions/solutions.ts"
      provides: "SendBackToRequester, Completed, and Final Rejection notifications"
      contains: "await notifyUsersInDepartment"
  key_links:
    - from: "src/server-actions/approvals.ts"
      to: "prisma.notification"
      via: "createNotification"
      pattern: "await createNotification.*approval_rejected|request_assigned"
    - from: "src/server-actions/requests.ts"
      to: "prisma.notification"
      via: "createNotification loop"
      pattern: "engineerIds\\.forEach.*createNotification"
    - from: "src/server-actions/solutions.ts"
      to: "notifyUsersInDepartment"
      via: "department-wide notifications"
      pattern: "await notifyUsersInDepartment.*request\\.departmentId"
---

<objective>
Implement stage-based notification system with targeted notifications for each approval workflow transition.

Purpose: Replace generic notifications with specific, targeted notifications that reach the correct audience at each stage, improving visibility and accountability.
Output: 6 new targeted notifications (rejection, assignment, department-wide alerts) with reusable helper function.
</objective>

<execution_context>
@~/.config/opencode/get-shit-done/workflows/execute-plan.md
@~/.config/opencode/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md

# Existing infrastructure
@src/server-actions/notifications.ts
@src/server-actions/approvals.ts
@src/server-actions/requests.ts
@src/server-actions/solutions.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add notifyUsersInDepartment helper function</name>
  <files>src/server-actions/notifications.ts</files>
  <action>
Add the following helper function to notifications.ts after the createNotification function (around line 145):

```typescript
/**
 * Notify all users in a department (with optional exclusions)
 */
export async function notifyUsersInDepartment(
  departmentId: string,
  notification: {
    type: 'approval_needed' | 'approval_granted' | 'approval_rejected' | 'status_changed' | 'request_assigned' | 'solution_ready' | 'final_approval_needed'
    title: string
    message: string
    requestId?: string
  },
  excludeUserIds?: string[]
) {
  // Get all active users in the department
  const users = await prisma.user.findMany({
    where: {
      departmentId,
      isActive: true,
      ...(excludeUserIds && excludeUserIds.length > 0 ? {
        id: { notIn: excludeUserIds }
      } : {})
    },
    select: { id: true },
  })

  // Create notifications for each user
  await Promise.all(
    users.map(user =>
      createNotification({
        userId: user.id,
        type: notification.type,
        title: notification.title,
        message: notification.message,
        requestId: notification.requestId,
      })
    )
  )

  return { notified: users.length }
}
```

Also add import for TransactionClient type if needed (or use Prisma transaction parameter).
  </action>
  <verify>
Check that function compiles: `npx tsc --noEmit`
  </verify>
  <done>
Helper function notifyUsersInDepartment exists and can create notifications for all users in a department.
  </done>
</task>

<task type="auto">
  <name>Task 2: Add notifications to approvals.ts and requests.ts</name>
  <files>src/server-actions/approvals.ts, src/server-actions/requests.ts</files>
  <action>
1. In approvals.ts rejectRequest() (around line 382, after logging activity):
   - Import createNotification from notifications.ts
   - Get request title before updating: query request.title
   - Add notification creation after line 382:
   ```typescript
   // Get request for notification
   const request = await prisma.request.findUnique({
     where: { id: requestId },
     select: { title: true, requesterId: true },
   })

   if (request) {
     await createNotification({
       userId: request.requesterId,
       type: 'approval_rejected',
       title: 'Request Rejected',
       message: `❌ Request Rejected: Your request "${request.title}" has been rejected. Reason: "${comments}"`,
       requestId,
     })
   }
   ```

2. In approvals.ts changeRequestStatus() (replace lines 442-450):
   - For ImprovementRequest → SentToEngineer case, replace with:
   ```typescript
   // Get engineering department
   const engineeringDept = await prisma.department.findFirst({
     where: { type: 'ENGINEERING' },
     select: { id: true },
   })

   if (newStatus === 'SentToEngineer' && engineeringDept) {
     // Notify all engineering users
     const { notifyUsersInDepartment } = await import('./notifications')
     await notifyUsersInDepartment(
       engineeringDept.id,
       {
         type: 'request_assigned',
         title: 'New Task Available',
         message: `🔧 New Task Available: "${request.title}" has been approved and needs engineering solution.`,
         requestId,
       }
     )
   } else {
     // Other status changes - notify requester
     await createNotification({
       userId: request.requesterId,
       type: 'status_changed',
       title: 'Request Status Changed',
       message: `Your request status changed to ${newStatus}`,
       requestId,
     })
   }
   ```

3. In requests.ts assignEngineers() (after line 1573, after createMany):
   - Import createNotification from notifications.ts
   - Get request title before the transaction
   - Add notification loop:
   ```typescript
   // Get request for notification
   const request = await prisma.request.findUnique({
     where: { id: requestId },
     select: { title: true },
   })

   // Notify assigned engineers
   if (engineerIds.length > 0 && request) {
     const { createNotification } = await import('./notifications')
     await Promise.all(
       engineerIds.map(engineerId =>
         createNotification({
           userId: engineerId,
           type: 'request_assigned',
           title: 'PIC Assignment',
           message: `👤 PIC Assignment: You have been assigned to "${request.title}". Please review and submit your solution.`,
           requestId,
         })
       )
     )
   }
   ```
  </action>
  <verify>
Type check: `npx tsc --noEmit`
  </verify>
  <done>
3 notifications implemented: ImprovementRequest rejection, SentToEngineer (to all engineers), Engineer PIC assignment.
  </done>
</task>

<task type="auto">
  <name>Task 3: Add notifications to solutions.ts for department-wide alerts</name>
  <files>src/server-actions/solutions.ts</files>
  <action>
1. In approveSolution() (replace line 685, the requester-only notification):
   - Replace with department-wide notification:
   ```typescript
   // Notify all users in requester's department
   const { notifyUsersInDepartment } = await import('./notifications')
   await notifyUsersInDepartment(
     request.departmentId,
     {
       type: 'solution_ready',
       title: 'Solution Ready for Review',
       message: `📤 Ready for Review: "${request.title}" has been completed and awaits your department's final review.`,
       requestId: solutionData.requestId,
     }
   )
   ```

2. In approveFinalApproval() (replace line 1504, and line 1104 for auto-complete case):
   - First location (around line 1104, auto-complete case):
   ```typescript
   // Get engineering department to exclude engineers from requester dept notification
   const engineeringDept = await tx.department.findFirst({
     where: { type: 'ENGINEERING' },
     select: { id: true },
   })

   // Get engineering users to exclude
   const engineeringUsers = engineeringDept
     ? await tx.user.findMany({
         where: { departmentId: engineeringDept.id },
         select: { id: true },
       })
     : []

   const engineeringUserIds = engineeringUsers.map(u => u.id)

   // Notify all users in requester's department (except engineering users)
   const { notifyUsersInDepartment } = await import('./notifications')
   await notifyUsersInDepartment(
     request.departmentId,
     {
       type: 'approval_granted',
       title: 'Request Completed',
       message: `✅ Request Completed: "${request.title}" has been fully approved and completed.`,
       requestId,
     },
     engineeringUserIds // Exclude engineering users (they don't need completion notification)
   )
   ```

   - Second location (around line 1504, regular approval complete):
   ```typescript
   // Same department-wide notification code as above
   const engineeringDept = await tx.department.findFirst({
     where: { type: 'ENGINEERING' },
     select: { id: true },
   })

   const engineeringUsers = engineeringDept
     ? await tx.user.findMany({
         where: { departmentId: engineeringDept.id },
         select: { id: true },
       })
     : []

   const engineeringUserIds = engineeringUsers.map(u => u.id)

   const { notifyUsersInDepartment } = await import('./notifications')
   await notifyUsersInDepartment(
     request.departmentId,
     {
       type: 'approval_granted',
       title: 'Request Completed',
       message: `✅ Request Completed: "${request.title}" has been fully approved and completed.`,
       requestId,
     },
     engineeringUserIds
   )
   ```

3. In rejectFinalApproval() (extend line 1616 to notify all engineers):
   - Replace single notification with department-wide notification to engineering:
   ```typescript
   // Get engineering department
   const engineeringDept = await tx.department.findFirst({
     where: { type: 'ENGINEERING' },
     select: { id: true },
   })

   if (engineeringDept && solution) {
     const { notifyUsersInDepartment } = await import('./notifications')
     await notifyUsersInDepartment(
       engineeringDept.id,
       {
         type: 'approval_rejected',
         title: 'Final Approval Rejected',
         message: `❌ Final Rejection: "${request.title}" was rejected during final approval. Reason: "${comments}". Please revise the solution.`,
         requestId,
       }
     )
   }
   ```
  </action>
  <verify>
Type check: `npx tsc --noEmit`
  </verify>
  <done>
3 department-wide notifications implemented: SendBackToRequester (to requester dept), Completed (to requester dept), Final Rejection (to all engineers).
  </done>
</task>

</tasks>

<verification>
Test each notification flow by triggering stage transitions and verifying recipients:
1. Reject ImprovementRequest → requester receives notification with reason
2. Approve ImprovementRequest → all engineering users receive assignment notification
3. Assign engineers → assigned engineers receive PIC notification
4. Approve solution → all users in requester's department receive solution ready notification
5. Complete final approval → all users in requester's department receive completion notification
6. Reject final approval → all engineering users receive rejection notification with reason
</verification>

<success_criteria>
All 6 targeted notifications are implemented and working:
- Notifications reach correct audiences (requester, engineers, or department-wide)
- Messages include relevant details (title, reason where applicable)
- No duplicate or missing notifications at any stage transition
- Type checking passes without errors
</success_criteria>

<output>
After completion, create `.planning/quick/027-implement-stage-based-notification-syste/027-SUMMARY.md`
</output>
