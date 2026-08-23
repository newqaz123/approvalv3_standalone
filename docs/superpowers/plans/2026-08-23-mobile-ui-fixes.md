# Mobile UI fixes — approved design

Branch: `fix/mobile-ui`
Worktree: `.worktrees/fix-mobile-ui`
Baseline: `9671d46` — `npm run check` green (532 tests)

TDD required. Existing style: `tests/regression/*.test.ts` (`node:test` + `readFileSync` + `assert.match` / `assert.doesNotMatch`).

Do not run production migrations. Do not push. Do not touch unrelated files (especially dirty analytics work on `main`).

## Task 1 — Profile menu

Problem: `src/components/mobile/mobile-nav.tsx` renders a dead `<div>` avatar. Desktop menu lives in `src/components/navigation/navbar.tsx` (hidden below `lg`).

Do:
- Extract a shared `UserMenu` used by both shells.
- Menu items: Profile `/profile`, Approval Chain `/approval-chain`, Change Password `/change-password`, Sign Out.
- Mobile avatar is a real `<button>` with `min-h-[44px] min-w-[44px]`, `aria-label="Open user menu"`.
- Keep desktop navbar behavior.

Tests: extend `tests/regression/profile-menu.test.ts` and `tests/regression/authenticated-shell-navbar.test.ts` so MobileNav is no longer a dead circle.

## Task 2 — Recent Engineering Cycles (`/analytics`)

File: `src/components/analytics/engineering-metrics.tsx`

Do:
- Keep the 3-column table from `md` up.
- On mobile, stack each cycle as a card: title, cycle time, Done / In Progress badge.
- Do not change data or KPIs.

Tests: new or extended regression asserts for `md:hidden` cards + `hidden md:` table.

## Task 3 — Engineering cards

File: `src/components/engineering/engineering-dashboard-tabs.tsx` (`FollowUpRequestRow`, used by Sent to Engineer and Follow-up work).

Problem: title + badges share a row with `shrink-0` PIC picker + Submit, so the title collapses to one letter.

Do:
- `< md`: stack title (wrap, 2 lines) → wrapping badges → meta → PIC picker → full-width Submit when `showSubmitSolution` → progress.
- Tap progress to expand sub-tasks (HoverCard is useless on touch). Desktop hover can stay.
- Desktop row layout unchanged from `md` up.

Tests: source-shape asserts for stacked mobile classes and tap-to-expand (not hover-only).

## Task 4 — Attachment preview

File: `src/components/requests/file-preview-dialog.tsx`

Problem: `h-[88vh] max-h-[88vh]` and PDF `min-h-[70vh]` fight the shared mobile bottom sheet (`max-h-[92svh]`).

Do:
- Drop hard viewport heights on touch / coarse pointer.
- Sticky header + download; preview area `min-h-0` fills the rest.
- Follow the existing modal budget pattern in `tests/regression/mobile-safari-fixes.test.ts`.

Tests: extend that file (or a sibling) so preview no longer forces `88vh` / `70vh` on the sheet.

## Task 5 — Request modal header overflow

Problem: copy-pasted desktop header (title + badge left, submitter + second X right) overlaps on phones. Dialog already has a close button.

Do:
- Shared `RequestModalHeader` for the copy-pasted headers.
- Mobile: stack title (wrap, pad for built-in X) → badge → avatar + name/email.
- Remove the duplicate custom X.
- Desktop side-by-side from `md` / `pointer-fine` up.

Known copies (verify and update all that match):
- `completed-request-modal.tsx`
- `approver-modal.tsx`
- `final-approval-modal.tsx`
- `completed-solution-modal.tsx`
- `status-modal.tsx`
- `solution-modal.tsx`
- `submit-final-approval-modal.tsx`
- `final-approval-resubmit-modal.tsx`
- `request-resubmit-modal.tsx` if it matches

Tests: source-shape asserts that the shared header is used and the duplicate X is gone.

## Task 6 — `/dashboard` list click

File: `src/components/dashboard/follow-up-dashboard.tsx`

Problem: Vaul list drawer and desktop aside are both mounted. Vaul stays `open` and steals pointer events, so visible rows (queue cards and “With Engineering” list) do not open detail.

Do:
- Mount Vaul **or** the aside, never both. Detect with JS `matchMedia('(pointer: fine)')` / existing `useMediaQuery`.
- Queue rows and list-drawer rows still call `setSelected`.
- On row tap: close the list drawer first, then open `RequestModalRouter`.
- Recent activity stays non-clickable (no `requestId`).
- Keep the existing row look (title, ★ Mine, status, days).

Tests: extend `tests/regression/follow-up-dashboard.test.ts` and `mobile-safari-fixes.test.ts` so both surfaces cannot be open at once and row select closes the list.

## Verification

After all tasks: `npm run check` must pass.

Commit on `fix/mobile-ui` with a clear message. Do not push. Do not merge.

## TDD

For each task:
1. Write the failing regression test.
2. Run it and confirm it fails for the missing behavior (not a typo).
3. Implement the minimum production change.
4. Re-run until green, then next task.
