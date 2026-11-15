# Admin checkbox and role cleanup — short design

Date: 2026-10-22 · Size: small-to-medium change (one branch, no database migration)

## Why

People are now managed in `/admin/organization` (unit, position, manager, team).
The Role dropdown on `/admin/users` still offers "General Department User" and
"Engineering User", which overlap with Organization and confuse admins.

## Goals

- `/admin/users` offers one access choice only: **Administrator** yes/no.
- Engineering abilities come entirely from the unit setting
  **Can work on solutions** in Organization.
- Remove the duplicated code found along the way.

## Non-goals

- No change to how Organization assigns units, positions, managers or teams.
- No database migration. The `users.role` column and its three enum values stay.
  New non-admin users are still stored as `general_dept`. Dropping the unused
  `engineering` value can be a later, separate migration.
- No change to approval chains or request visibility rules.

## Anti-goals

- An admin must never be able to lock everyone out of `/admin`.
- Nobody may gain access to requests they cannot see today.

## Approaches considered

1. **Admin checkbox only; engineering follows the unit setting (picked by owner).**
   Removes the overlap completely. Touches permission code and tests.
2. Admin checkbox, engineering rules untouched. Smaller, but "assign engineers"
   stays unreachable because nobody can be given the Engineering role.
3. Keep the dropdown, reword it. Smallest, but the overlap stays.

## Design

### Users page (`/admin/users`)

- Create User and Edit User: the Role dropdown becomes a checkbox
  "Administrator — can open the Admin area". Unchecked by default.
- Users table: the "Role" column shows "Admin" for admins and is blank otherwise.
- Server side (`createUser`, `updateUser`): accept `isAdmin: boolean` and store
  `admin` or `general_dept`. Refuse to remove admin from yourself or from the
  last active admin. `deactivateUser` refuses the last active admin too.
  (Builder call: add these guards if they do not already exist.)

### Engineering abilities (builder calls, stated here for owner review)

"Solution worker" below means: active user with an active assignment in a unit
(or a unit under one) that has **Can work on solutions** switched on. This is
the existing `isActorSolutionWorker` rule.

| Ability | Today | After |
|---|---|---|
| Assign engineers to a request | Engineering role | Solution worker |
| Who can be picked as an engineer | Engineering role | Solution worker |
| Engineering request list (`getRequestsForEngineering`) | Engineering role | Solution worker |
| Manage engineering sub-tasks | Engineering role or admin | Solution worker or admin |
| Landing page after sign-in | Engineering role → `/engineering` | Admin → `/admin`; everyone else → `/requests/my-actions` |
| Non-admin opening `/admin` | Engineering role → `/engineering`, others → `/requests` | Everyone → `/requests` |

The landing-page change is deliberate: the sign-in redirect cannot look up the
unit setting without a database call on every request. Solution workers still
reach the Engineering dashboard from the menu, as they do today.

### Duplicate cleanup

- Delete `src/app/(admin)/layout.tsx` (copy of `src/app/admin/layout.tsx`, no pages under it).
- One shared definition of the role type; remove the repeated copies and the
  repeated role-label maps.
- Run a project-wide duplicate scan and give the owner a report. Further
  removals from that report need a separate OK; they are not part of this change.

## Testing

- Tests first for each rule in the table above and for the lock-out guards.
- Update existing tests that assert the Engineering role.
- `npm run check` green; then a browser pass: create a user, tick and untick
  Administrator, assign an engineer as a solution worker.

## Left to the builder

File layout, helper names, exact wording of error messages, and whether the
create and edit dialogs share one component.
