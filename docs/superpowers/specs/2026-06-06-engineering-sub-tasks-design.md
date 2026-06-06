# Engineering Sub-tasks Design

## Goal

Add request-attached engineering sub-tasks that help engineers and requesters follow up implementation progress without changing the existing approval workflow.

The feature is a lightweight engineering follow-up layer. It adds a collapsed `Sub-tasks` section to request details, engineer/admin editing controls, requester read-only visibility, request-level WR tracking, and filters for WR and stale sub-tasks.

## Scope

In scope:

- Request-attached sub-task checklist cards.
- Any engineering user can create, edit, complete, and hard-delete sub-tasks.
- Admin users can also edit sub-tasks and shared lists for correction/administration.
- General/requester users can view sub-task progress and details only.
- Admin-managed global sub-task stage list.
- Engineering-managed shared subcontractor list.
- `Others` stage option with required custom text.
- Last edited time on each sub-task.
- Request-level `Work requisition received` marker.
- WR filters on `/dashboard` and `/requests`.
- Stale incomplete sub-task filter on `/engineering`.

Out of scope:

- Separate sub-task approval workflow.
- Separate sub-task dashboard page.
- Sub-task notifications for every edit.
- Soft delete or audit history for deleted sub-tasks.
- Using sub-task stage to change the parent request approval status.

## Request Stage Rules

Show the `Sub-tasks` section only when the parent request status is:

- `SentToEngineer`
- `SendBackToRequester`
- `FinalApproval`
- `Completed`

Hide the section when the parent request status is:

- `ImprovementRequest`
- `DesignCostEstimationApproval`
- `Cancelled`

`DesignCostEstimationApproval` remains hidden because it is a short approval step and sub-task controls would distract approvers.

Engineers/admins can freely create, edit, complete, delete sub-tasks, and toggle WR in every visible stage, including `Completed`.

## Data Model

Add `request_sub_tasks`:

- `id`
- `requestId`, relation to `requests`, cascade delete
- `description`, required text
- `subContractorId`, optional relation to `sub_contractors`
- `stageId`, relation to `sub_task_stages`
- `customStageText`, nullable, required only when selected stage is `Others`
- `isCompleted`, boolean, default false
- `completedAt`, nullable
- `completedById`, nullable relation to `users`
- `createdAt`
- `updatedAt`
- `createdById`, relation to `users`
- `updatedById`, nullable relation to `users`

Add `sub_task_stages`:

- `id`
- `name`
- `sortOrder`
- `isDefault`
- `isOthers`
- `isActive`
- `createdAt`
- `updatedAt`

Seed global default stages:

- `Design`
- `Site survey`
- `Waiting user data`
- `Waiting quotation`
- `Waiting WR`
- `Completed`
- `Others`

Add `sub_contractors`:

- `id`
- `name`
- `isActive`
- `createdAt`
- `updatedAt`
- `createdById`, relation to `users`
- `updatedById`, nullable relation to `users`

Extend `requests`:

- `workRequisitionReceived`, boolean, default false
- `workRequisitionReceivedAt`, nullable
- `workRequisitionReceivedById`, nullable relation to `users`

## Permissions

Request visibility remains the outer boundary. Users only see sub-task and WR data for requests they can already access.

Admin users can:

- Manage global sub-task stages.
- Manage subcontractors.
- Create, edit, complete, and hard-delete sub-tasks.
- Toggle WR on/off.

Engineering users can:

- Create, edit, complete, and hard-delete sub-tasks on any visible-stage request.
- Manage the shared subcontractor list.
- Toggle WR on/off.
- Use `/engineering` stale sub-task filters.

General/requester users can:

- See the collapsed sub-task summary.
- Expand and read sub-task details.
- See WR status.

General/requester users cannot:

- Create, edit, complete, or delete sub-tasks.
- Manage subcontractors.
- Toggle WR.
- Manage global stages.

## UI Behavior

### Request Detail And Modals

Add a collapsed section named `Sub-tasks`.

The section starts collapsed every time the request detail/modal opens. The app does not remember expanded/collapsed state.

Collapsed header shows compact summary only:

- section label: `Sub-tasks`
- completed count, for example `1/3 complete`
- compact WR badge: `No WR` or `WR received`

Expanded view shows:

- request-level checkbox labeled `Work requisition received`
- checklist cards
- add/edit/delete controls for engineers/admins only
- read-only cards for general/requester users

Each checklist card shows:

- completion checkbox or completed indicator
- description
- subcontractor
- stage
- custom stage text when stage is `Others`
- last edited time

### WR Marker

WR is a request-level marker, not a tag list.

Engineers/admins can turn it on or off. When turning it on, store:

- `workRequisitionReceived = true`
- `workRequisitionReceivedAt = now`
- `workRequisitionReceivedById = current user`

When turning it off, clear:

- `workRequisitionReceivedAt`
- `workRequisitionReceivedById`

Compact locations use `WR received` or `No WR`. Expanded view uses the full label `Work requisition received`.

### `/dashboard` And `/requests` Filters

Add WR filter options:

- `All`
- `No WR`
- `WR received`

The filter uses the request-level WR marker and does not affect approval status.

### `/engineering` Filters

Add stale incomplete sub-task filtering:

- stage filter: `All`, active global stages, and `Others`
- last update older than `X` days
- incomplete only

The filter returns requests that have at least one matching incomplete sub-task where `updatedAt` is older than the selected threshold.

## Edge Cases

- If a stage is deactivated, existing sub-tasks keep showing the old stage, but the stage is not available for new selections.
- If a subcontractor is deactivated, existing sub-tasks keep showing the old subcontractor, but it is not available for new selections.
- If an engineer selects `Others`, custom stage text is required.
- If an engineer selects a normal stage, custom stage text is cleared.
- If a request changes to a hidden stage, existing sub-tasks are not deleted; they are hidden until the request returns to a visible stage.
- If a sub-task is completed, set completed time/user.
- If a completed sub-task is unchecked, clear completed time/user and update last edited time.
- Hard delete removes the sub-task permanently.

## Testing

Data and migration checks:

- Default stages seed correctly.
- Subcontractors can be created and deactivated.
- WR fields save and clear correctly.

Permission checks:

- Engineering/admin users can mutate sub-tasks, subcontractors, and WR.
- General/requester users can view but cannot mutate.
- Users cannot see sub-task data for requests they cannot already access.

Request stage checks:

- `Sub-tasks` appears in `SentToEngineer`, `SendBackToRequester`, `FinalApproval`, and `Completed`.
- `Sub-tasks` is hidden in `ImprovementRequest`, `DesignCostEstimationApproval`, and `Cancelled`.

Filter checks:

- `/dashboard` WR filter handles `All`, `No WR`, and `WR received`.
- `/requests` WR filter handles `All`, `No WR`, and `WR received`.
- `/engineering` stale filter returns requests with incomplete sub-tasks older than `X` days.
- Stage and stale filters combine correctly.

UI checks:

- `Sub-tasks` starts collapsed every time.
- Expanded cards show description, subcontractor, stage, and last edited time.
- Compact header uses `No WR` or `WR received`.
- Expanded view uses `Work requisition received`.

## Implementation Risk

Risk is medium because the feature touches schema, request detail surfaces, dashboard/request filters, engineering filters, and permissions.

Risk controls:

- Keep sub-tasks independent from approval status.
- Keep WR as a request-level boolean marker, not a workflow status.
- Implement in small increments: schema, server actions, request UI, filters, then QA.
- Use existing request visibility rules as the outer authorization boundary.
