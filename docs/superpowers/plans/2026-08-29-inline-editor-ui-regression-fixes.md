# Inline Editor UI Regression Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore visible curated colors inside the editor and keep inline-image uploads usable under React development Strict Mode.

**Architecture:** Keep persisted rich text semantic: editor-only presentation is derived exclusively from the curated palette maps and is stripped by the existing sanitizer before form state changes. Keep coordinator cleanup ownership in the hook, but fence effect-replay cleanup so Strict Mode setup-cleanup-setup does not dispose a still-mounted coordinator while a genuine unmount still disposes it.

**Tech Stack:** React 19, Next.js 15, TipTap 3, TypeScript, Node test runner, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-28-inline-image-resize-crop-design.md`

## Global Constraints

- Strict TDD: write and run a failing behavioral test before each production change.
- Persist only sanitized semantic color tokens; never persist arbitrary or trusted presentation `style` attributes.
- Editor colors must derive from `TEXT_COLOR_VALUES` and `HIGHLIGHT_COLOR_VALUES`; do not duplicate palette hex values.
- Preserve private authenticated inline-image storage, canonical `/api/inline-images/<UUID>` URLs, upload retry/removal, reset cleanup, and real-unmount cleanup.
- Do not change database schema, migrations, storage policy, dependencies, or `presentation-output/`.
- Use Portly for every test, build, graph, or browser-support command.
- Run `npm run check`, `graphify update .`, and `git diff --check` after changes.
- Full disposable-environment Playwright gate must remain non-vacuous and blocked when required `E2E_*` values are absent.

---

### Task 1: Render semantic palette tokens visibly inside the editor

**Files:**
- Modify: `src/components/rich-text/rich-text-color-extensions.ts`
- Modify: `tests/regression/rich-text-palette.test.ts`
- Modify: `tests/e2e/inline-description-images.spec.ts`

**Interfaces:**
- Consumes: `TEXT_COLOR_VALUES`, `HIGHLIGHT_COLOR_VALUES`, `sanitizeRichText`, TipTap mark `renderHTML`.
- Produces: editor DOM marks whose computed `color` / `background-color` match their semantic token while sanitized form HTML retains only `data-text-color` / `data-highlight`.

- [ ] **Step 1: Add failing regression coverage**

Extend the real TipTap editor tests to assert that serialized editor DOM HTML for `textColorToken=blue` and `highlightColorToken=green` contains presentation values derived from the exported palette maps, while passing that HTML through `sanitizeRichText` returns semantic attributes with no `style`.

- [ ] **Step 2: Run the focused test and verify RED**

Run through Portly:

```bash
npx tsx --test tests/regression/rich-text-palette.test.ts
```

Expected: FAIL because mark `renderHTML` currently emits semantic attributes only and the browser has no token presentation rules.

- [ ] **Step 3: Implement minimal trusted editor presentation**

Update both TipTap marks so `renderHTML` emits the semantic attribute plus an editor-only style whose value is looked up from the corresponding exported palette map after token validation. Never echo an authored CSS value. Keep `getJSON()` semantic and rely on the existing `onUpdate -> sanitizeRichText` boundary to strip the trusted display style before form state persistence.

- [ ] **Step 4: Strengthen the browser gate**

In `applyColorToken`, after asserting the semantic attribute, assert `getComputedStyle()` equals the matching exported palette value. This must distinguish blue/red text and green/blue highlights rather than accepting the browser-default yellow `<mark>` presentation.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run through Portly:

```bash
npx tsx --test tests/regression/rich-text-palette.test.ts tests/regression/rich-text-color-controls.test.ts tests/regression/rich-text-editor.test.ts tests/regression/rich-text-sanitizer.test.ts
```

Expected: PASS with stored HTML still style-free.

- [ ] **Step 6: Commit**

```bash
git add src/components/rich-text/rich-text-color-extensions.ts tests/regression/rich-text-palette.test.ts tests/e2e/inline-description-images.spec.ts
git commit -m "fix: render curated colors inside rich text editors"
```

---

### Task 2: Make coordinator disposal safe under Strict Mode effect replay

**Files:**
- Modify: `src/hooks/use-inline-description-images.ts`
- Modify: `tests/regression/inline-image-client.test.ts`
- Modify: `tests/e2e/inline-description-images.spec.ts`

**Interfaces:**
- Consumes: `createInlineImageCoordinator`, hook effect setup/cleanup, coordinator `dispose()`.
- Produces: a small testable disposal fence used by `useInlineDescriptionImages`; replayed cleanup is cancelled by immediate setup, genuine unmount disposes exactly once.

- [ ] **Step 1: Add failing lifecycle tests**

Add behavioral tests for a disposal fence that simulate:

```text
setup A -> cleanup A -> setup B -> deferred turn
```

and prove the coordinator remains upload-capable, then simulate:

```text
cleanup B -> deferred turn
```

and prove disposal runs exactly once. Also cover repeated cleanup and ensure staged-draft deletion semantics remain owned by the existing coordinator `dispose()`.

- [ ] **Step 2: Run the focused test and verify RED**

Run through Portly:

```bash
npx tsx --test tests/regression/inline-image-client.test.ts
```

Expected: FAIL because the hook currently disposes synchronously during effect cleanup and has no replay fence.

- [ ] **Step 3: Implement minimal replay-safe disposal**

Introduce a generation-based deferred disposal helper. Each effect setup advances/cancels the previous generation; cleanup queues disposal for its generation; the queued callback disposes only if no newer setup occurred. Wire it into `useInlineDescriptionImages` without changing `createInlineImageCoordinator().dispose()` behavior.

- [ ] **Step 4: Strengthen browser assertions**

Ensure paste and menu-upload scenarios assert that no text matching `Inline image coordinator is disposed` appears, uploads reach success, and inserted images use canonical private routes. Do not weaken failure placeholders or submit blocking.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run through Portly:

```bash
npx tsx --test tests/regression/inline-image-client.test.ts tests/regression/inline-image-editor.test.ts
```

Expected: PASS, including genuine-unmount cleanup coverage.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/use-inline-description-images.ts tests/regression/inline-image-client.test.ts tests/e2e/inline-description-images.spec.ts
git commit -m "fix: preserve inline image coordinator through strict mode replay"
```

---

### Task 3: UI acceptance, full verification, and review

**Files:**
- Modify only if a test exposes a task-scoped defect.
- Update: `graphify-out/` through `graphify update .`.

**Interfaces:**
- Consumes: Tasks 1-2 commits and the exact manual scenario shown in the supplied screenshot.
- Produces: regression evidence that colors are distinct and both upload paths succeed in development Strict Mode.

- [ ] **Step 1: Run the exact browser scenario**

Using the Portly-managed development server and agent-browser, create/open a request form, apply blue and red text, apply green and blue highlights, paste an image, and insert another via the toolbar. Inspect semantic attributes, computed styles, canonical image URLs, upload state, and browser errors.

Expected: blue/red text visibly differ; green/blue highlights visibly differ; neither placeholder reports a disposed coordinator; both images load.

- [ ] **Step 2: Run full verification**

Run through Portly:

```bash
npm run check
graphify update .
git diff --check
```

Expected: all checks pass, graph refresh succeeds, and diff check is clean.

- [ ] **Step 3: Independent review**

Review both task diffs for semantic-storage security, Strict Mode lifecycle correctness, genuine-unmount cleanup, and whether the tests fail against the original defects rather than asserting implementation details. Fix and re-review any Critical or Important finding.

- [ ] **Step 4: Commit acceptance-only changes if any**

Do not create an empty commit. If browser-gate assertions required a separate change not included in Tasks 1-2:

```bash
git add tests/e2e/inline-description-images.spec.ts graphify-out
git commit -m "test: cover inline editor ui regressions"
```
