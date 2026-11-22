# Automatic Final Approval — design

## Goal

Remove the manual **Start Final Approval** handoff after Engineering's solution approval when automatic routing is enabled. Keep the existing manual default and custom hierarchies intact so admins can switch back without losing any configuration or history.

## Admin setting

Add an admin-only, database-backed switch on the Admin Dashboard:

> **Automatically start Final Approval** [On]
> After solution approval, use the requester's default Final Approval route.
> Turn this off to keep the manual start and custom hierarchy picker.

The initial value is **On**, including when no setting has been saved. Only an active admin can change it; enforce this on the server. Changes apply to solution approvals that finish afterward. Saving the setting never scans or restarts existing requests: requests already waiting for a manual start keep that option, and ongoing Final Approval attempts are not rerouted.

## Approaches

- **Server-side handoff (selected):** Extend the existing solution completion transition. This covers all completion paths without relying on any user to open the request and allows the workflow writes to commit together.
- **Browser-side trigger:** Could reuse the button action, but completion would depend on a page being open and on the viewer's permissions. It also introduces a window for duplicate or missed initiation.
- **Background job:** Removes the browser dependency but adds delayed routing, retry/queue infrastructure, and a race with the manual start. Not needed for an inline workflow transition.

## Workflow behavior

- **On:** When a solution completes approval, build a normal Final Approval attempt from the persisted requester's reporting path and published **Final** route, not the engineer's, the approving actor's, or the custom solution route. The requester is the routing origin, not an extra approval step. The first eligible step gets the usual Final Approval notification; later steps and candidate snapshots behave as before. Existing normal-route ceiling and no-eligible-steps completion rules still apply, with their existing audit evidence. The switch itself does not grant an approval.
- **Off:** Keep **Start Final Approval** and the existing permissions, default routing, and custom hierarchy picker as they are today. Keep those controls available for eligible manual-waiting requests (including configuration fallback) even when the setting is On.
- Cover the last solution approval and the no-step/auto-complete paths for both initial solution submission and resubmission. Do not change solution or final rejection rules. A revised solution that finishes approval follows the setting at that time and keeps older Final attempt history.
- Commit the solution handoff, cost, Final attempt and status changes together. Record the solution completion transition for existing analytics and label the Final initiation as automatic in request activity. Deliver notifications only after commit; don't tell people to start it manually when it has already started or completed.
- If routing cannot produce a valid plan because requester or route configuration is missing or invalid, leave the approved solution in the existing manual waiting state, record the fallback, and keep manual initiation available. An invalid route is not a valid route with zero eligible steps. Unexpected persistence errors and races must not be caught as configuration fallback; they follow the existing transactional error behavior.

## Verification and constraints

Test the default and persisted settings, admin authorization, requester-based routing, the three solution completion paths, notification and exactly-once behavior, manual/custom compatibility, and configuration fallback. Do not run production migrations locally. No changes to published routes, custom hierarchy selection, or the recipients' authority to decide approvals.
