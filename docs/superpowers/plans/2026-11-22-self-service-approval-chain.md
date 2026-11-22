# Self-Service Approval Chain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the signed-in user's published Request, Solution, and Final approval previews in Profile → Approval Chain.

**Architecture:** Extract the existing admin preview's read/resolve stages into reusable private helpers without changing the admin action contract. A non-action server loader derives all three phases from one reporting context. The existing authenticated page calls it with the session user ID and renders a server-only view.

**Tech Stack:** Next.js App Router, React, TypeScript, Prisma, `node:test`, Playwright.

**Spec:** [2026-11-22-self-service-approval-chain-design.md](../specs/2026-11-22-self-service-approval-chain-design.md)

## Global Constraints

- Resolve previews on the server for the signed-in user only. Keep the arbitrary-user and draft controls admin-only; don't add a new server action or API endpoint.
- No database writes at runtime, workflow-rule changes, legacy hierarchy, submission overrides, or historical snapshots on this page.
- Keep the organization breadcrumb. A missing or invalid route must not hide other phases.
- Run `npm run check` and `graphify update .` after code changes. Use a disposable loopback PostgreSQL DB for browser verification; no production migrations locally.

## Review Focus

- An invalid nearer published route must not silently fall back or blank other phases (Task 1).
- An inactive candidate and someone outside the user's eligible pool must not appear (Task 1).
- An unassigned user must get assignment guidance even before the organization is configured (Task 1).
- A configuration error is not the same as a database read failure (Task 1).
- Query-supplied identities and anonymous requests must not trigger another user's preview lookup (Task 2).

---

### Task 1: Resolve the three published previews from one reporting context

**Files:** Modify `src/lib/approval-routes/chains-admin.ts`; extend `tests/regression/clean-start-ui-chains.test.ts` using its existing read DB and seeded-style fixtures.

**Interfaces:**
- Consumes `ApprovalChainsReadDb`, `SubmitterTestResult`, `ApprovalPhase`, `resolveReportingPath`, `selectNearestRoute`, `validateRouteDefinition`, and `selectStepCandidates` as defined in the repo.
- Produces `loadPersonalApprovalChain(userId: string, db?: Omit<ApprovalChainsReadDb, 'loadStrandedAttempts'>): Promise<PersonalApprovalChain>`, a non-action export. `PersonalApprovalChain` is `{ kind: 'unassigned' } | { kind: 'assigned'; unitPath: readonly string[]; phases: readonly PersonalApprovalPhase[] }`. `PersonalApprovalPhase` is `{ phase: ApprovalPhase; kind: 'unavailable' } | { phase: ApprovalPhase; kind: 'ready'; routeUnitName: string; preview: SubmitterTestResult }`.

- [ ] **Write the failing tests.** Extend the fixture's root route into `SOLUTION` and `FINAL` and assert for Alice: `unitPath` equals `['Section A', 'Operations', 'Company']`; phases equal `['REQUEST', 'SOLUTION', 'FINAL']`; units equal `['Operations', 'Company', 'Company']`; each ready result matches the admin preview for the same user and phase. Assert Lead candidates are `['Casey', 'Quinn']`, and organization lists load once, with no stranded-attempt reads. Assert no-assignment (`admin-1`) on an empty organization returns `{ kind: 'unassigned' }` without any route reads; a missing or draft-only SOLUTION is `unavailable` while REQUEST and FINAL remain ready; a nearer invalid SOLUTION is `unavailable` despite a valid Company baseline; and a thrown database error rejects rather than masquerading as route configuration.
  ```ts
  assert.deepEqual(chain.unitPath, ['Section A', 'Operations', 'Company'])
  assert.deepEqual(chain.phases.map(({ phase, kind }) => [phase, kind]), [
    ['REQUEST', 'ready'], ['SOLUTION', 'ready'], ['FINAL', 'ready'],
  ])
  assert.deepEqual(lead.candidates.map(({ name }) => name), ['Casey', 'Quinn'])
  ```
- [ ] **Run the red test:** `npx tsx --test tests/regression/clean-start-ui-chains.test.ts`. Expect the new cases to fail because `loadPersonalApprovalChain` does not yet exist.
- [ ] **Implement the loader.** Extract shared snapshot loading, path resolution and per-phase preview from `testWithSubmitter`; keep its runtime phase validation, baseline/draft validation, and admin-gated default store. The personal loader uses the same internal Prisma read adapter, never the client-callable admin action. Before validating the reporting graph, return `unassigned` if the session account is inactive/missing or has no active assignment. Resolve one path and preview the three phases in order, with no draft. Catch only `ApprovalRouteConfigurationError` per phase, use the chosen scope's unit name and preserve root-last breadcrumb order. Do not read or write instances. The Final preview assumes the requester and initiator are the same person, so the existing rank cutoff applies unchanged.
- [ ] **Run the green test:** repeat the targeted command; all old and new tests must pass.
- [ ] **Commit Task 1** with only the two Task 1 files: `feat: resolve self-service approval previews`.

### Task 2: Render the self-service preview and verify the menu path

**Files:** Modify `src/app/(dashboard)/approval-chain/page.tsx` and `tests/regression/profile-menu.test.ts`; create `src/components/profile/approval-chain-view.tsx` and `tests/regression/personal-approval-chain-page.test.ts`.

**Interfaces:**
- Consumes Task 1's `loadPersonalApprovalChain` and `PersonalApprovalChain`.
- Produces `ApprovalChainView({ chain }: { chain: PersonalApprovalChain }): React.JSX.Element`; keeps `ApprovalChainPage()` a zero-argument async server page.

- [ ] **Write the failing tests.** Render `ApprovalChainView` and assert all three phase headings in order, the breadcrumb, `Route from Operations`, steps `Lead` then `Manager`, `Casey`/`Quinn` and `Any one of these people can approve`, the `No active approver` skipped message, `Automatically approved`, `No eligible approval steps`, and an independent `No usable published route` state using separate fixture variants as needed. For unassigned assert `contact your administrator`. Execute the real page module via the transpile/VM pattern in `admin-action-authorization.test.ts`: anonymous input redirects to `/sign-in` without a lookup; a signed-in Alice with `searchParams.userId=other-user` calls the loader once with `'alice'`. In `profile-menu.test.ts` replace placeholder assertions with guards for the new loader/view plus the existing no-legacy-action assertions.
  ```ts
  assert.ok(html.indexOf('Request approval') < html.indexOf('Solution approval'))
  assert.ok(html.indexOf('Solution approval') < html.indexOf('Final approval'))
  assert.match(html, /Route from Operations/)
  assert.match(html, /Any one of these people can approve/)
  assert.deepEqual(lookups, ['alice'])
  ```
- [ ] **Run the red test:** `npx tsx --test tests/regression/profile-menu.test.ts tests/regression/personal-approval-chain-page.test.ts`. Expect failure on the missing view or unwired page.
- [ ] **Implement the page and view.** Keep `auth()` and redirect before loading; pass only `session.user.id`. Use three labeled sections and an ordered list of applicable positions. Include the user-as-submitter assumptions for Request/Solution and user-as-both-requester-and-initiator assumption for Final. Include `The person who starts final approval can change which steps are required.` Make clear that request details, not this preview, show the chain for an existing submission. Render names only, not internal IDs or raw error details; no client component or dependency is needed.
- [ ] **Run the green test:** repeat the targeted command; require zero failures.
- [ ] **Smoke test the menu path.** Use a fresh local database with `prisma db push` and `npm run seed:dev` pointed explicitly at it; never use `app_db`. Run the app on a free loopback port, sign in as the seeded non-admin Alice, and click user menu → Approval Chain. Verify the Request route is from Operations, Solution and Final from Company, and Request Lead shows Casey and Quinn. Confirm a signed-out visit redirects to `/sign-in`.
- [ ] **Run repository verification:** `npm run check` and `graphify update .`; require green checks and a successful graph update. Review `git diff --check` and staging to exclude unrelated files.
- [ ] **Commit Task 2** with only the four Task 2 files: `fix: show approval chains on the profile page`.
