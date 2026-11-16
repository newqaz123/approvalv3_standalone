# Engineering can view all requests — per-unit design

Date: 2026-11-16
Status: Approved by user
Size: Small permission change

## Intent and decision

Allow selected Engineering groups to track requests across departments and throughout the request lifecycle. The user chose an admin-controlled option per organization unit, inherited by its sub-units, rather than a switch for all Engineering users.

## Approaches

- **Per-unit permission — selected:** extend the existing organization-unit settings. Administrators choose which Engineering branches receive wider visibility, matching the existing inherited solution-work capability.
- **Global Engineering switch — not selected:** simpler administration, but grants the same visibility to every Engineering group and cannot limit access to selected branches.

## Proposed behavior

- Add an admin-only switch labeled **Engineering can view all requests** to Admin → Organization → unit settings, next to **Can work on solutions**. Use the existing Save settings action and visual style.
- Store a separate `engineeringCanViewAllRequests` Boolean on organization units, defaulting to `false`. Existing units keep their current access until an administrator enables it.
- Active users with an active assignment inherit the flag from their own active unit or an active ancestor. An unchecked child does not override an enabled ancestor; disabling the granting ancestor removes that grant unless another active unit on the assignment chain grants it.
- Broader access also requires the existing effective **Can work on solutions** eligibility. This option does not itself enable solution work, and a role name or unit name does not grant access.
- When effective, allow viewing requests from every department at every status, including initial approval, returned-to-requester, final approval, and completed requests. Deleted requests remain excluded. Preserve each view's existing archive filters; archived requests remain accessible only through existing archive-aware reads.
- When not effective, preserve existing sharing, ownership, manager, approval-participant, and engineering-stage visibility.
- Apply access through the shared server-side request-visibility policy so lists, counts, filters, request details, and protected request reads agree. Other view filters still apply.
- Use existing Requests and tracking views. Keep the Engineering dashboard's existing workflow queues and status filters; this is not a new dashboard or tab.
- The flag grants viewing only. Do not grant editing, approval, deletion, engineer assignment, sub-task management, or solution submission through this flag. Existing independent action checks remain authoritative.

## Interface sketch

```text
Unit settings
  [existing request-sharing setting]          [switch]
  Can work on solutions                      [switch]
  Engineering can view all requests          [switch]
    View requests across all departments and stages.
    Applies to this unit and sub-units with solution-work access.
    Does not grant editing or approval permissions.

  [Save settings]
```

Use the existing labeled switch and help-text/tooltip patterns; no visual redesign is needed.

## Implementation boundaries

Extend the Prisma unit schema and migration, organization model and admin settings persistence, workspace state, and shared visibility actor/predicate. Reuse existing hierarchy validation and active-unit semantics; malformed or missing assignments must not grant broad access. Confirm protected reads and mutation checks remain appropriately separated.

Do not change general-user visibility, sharing semantics, approval routing, workflow states, notifications, or unrelated work in the checkout. Create the migration but do not run production migrations locally or deploy changes.

## Verification

Cover default-off behavior, direct and inherited grants, sibling isolation, removal of grants, inactive users/assignments/granting units, malformed ancestry, missing solution-work eligibility, all request statuses, deleted/archive filtering, and unchanged independent mutation permissions. Cover admin-only persistence and the switch's save/reload behavior. Run focused regressions and `npm run check`; refresh the existing graph with `graphify update .` after code changes.

## Builder decisions

The user approved the field name, default-off policy, eligibility requirement, reuse of current tracking views, and preservation of archive behavior. Test organization and small helper boundaries are left to the implementation plan.
