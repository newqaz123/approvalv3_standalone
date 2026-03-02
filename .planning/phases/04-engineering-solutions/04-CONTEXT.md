# Phase 4: Engineering Solutions - Context

**Gathered:** 2026-02-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Engineering users submit solutions with cost estimates, timeline, and files that route through configurable approval hierarchies (default or custom) back to requesters for final department approval before completion.

</domain>

<decisions>
## Implementation Decisions

### Solution submission form
- **Fields required:** Title (auto-generated from request), description, cost estimate (required), timeline (optional), concept design description (optional textarea), file attachments (multiple)
- **Cost estimate:** Numeric field with currency selector (THB only initially)
- **Cost validation:** Must be positive number (greater than 0)
- **Timeline format:** Free text field (e.g., "2-3 weeks", "next month")
- **Concept design:** Optional textarea for describing design concept/approach
- **File types:** Any file type allowed for engineering (no restrictions)
- **Draft mode:** No draft saving - must complete form in one session
- **Edit after submission:** No editing allowed - submission is final (would need to cancel/resubmit)
- **Preview step:** Yes - show summary before final submission
- **Form access:** Available from both request detail page AND engineering dashboard
- **Original request context:** Link to view full request detail, not embedded in form

### Engineering workflow visibility
- **Request discovery:** Engineering uses main request list with filters + dedicated "Needs My Action" page
- **Needs My Action shows:**
  - Engineering department users: SentToEngineer status + solutions not yet submitted
  - Approvers (in hierarchy): Solutions pending their approval
- **List columns:** Same as requester view + Person in Charge selector (multi-select, anyone in engineering) + submission status (pending approval/not submitted yet)
- **Person in Charge:** Informational only - doesn't restrict who can submit solution
- **Filters available:**
  - All filters that general department users have (status, date range, search, etc.)
  - Department filter (originating department)
  - Person in Charge filter (includes "unassigned" option)
  - Use dropdown filter, no "My Assigned" quick filter
- **Solution visibility before approval:** Requesters see submitted solutions read-only during engineering approval process
- **Approval history visibility:** Engineering sees full department approval history (who approved, comments)

### Solution routing & approval
- **Approval hierarchy options:**
  - Default: Use configured engineering department hierarchy (any-one-per-level logic from Phase 3)
  - Custom: Create sequential approval chain when submitting solution (search for specific people)
- **Custom hierarchy selector:** Sequential list of approvers (Person A → Person B → Person C)
- **Custom hierarchy validation:**
  - If submitter is in approval chain, automatically skip them (don't block submission)
  - Each person can only appear once (unique only)
  - Custom hierarchy replaces default (not additive)
- **Fallback behavior:** If no custom hierarchy specified, uses default engineering hierarchy
- **Rejection flow:**
  - Engineering approvers can reject with optional comment
  - Rejection returns request to SentToEngineer status
  - Custom hierarchy is preserved but can be changed on resubmission
  - Full rejection history visible in timeline to all approvers

### Requester notification & review
- **Solution ready notification:** Both email and in-app notification to requester when status changes to SendBackToRequester
- **Email content:** Minimal - "solution is ready" + link to view request (no full details in email)
- **Requester actions:** View only (no accept/reject) + can add comments while in SendBackToRequester
- **Final approval flow:**
  - Any department user can route solution for final approval from SendBackToRequester
  - Status changes to FinalApproval during final approval process
  - Can use default department hierarchy OR create custom approval chain
  - Department approvers can reject back to engineering (returns to SentToEngineer)
  - Email notifications sent to approvers when they have a solution to approve in FinalApproval
  - After final approval completes → status changes to Completed

### Claude's Discretion
- In-app notification UI design (bell/badge pattern)
- Comment thread UI and placement
- Person in Charge selector component design
- Custom hierarchy builder UX (drag-and-drop vs sequential selector)

</decisions>

<specifics>
## Specific Ideas

- Three-stage approval process: Department approval → Engineering solution → Final department approval
- Custom hierarchies provide flexibility for special cases requiring specific approvers
- Person in Charge is visibility feature, not access control (anyone can submit)
- Rejection loops back to engineering, not to intermediate states

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 04-engineering-solutions*
*Context gathered: 2026-02-01*
