
- after cancelled it shouldn't shown any reject.because it cancelled
- pending test 14: Requester cancel request at any status with no approving.
- /engineering dashboard add filter PIC engineer
- resubmit should remember the previous data filled(work) and custom hierarchy setting(if any)
- /requests and /dashboard_pending my approval sector reject solution badge(x) stuggle even after approved.
- design /analytics page i think it's not beauty and useless. use skill
navbar of engineer

- Do not hardcode!! check-dept-approvers.ts
  ```
  const allApprovers = await prisma.departmentApprover.findMany({
  const allApprovers = await prisma.department_approvers.findMany({
    include: {
14 hidden lines
  // Check specifically for userpd1
  const userpd1Approvers = await prisma.departmentApprover.findMany({
  const userpd1Approvers = await prisma.department_approvers.findMany({
    ```
- click need approve notification and it open old new approval page instead of new one.




## Achitecture
### submitter-modal.tsx 
 - mode: 'request', 'solution', 'resubmit' 

### solution-modal.tsx 
- used for DesignCostEstimationApproval(under approval) and SolutionApproved status

### completed-solution-modal.tsx
- used for SendBackToRequester status.

### submit-final-approval-modal.tsx
- used for SendFinalApproval status.

### completed-final-approval-modal.tsx
- used for Completed status.  

### request-modal-router.tsx 
- client-side React component responsible for dynamically displaying the correct modal interface depending on the state of a request (e.g., pending approval, awaiting solution, completed) and the current user’s role and permissions.