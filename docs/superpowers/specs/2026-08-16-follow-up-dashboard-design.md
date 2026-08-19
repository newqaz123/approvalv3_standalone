# Follow-up Dashboard Design

Date: 2026-08-16

## Problem

`/dashboard` duplicates `/requests` and `/requests/my-actions` (Pending My Approval + My Requests tables). After sign-in, general users land on that duplicate “Pending My Approval” tab.

## Goals

1. `/dashboard` becomes a read-only department follow-up board.
2. Sign-in / `/` for general users goes to `/requests/my-actions`.
3. Visibility matches `/requests` (`getMyRequests`).

## Visibility

Same as `getMyRequests`:

- Admin / Engineering department: all non-deleted, non-archived requests
- General department: own `departmentId` OR required approver on request chain OR required approver on a solution chain

## Redirects

| Actor | After sign-in / `/` |
| --- | --- |
| engineering | `/engineering` (unchanged) |
| admin | `/admin` (unchanged) |
| everyone else | `/requests/my-actions` |

`/dashboard` stays reachable from nav. Non-admin hitting `/admin` still redirects away (keep existing role gate; destination can stay `/dashboard` or become `/requests/my-actions` — use `/requests/my-actions` for general users).

Sign-in fallback `callbackUrl` when none/unsafe: `/requests/my-actions`.

`src/app/page.tsx` authenticated redirect: `/requests/my-actions`.

## Dashboard content (approved v3)

Not a table. No “Need my action” / “Awaiting my approval”. No Department flow strip. No duplicate Needs attention / Completed recently cards.

1. Header: `Improvement Requests — {department}` + “Department overview · personal approvals live on My Actions” + New Request → `/requests/new`
2. KPI tiles (click → filtered drawer) with yesterday deltas: Active · With Engineering (`SentToEngineer` + `DesignCostEstimationApproval`) · Needs attention (30+ days) · Completed 30d
3. Work queues, left → right:
   - Awaiting approval (`ImprovementRequest` | `FinalApproval`)
   - Completed · no WR (all time, with request rows)
   - Engineer solution ready (`SendBackToRequester`, cost estimate when present)
4. Recent activity (latest `request_activities` on visible IDs)
5. Row click → `RequestModalRouter` with `viewOnly` (no approve/reject/submit)

Yesterday deltas compare today’s queue counts to yesterday’s reconstructed status (`request_activities.fromStatus` / `toStatus`). Copy: `+N from yesterday` / `No change from yesterday`.

## Theme

White page, no grid. Stay inside the existing light shadcn shell (navbar stays).

## Out of scope

Aging chart, overdue/target dates, IR- numbers, inventing drafts, rewriting `/analytics`.
