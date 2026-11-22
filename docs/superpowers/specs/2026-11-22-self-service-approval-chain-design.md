# Self-service approval chain

## Intent

Make Profile → Approval Chain answer “Who would need to approve this?” The current page only shows the signed-in user's unit. Keep the page read-only and use the published organization routes, not the removed department hierarchy.

## Approaches

- **Request only:** The clearest answer for new requesters, but omits later phases.
- **All three phases (selected):** Show Request, Solution, and Final separately. Explain whose assignment determines each preview so a default is not mistaken for a live chain.

## Page behavior

Keep the organization breadcrumb and show three ordered previews:

- **Request approval:** What would happen if you submitted a new request.
- **Solution approval:** What would happen if you submitted a solution using the published route. The real route follows the solution submitter.
- **Final approval:** What would happen if you started final approval on a request you submitted. The route follows the requester; the person starting final approval can change which steps are required.

Show the selected route's unit and each applicable position in order, with eligible approver names. If several people can approve at one step, make it clear that any one of them can do so. Explain skipped vacant positions, automatic approval, and completion with no eligible steps. A missing or invalid route gets a message on its own phase without hiding the others. If the account is unassigned, explain that an administrator needs to assign it.

## Boundaries and checks

Resolve previews on the server for the signed-in user only. Share the existing read-only preview logic used by the organization admin, but keep its arbitrary-user and draft controls admin-only. Do not write to the database, change workflow rules, or show snapshots and overrides for individual submissions; the request itself remains the source of truth for those.

Add regression coverage for the three phase previews, candidate order and labels, automatic and vacant outcomes, missing routes, and self-only access. Check the page from the user menu with a seeded non-admin account.
