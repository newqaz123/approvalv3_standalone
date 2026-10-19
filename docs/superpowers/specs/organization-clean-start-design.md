# Clean-start organization and approval design

Status: owner approved the tree-first visual design (clean-start-v4 mockup), subsequent organization and sharing rules, and the simplified access model. This records design approval, not authorization to reset existing databases. The reporting-path integration and participants-only status-notification direction are now owner-confirmed. Plans must be reconciled with these decisions and reviewed before execution.

## Direction and alternatives

Use one configurable company model per installation. This supersedes the earlier fixed four-level/six-position and legacy-compatibility requirements for the future clean-start application only. The existing branch and databases are not silently converted.

Alternatives considered: relabeling four fixed levels would not satisfy arbitrary company structures; multiple company tenancy adds unnecessary scope. Recommended: one company root, flexible organization units, one company-wide configurable position ranking.

## Confirmed business rules

- Exactly one company root. Organization units have admin-chosen names and arbitrary acyclic nesting beneath that root. No fixed Factory/Division/Department/Section types.
- Positions have configurable names and a company-wide approval rank. Unit depth does not define position rank.
- Position-rank changes are blocked if they invalidate a reporting relationship or published approval chain, including step ordering and approval limits. Show affected relationships/routes so admins can correct them before saving. Existing approval snapshots remain unchanged.
- One active organization assignment per person: one unit and one position, with optional membership in one flat team in that unit. Unassigned accounts are listed separately.
- Every active user with an active organization assignment may submit requests, subject to workflow/readiness validation. No separate Submit requests permission checkbox is required. Unassigned or inactive users cannot submit.
- Teams are flat, not nested. Each has an explicit reports-to person assigned to that unit, outside the team's membership, ranked strictly above every member. A person may oversee multiple teams without additional assignments. These relationships cannot create cycles.
- For a person without a team, approval follows the explicitly selected Unit manager, then selected parent-unit managers. Other ungrouped coworkers are not automatically candidates. Only exact positions present in the configured chain are actionable.
- Approval lookup stays on the submitter's configured reporting path. Team members at an exact required position are eligible; sibling-team members are not. The path proceeds through the explicitly selected reporting person and eligible higher-unit managers, not arbitrary peers. Reporting relationships alone never insert an approval step.
- Each unit explicitly selects its Unit manager from people actively assigned directly to that unit. Management scope is not inferred from position rank alone. A person cannot separately manage another unit while assigned elsewhere; the selected manager covers descendant units through their own managed unit. Overseeing multiple teams within that unit does not add assignments.
- Managers cover descendant units only when the configured chain calls for their exact position. A Director is never substituted for a vacant Manager step.
- Multiple eligible holders receive notification. First committed decision wins: approval advances; rejection closes the attempt and returns for revision. Later competing decisions cannot change the outcome.
- Normal routes auto-approve if the origin position is at or above the route limit. Otherwise steps at or below the origin position do not require approval. Required positions ascend and cannot exceed the limit.
- Vacant steps are skipped and audited. If no eligible steps remain, the phase completes with an explicit reason.
- Custom ordered-person chains remain separate and never auto-approve.
- Only application admins may explicitly restart a stranded attempt whose saved approvers are all inactive. Require a reason and replacement-chain preview; preserve the old attempt and decisions, and create a new attempt from current organization settings. Restart itself does not grant approval; normal new-attempt resolution rules still apply.
- Approval attempts preserve origin, route version, positions and candidate identities as immutable snapshots. Inactive candidates cannot act; replacements require an explicit restart. Moving a person does not rewrite existing attempts.
- Request and Final origin follow the requester; Solution origin follows the stored solution submitter, not an authorized reviser.
- Request sharing is a per-origin-unit switch (implemented in `src/lib/organization/sharing.ts`). Sharing ON on a unit: everyone assigned anywhere in the parent unit's whole subtree sees that unit's requests, including sister units under the same parent (for the root unit, its own subtree). Sharing OFF: only people assigned in the unit's own subtree plus people assigned to its ancestor units see its requests; sister units cannot. New units default to sharing OFF. Example: Operations contains Sections A and B; with Section A sharing OFF, Alice (A) and Pat (Operations) see A's requests but Bob (B) does not; with Section A sharing ON, Bob also sees them. Visibility does not grant mutation or approval authority.

## Tree-first administration

One Organization & Approvals workspace replaces the separate organization and route configuration experience.

- Tree displays units, directly assigned people, position names, flat teams beneath their reporting person, and sharing-boundary labels.
- A person appears once in their assigned unit; overseeing multiple teams does not duplicate their assignment.
- Selecting a unit opens a contextual side panel. Selecting a person opens assignment management; selecting a team opens membership/reporting management.
- Unit-row Rename and Manage controls appear on hover or keyboard focus; touch devices retain a visible overflow control. Remove the persistent Manage unit / inherited chain link from tree rows; show effective route source inside Manage instead. Keep compact custom-chain exception badges.
- Manage unit contains the explicit Share requests toggle (share this unit's requests with the rest of the parent unit, including sister units); it defaults to OFF for new units. The tree shows a Request sharing badge reflecting the saved setting.
- Unit/team names support explicit pencil-to-edit, Enter/save, Escape/cancel, adjacent validation errors and retained input on failure.
- Create unit asks for name and parent. There is no inferred unit type in this flexible model. The company root is created during setup; later creation must select a parent. Sections can have child units too.
- Assign person selects an existing account, position, unit and optional valid team. Account creation is separate.
- Move/edit shows a before/after confirmation. Changing unit clears incompatible team selection explicitly. It never changes application permissions.
- Remove assignment deactivates the assignment, preserves audit/history and lists the account under Unassigned people. It does not delete/deactivate the account.
- A change that makes a team's reporting person invalid cannot silently select a replacement. Require explicit correction before saving the conflicting organization change.

## Approval defaults and exceptions

Header action Approval chains opens a company-wide configuration panel, not another form repeated under each unit.

- Root defaults are separate for Request, Solution and Final.
- Unit exceptions are explicit, versioned overrides. Nearest configured ancestor route applies per phase; invalid nearer configuration fails rather than falling back.
- Unit panel shows the effective source (e.g. Uses company default / Inherited from Operations / Custom at this unit) and provides View or Customize actions.
- Edit chain uses Add approval step, configurable position names and a named Approval limit (position with secondary rank).
- Lowering the limit flags conflicting steps and blocks publication until corrected; no silent removal.
- Test with a submitter explains that it resolves actual candidate people without creating requests, saving snapshots or publishing. Show source, per-step candidates, skipped reasons, auto-approval and no-eligible outcomes.
- Publish affects future attempts only. Drafts and published versions are visibly distinct. Root default publication is not an implicit global activation switch.

## Status notifications

Owner confirmed: status-change notifications go to request participants only. Do not broadcast to all members of the originating unit or request-sharing scope. Approval-needed notifications go only to the current eligible approval-step candidates. Viewing access alone never subscribes a user to notifications. The implementation plan must define participant membership explicitly rather than infer it from unit membership.

## Solution-work eligibility

Admins explicitly mark an organization unit Can work on solutions (for example Engineering). People actively assigned to that unit or any descendant may submit and revise solutions, subject to the action's status, visibility and other workflow guards. The flag is not inferred from unit names and does not confer approval rights. No separate legacy engineering department/type or per-person solution permission is used. Moving a person changes future solution-action eligibility through their current assignment; immutable approval attempts are not rewritten.

## Data and application changes

New schema concepts: company/root settings; organization units with parent and sharing flag; configurable positions/ranks; users and explicit application permissions; active assignments; flat teams with reports-to assignment and memberships; versioned route definitions/steps/limits; immutable attempts, candidate groups, decisions and audit events.

Runtime ranks/titles must not replace historical snapshot values. Positions and organizational records referenced by history should be deactivated rather than destructively deleted. Renaming changes current presentation; historical audit labels remain available.

Remove legacy department ownership and fixed numeric-role assumptions from the new application's writers, readers, visibility predicates, notification resolution and UI. Replace legacy/shadow/new cutover and mapping-digest requirements with explicit organization/route readiness validation. Application permissions remain distinct from job position but are not a competing organization model.

Use a separate fresh database for the new implementation. Do not reset app_db or app_org_manual_7abcdf3. prisma db push test clones are not production migration validation: final schema constraints and race behavior require isolated PostgreSQL verification.

## Verification scope

- Arbitrary-depth trees, parent/cycle validation, one root and one active assignment.
- Team reporting-rank validation, multiple teams under one manager, exact positions, no sibling-team candidates.
- Company default and ancestor-exception precedence per phase.
- Shared candidate first-decision approval/rejection races.
- Position ceiling, vacant skipping and all-vacant completion.
- Immutable attempts across rename, moves, rank changes and deactivation; explicit restart.
- Request sharing: OFF keeps a unit's requests within its own subtree plus ancestor units (sister units denied); ON opens them to the parent unit's whole subtree including sister units; new units default to OFF; visibility never widens actions.
- Inline rename, assignment moves/removal, duplicate team errors, stale forms and save feedback.
- Actual Next compilation plus browser interaction, not only source-contract tests.

## Decisions still requiring clarification before implementation

1. Resolved: Unit manager is explicitly selected from active direct assignments to the managed unit. Descendant management follows that unit; separate management of another unit is not permitted.
2. Resolved: ungrouped people follow the selected Unit manager then selected parent-unit managers, matching exact configured positions; no automatic ungrouped coworker candidates. For team members, follow eligible exact-position members of their own team, the explicit reports-to person, then the selected own-unit manager and selected ancestor-unit managers. The owner approved including the own-unit manager even when different from the reports-to person. Include only positions called for by the chain, and deduplicate people so no person appears twice. Reporting-path traversal does not insert extra approval steps.
3. Restart authorization resolved: application admins only, with required reason and replacement-chain preview. Solution work is derived from an explicit Can work on solutions flag on an organization unit, inherited by all descendant units; it is not a per-person permission checkbox or inferred from a unit name. Application administration remains separate. Request submission is allowed for every active user with an active organization assignment, subject to workflow/readiness validation; no per-user submission permission checkbox.
4. Resolved: block position-rank changes that invalidate reporting relationships or published chains; list affected records. No automatic repair and no changes to existing attempt snapshots.
5. Resolved: sharing is decided per origin unit. Ancestor-unit members always see a descendant unit's requests regardless of its sharing switch; the switch only controls whether sister units (the rest of the parent unit's subtree) see them. New units default to sharing OFF.

These are intentionally open design decisions, not permission to guess at authorization behavior. Review the proposed model and mockup first; resolve these points before schema implementation.
