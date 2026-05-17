

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