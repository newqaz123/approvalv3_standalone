# Organization, approval routes, and visibility redesign

Date: 2026-09-05
Status: Approved for implementation planning; implementation is not authorized by this document.

## Objective

Separate organizational reporting, configurable approval workflows, and document approval instances. Remove department-membership workarounds while preserving existing business actions and custom cross-check chains.

## Approved requirements

- Positions: Staff (1), Supervisor (2), Section Manager (3), Department Manager (4), Division Manager (5), Factory Manager (6).
- Existing departments represent future sections. Migration must use reviewed mappings, not assume names determine organizational type.
- Factory contains divisions, divisions contain departments, departments contain sections. Reporting/management scope is distinct from system permissions.
- A parent-unit manager covers descendant units without repeated main/additional section assignments. Factory Manager is assigned to the factory, not a fabricated section.
- A manager’s own request belongs to their managed organizational unit (confirmed after parent plan review). A parent-only manager does not select or belong to a section merely to submit. Preserve that request origin across solution/final phases.
- Normal approval routes travel upward within the submitter's reporting branch.
- Admins configure explicit approval positions and a maximum position level per organizational route. Not every intermediate level must approve.
- Vacant positions are skipped, not submission blockers. This supersedes the earlier mandatory-vacancy-block proposal.
- A submitter at or above the configured route maximum auto-approves the normal route. Existence of higher managers does not change that ceiling.
- Multiple eligible approvers at one normal step use any-one semantics: one successful approval advances once.
- Existing custom modal chains remain available as unrestricted ordered person lists for cross-check work. These are exceptions to upward-only routing and normal-route auto-approval.
- In-flight chains remain unchanged when organization or workflow settings change.
- Staff share visibility across their section. Managers see their managed unit and descendants. Factory Manager sees the factory's requests.
- Engineering retains broad operational read visibility, not blanket action permissions. Admin retains global visibility.
- Existing ownership, assignment, role, stage and status restrictions on actions remain the reference.

## Existing-code evidence

Read-only scouts inspected checkout a392f6b727e6e50f455b0c12b3e791a0f7faf25e on main using the existing graph and source.

- `prisma/schema.prisma`: flat departments, numeric user levels, external department approvers, request/solution approval rows.
- `src/lib/approval-levels.ts`: current numeric 1–10 occupied-level routing.
- `src/server-actions/approvals.ts`: request chain generation and live approval eligibility.
- `src/server-actions/solutions.ts`: solution and final routes, custom-person chains and auto-approval.
- `src/server-actions/requests.ts`: submission, resubmission, list and detail access.
- `src/lib/request-access.ts`: private-file read authorization.
- `src/lib/request-approval-transaction.ts`: approval transaction and sequential progression.
- Modal components and request modal router: existing custom chain entry points.

Important existing exceptions: initial request creation has no custom picker; solution/final flows do. Request resubmission regenerates its chain. Custom chains do not auto-approve. Current external request approvers can be serialized even at the same level, unlike internal any-one pools. Existing approval rows persist steps but normal eligibility can change with live user levels; this is not a fully frozen candidate snapshot.

## Approaches considered

1. Relabel existing numeric departments/levels: small change but retains duplicated manager assignments and couples scope to routing. Rejected.
2. Separate organization, versioned routes and instances while adapting existing execution and UI: recommended. Addresses the root model without replacing unrelated document lifecycle behavior.
3. Replace the full workflow engine and action model: unnecessary scope and substantial regression risk. Rejected.

## Proposed architecture

### Organization

Represent organizational units with stable IDs, unit types and parent relationships. Position assignments associate users with a management/reporting scope; system roles remain separate. Supervisor/staff reporting groups must identify the appropriate upward branch rather than treating every same-level employee in the factory as eligible.

Enforce acyclic organizational relationships and valid position/scope assignments. Multiple holders of an approving position within the appropriate scope form a candidate group. Do not hard-code unit names such as PD1 or Production.

Department Manager assigned to a parent department automatically covers its sections. An organizational assignment grants visibility over the relevant scope, not blanket permission to modify requests.

### Workflow definitions

A versioned route records its organizational scope, applicable document phase, explicit ordered positions and maximum approval level. Normal steps are ascending and cannot exceed the maximum. Support existing request, solution and final-approval phases without collapsing their business transitions.

Admin Settings exposes route editing, adding/removing steps, scope selection, maximum level and a preview for a selected submitter. Position ordering must be validated; drag-and-drop cannot create downward normal routing.

Resolve a single applicable route deterministically. The implementation plan must specify the scope-resolution mechanism and validate ambiguity before publishing; a published scope must not leave administrators guessing which route is used. Document-type/value conditions are an extensibility point, not authorization to invent thresholds or financial fields in this first delivery.

Publishing creates a new route version. Warnings identify unoccupied positions and show which steps will be skipped. An invalid or missing route is a configuration error, not equivalent to reaching the configured maximum. Vacancies alone do not block submission.

### Approval instances

Normal submission resolves the applicable route, excludes positions at/below the submitter, applies its ceiling, resolves the upward candidate groups, skips vacant positions and persists the resulting steps. If the submitter is at/above the ceiling, preserve the phase's auto-approval transition.

If vacancy skipping leaves no approval steps, complete the approval phase with the auditable `NO_ELIGIBLE_APPROVAL_STEPS` reason rather than leave a pending document with no approver. For NEW request, solution and final instances, this records the completion reason and preserves the phase's existing status transition; it is an approved requirement, not an implementation-time product choice.

New instances should capture route version, organizational context, required positions, candidate IDs and skip reasons. For NEW instances, candidate groups are fully snapshotted at instance creation: membership is immutable, organization/route edits do not silently rewrite pending candidates, and pending-step recipient lookup reads only the captured group. A captured candidate must still be an active user to act; inactivity fails closed and must not automatically activate a replacement or approve the remaining step. Candidate reassignment UI is outside this approved scope. Deactivated users must not gain action authority merely because they were captured earlier; any future controlled reassignment must be explicit and audited rather than hidden live rerouting.

Reuse existing request/solution instance storage and lifecycle transactions where feasible. Keep final-approval phase identity explicit. Approval execution must atomically verify actor eligibility, pending/current step and document state, record the actual actor, and advance once. Competing approvals at the same any-one step cannot produce duplicate transitions.

Custom chains retain ordered specific-person steps and existing validation (including self exclusion and duplicates). They bypass normal route restrictions and auto-approval, not authentication, action permissions or document-state checks. Preserve current custom entry points; adding a custom picker to initial request creation is not implicitly included.

Resubmission is distinct from an organization edit: preserve the existing regeneration concept, use current published routing for the new attempt, and retain prior attempt history rather than confusing it with the current approval instance.

## Approved compatibility-first notification policy

Notifications are compatibility-first and are not a new delivery system:

- Preserve every existing notification event (`approval_needed`, `approval_granted`, `approval_rejected`, `status_changed`, `request_assigned`, `solution_ready` and `final_approval_needed`), its current in-app/email channel behavior, custom solution notify-all-at-submit behavior and custom final first-step-only notification behavior, and section-wide status broadcasts.
- Existing department audiences map to their future sections. A notification audience must not expand to descendants or ancestor managers merely because those users can view the request; visibility is not a notification subscription.
- For NEW normal approval instances, pending-step `approval_needed`/`final_approval_needed` recipients come only from the immutable current-step candidate group, filtered to active users at dispatch. Organization changes do not cause live replacement lookup.
- Pre-cutover in-flight rows retain legacy recipient lookup and legacy action semantics. Custom chains retain ordered person IDs and existing phase-specific timing: notify-all for custom solution submission/resubmission, first-step-only for custom final initiation.
- Deduplicate identities inside each recipient group, keep post-commit dispatch boundaries and race-safe advancement, and do not add cancellation/resubmission events, new email parity, subscriptions or retry behavior.

## Visibility design

Visibility is a read policy independent of approval-route selection and action permissions.

| Actor | Proposed read scope |
|---|---|
| General staff | All requests in their section |
| Supervisor | Own section sharing, plus explicit assignments; supervisory branch limits approval eligibility, not section read sharing |
| Section Manager | Managed section |
| Department Manager | Managed department and descendant sections |
| Division Manager | Managed division and descendants |
| Factory Manager | Managed factory and descendants |
| Admin | Global, subject to deleted-record policy |
| Engineering | Existing broad operational visibility |
| Custom cross-check approver | Specifically assigned requests, independent of organizational branch |
| Member of a normal candidate group | Assigned document, even when their own section differs |
| Past actual approver | Retain access to documents they acted on |

Sharing an ancestor does not grant siblings access to each other's requests. A PD1 staff member cannot see PD2 requests just because both report to the Factory Manager. A manager can view a request even when the approval route stops below them.

Use the current private-file helper's engineering interpretation as the proposed normalization: engineering system role OR engineering department classification grants operational visibility. This does not grant approval/resubmission/final-initiation rights. During migration preserve the engineering classification explicitly instead of relying on a department name.

All request access surfaces must enforce the same read policy: list/search, detail fetch, solution data, activity, attachments, inline previews, downloads, exports and visibility-based counts. Archived records remain accessible with default-list hiding; missing/inactive users and soft-deleted records remain denied in ordinary read flows. Workflow action counts additionally require action eligibility.

### Action permissions are separate

| Action | Rule |
|---|---|
| Resubmit request | Preserve ownership and status restrictions |
| Submit/revise solution | Preserve phase, role and assignment restrictions |
| Initiate final approval | Preserve existing eligibility and status restrictions |
| Approve/reject | Current pending-step eligibility plus document-state validation |
| Edit/cancel/assign engineers/other operations | Preserve existing action-specific server rules |

Buttons reflect those permissions, but hidden buttons are not security enforcement. A globally visible request does not make every operation available to Engineering, Admin or Factory Manager.

### Existing access discrepancies to address

The scout reported and parent inspected `getRequest` authenticating without document-level authorization. Lists, private-file access and exports also disagree about engineering roles and actual versus designated approvers. Treat these as discrepancies to correct against the approved policy, not accidental behavior to preserve. Add authorization coverage rather than relying on source-string tests alone.

## Migration and compatibility

- No production migrations run locally.
- Review mappings of existing departments to sections, parent units, engineering classification, levels 1–10 to positions 1–6, and external assignments before data conversion. Numeric compression or organizational inference is not automatic.
- Keep pre-cutover pending instances on a compatibility path; do not reinterpret their numeric levels as new positions. Preserve existing action semantics on these instances unless a separately approved safety correction applies.
- Apply new routing to new attempts after cutover. Keep existing history readable.
- Replace repeated manager-section assignments with parent scope only after mappings have been validated.
- Do not broaden document reads accidentally through nullable organizational fields or missing migration mappings.
- Preserve unrelated local files and work.

## Validation strategy

Behavior tests cover organization cycles/scope, route ceilings, upward-only normal resolution, vacancies, auto-approval, any-one atomic progression, unrestricted custom exceptions, and each request/solution/final phase. Test resubmission separately from in-flight edits.

Use a role/scope/status matrix for reads and actions, including PD1 versus PD2 staff, shared parent managers, Factory Manager, Engineering, Admin, cross-check users, inactive users and historical approvers. Test direct detail calls and file/export endpoints, not only list filters or button rendering. Test organization changes and candidate deactivation during pending approvals.

Add regression tests for every preserved action capability and status transition before replacing routing. Run `npm run check` after code changes and relevant targeted tests through Portly. Update graphify after implementation changes.

## Parent-unit document implementation interpretation

Existing section-owned requests retain section-sharing, direct-section final-initiation permissions and section-wide informational broadcasts. For new parent-unit-owned requests, the plan generalizes that same direct-membership concept to the stored origin unit: direct members, not every descendant viewer, are the same-unit action/audience set. Existing ownership, role and status checks still apply. This explicit implementation interpretation must be visible at execution handoff; it does not broaden Engineering or ancestor-viewer mutation rights. Never use a dummy section or an arbitrary legacy department when origin-unit context is missing.

## Review boundary

The empty-resolved-route completion with `NO_ELIGIBLE_APPROVAL_STEPS`, fully snapshotted NEW candidate groups with fail-closed inactivity, and compatibility-first notification policy above are approved requirements for implementation planning. They do not authorize implementation, production migration, or a candidate reassignment UI. The implementation plan must preserve this boundary, use reviewed external mapping inputs, and leave any genuinely missing organizational mapping as a rollout gate rather than inventing a value. No implementation has been performed.
