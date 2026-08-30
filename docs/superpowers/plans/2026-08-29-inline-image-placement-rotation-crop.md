# Inline Image Placement, Rotation, and Crop Interaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make crop-region dragging follow the pointer, default new images to 160px inline placement, add non-destructive quarter-turn rotation, and prove editor/application/PDF/mobile parity.

**Architecture:** Extend the existing semantic image-presentation contract with allowlisted layout and rotation fields, and centralize quarter-turn crop mapping plus trusted frame geometry in pure modules. Keep the existing TipTap inline image node, switch its NodeView/output wrapper between inline and block presentation, and materialize only validated generated styles after sanitization.

**Tech Stack:** Next.js 15, React 19, TypeScript, TipTap 3/ProseMirror, sanitize-html, Lucide React, Puppeteer PDF HTML, Playwright, Node test runner, Portly, graphify.

**Spec:** `docs/superpowers/specs/2026-08-29-inline-image-placement-rotation-crop-design.md`

## Global Constraints

- Use strict red-green-refactor TDD: write one failing behavioral test, run it and confirm the expected failure, implement the minimum production change, rerun, then refactor.
- Use Portly for every bounded command, test, build, graph update, and browser server operation.
- Do not run production migrations, `prisma db push`, destructive/shared database operations, deploy, push, or touch `presentation-output/`.
- Keep dedicated inline-image assets separate from `file_attachments`; original private bytes remain unchanged and shared.
- Canonical image URLs remain `/api/inline-images/<UUID>` only; never persist external/blob/data URLs, arbitrary `style`, `class`, transforms, or colors.
- Layout accepts only `inline` or `block`; missing layout is legacy `block`.
- Rotation accepts only `0`, `90`, `180`, or `270`; missing rotation is `0`.
- New toolbar, paste, and drop insertions default to inline layout with integer display width `160`.
- Display width remains integer 80–2048; natural dimensions remain integer 1–65535; crop coordinates remain integer 0–10,000 and fully contained.
- Crop coordinates remain canonical against original source bytes; crop UI operates in the rotated visual coordinate space and maps back on Apply.
- HTML email continues redacting private images to the existing placeholder; plain text preserves words/alt text only.
- Mobile controls use at least 44×44 CSS-pixel targets, remain keyboard accessible, and cause no horizontal viewport overflow.
- The full browser gate must throw `BLOCKED_BROWSER_ENV` rather than skip when disposable `E2E_*` inputs are missing.
- Add no dependency; use existing Lucide React icons and `@radix-ui/react-tooltip@1.2.16`.
- Run `npm run check`, `graphify update .`, and `git diff --check` after implementation.

## File Structure

**Create**

- `src/lib/inline-images/rotation.ts` — pure quarter-turn normalization, direction cycling, rotated dimensions, and canonical↔visual normalized-crop mapping.
- `tests/regression/inline-image-rotation.test.ts` — pure rotation and round-trip geometry contract.

**Modify**

- `src/lib/inline-images/presentation.ts` — semantic layout/rotation parsing, serialization, and trusted rotated frame/scene geometry.
- `src/lib/rich-text-sanitizer.ts` — allow the two semantic attributes and pass them through the shared sanitizer.
- `src/components/rich-text/inline-image-crop.ts` — same-direction region movement and visual-rotation crop drafts.
- `src/components/rich-text/inline-image-crop-editor.tsx` — render and interact with the rotated source while committing canonical crop coordinates.
- `src/components/rich-text/inline-image-extension.ts` — TipTap attrs, legacy defaults, serialized attrs, and successful-upload defaults.
- `src/components/rich-text/rich-text-editor.tsx` — explicit inline/160 pending insertion defaults shared by toolbar, paste, and drop.
- `src/components/rich-text/inline-image-toolbar.tsx` — inline/block, rotate-left, rotate-right, and reset controls; block-only alignment controls.
- `src/components/rich-text/inline-image-node-view.tsx` — placement switching, rotation actions, rotated frame rendering, and final visible-frame selection chrome.
- `src/app/globals.css` — inline/block wrappers, trusted rotation scene, mobile toolbar layout, touch targets, and gesture behavior.
- `src/lib/rich-text-presentation.ts` — trusted app materialization for bare/cropped and inline/block rotated images while preserving email redaction.
- `src/lib/inline-images/pdf.ts` — owner-authorized rotated inline/block PDF materialization.
- `src/lib/pdf.ts` — PDF CSS for inline/block placement and transformed crop scenes.
- `tests/regression/inline-image-presentation.test.ts` — semantic contract and trusted geometry coverage.
- `tests/regression/rich-text-sanitizer.test.ts` — allowlist and malicious-transform rejection.
- `tests/regression/inline-image-crop.test.ts` — direction, rotated crop, keyboard, preset, zoom, and pinch behavior.
- `tests/regression/inline-image-editor.test.ts` — insertion defaults, TipTap attrs, toolbar behavior, and legacy compatibility.
- `tests/regression/inline-image-rendering.test.ts` — owner-scoped PDF matrix.
- `tests/regression/formatted-description-output.test.ts` — application and email output behavior.
- `tests/e2e/inline-description-images.spec.ts` — desktop bounding-box, save/reopen, parity, and mobile touch/responsive scenarios.

---

### Task 1: Semantic Layout, Quarter-Turn Rotation, and Trusted Geometry

**Files:**
- Create: `src/lib/inline-images/rotation.ts`
- Create: `tests/regression/inline-image-rotation.test.ts`
- Modify: `src/lib/inline-images/presentation.ts`
- Modify: `tests/regression/inline-image-presentation.test.ts`
- Modify: `src/lib/rich-text-sanitizer.ts`
- Modify: `tests/regression/rich-text-sanitizer.test.ts`
- Modify compile-only presentation constructors in existing regression tests as required by the new required fields.

**Interfaces:**
- Produces:
  - `type InlineImageLayout = 'inline' | 'block'`
  - `type InlineImageRotation = 0 | 90 | 180 | 270`
  - `const INLINE_IMAGE_DEFAULT_INLINE_WIDTH = 160`
  - `normalizeInlineImageRotation(value: unknown): InlineImageRotation`
  - `rotateInlineImage(rotation, direction: 'left' | 'right'): InlineImageRotation`
  - `rotatedInlineImageDimensions(width, height, rotation): { width: number; height: number }`
  - `canonicalCropToVisualCrop(crop, rotation): NormalizedInlineImageCrop`
  - `visualCropToCanonicalCrop(crop, rotation): NormalizedInlineImageCrop`
  - extended `InlineImagePresentation` with required `layout` and `rotation`
  - extended `InlineImageFrameGeometry` with trusted scene dimensions/offset and `rotation`.
- Consumes: existing normalized crop scale and bounded presentation parser.

- [ ] **Step 1: Write failing quarter-turn mapping tests**

Create `tests/regression/inline-image-rotation.test.ts` with exact cases:

```ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  canonicalCropToVisualCrop,
  normalizeInlineImageRotation,
  rotateInlineImage,
  rotatedInlineImageDimensions,
  visualCropToCanonicalCrop,
} from '@/lib/inline-images/rotation'

const crop = { x: 1000, y: 2000, width: 3000, height: 4000 }

describe('inline image quarter-turn rotation', () => {
  it('cycles left and right modulo 360 and rejects arbitrary angles', () => {
    assert.equal(rotateInlineImage(0, 'left'), 270)
    assert.equal(rotateInlineImage(270, 'right'), 0)
    assert.equal(rotateInlineImage(90, 'right'), 180)
    assert.equal(normalizeInlineImageRotation(45), 0)
    assert.equal(normalizeInlineImageRotation('90'), 90)
  })

  it('maps canonical crops into each visual orientation', () => {
    assert.deepEqual(canonicalCropToVisualCrop(crop, 0), crop)
    assert.deepEqual(canonicalCropToVisualCrop(crop, 90), { x: 4000, y: 1000, width: 4000, height: 3000 })
    assert.deepEqual(canonicalCropToVisualCrop(crop, 180), { x: 6000, y: 4000, width: 3000, height: 4000 })
    assert.deepEqual(canonicalCropToVisualCrop(crop, 270), { x: 2000, y: 6000, width: 4000, height: 3000 })
  })

  it('round-trips every visual crop and swaps quarter-turn dimensions', () => {
    for (const rotation of [0, 90, 180, 270] as const) {
      assert.deepEqual(
        visualCropToCanonicalCrop(canonicalCropToVisualCrop(crop, rotation), rotation),
        crop,
      )
    }
    assert.deepEqual(rotatedInlineImageDimensions(640, 480, 90), { width: 480, height: 640 })
    assert.deepEqual(rotatedInlineImageDimensions(640, 480, 180), { width: 640, height: 480 })
  })
})
```

- [ ] **Step 2: Run the new test and verify RED**

Run:

```bash
job_id="$(portly temp 'npx tsx --test tests/regression/inline-image-rotation.test.ts' --path . --timeout 10m)" && portly wait "$job_id"
```

Expected: FAIL because `src/lib/inline-images/rotation.ts` does not exist.

- [ ] **Step 3: Implement minimal pure rotation functions**

Create `rotation.ts` with the four allowlisted rotations and these coordinate formulas, using `INLINE_IMAGE_CROP_SCALE`:

```ts
export const INLINE_IMAGE_ROTATIONS = [0, 90, 180, 270] as const
export type InlineImageRotation = (typeof INLINE_IMAGE_ROTATIONS)[number]

export function canonicalCropToVisualCrop(crop, rotation) {
  const s = INLINE_IMAGE_CROP_SCALE
  if (rotation === 90) return { x: s - crop.y - crop.height, y: crop.x, width: crop.height, height: crop.width }
  if (rotation === 180) return { x: s - crop.x - crop.width, y: s - crop.y - crop.height, width: crop.width, height: crop.height }
  if (rotation === 270) return { x: crop.y, y: s - crop.x - crop.width, width: crop.height, height: crop.width }
  return { ...crop }
}
```

Implement the inverse as `canonicalCropToVisualCrop(crop, inverseRotation(rotation))`, parse only exact decimal strings/numbers for the four values, and cycle left/right modulo 360.

- [ ] **Step 4: Run rotation tests and verify GREEN**

Run the Step 2 command. Expected: PASS.

- [ ] **Step 5: Write failing presentation and sanitizer tests**

Add cases asserting:

```ts
assert.deepEqual(parseInlineImagePresentation({}), {
  displayWidth: null,
  naturalWidth: null,
  naturalHeight: null,
  crop: null,
  layout: 'block',
  rotation: 0,
})

const parsed = parseInlineImagePresentation({
  'data-layout': 'inline',
  'data-rotation': '270',
})
assert.equal(parsed.layout, 'inline')
assert.equal(parsed.rotation, 270)

assert.deepEqual(
  sanitizeInlineImagePresentationAttributes({
    'data-layout': 'float-left',
    'data-rotation': '45deg',
  }),
  {},
)
```

Add sanitizer input containing `data-layout="inline" data-rotation="90" style="transform:rotate(12deg)" class="evil"` and assert only the semantic attributes survive. Add invalid layout/rotation cases that retain the canonical image but drop those attributes.

Add geometry cases for crop `{x:0,y:0,width:5000,height:10000}`, natural `800×600`, display width `200`: rotation 0 produces frame `200×300`; rotation 90 produces frame `200×133.333…`, with scene dimensions swapped and a trusted numeric 90° value.

- [ ] **Step 6: Run focused tests and verify RED**

Run:

```bash
job_id="$(portly temp 'npx tsx --test tests/regression/inline-image-presentation.test.ts tests/regression/rich-text-sanitizer.test.ts' --path . --timeout 10m)" && portly wait "$job_id"
```

Expected: FAIL because layout/rotation are not parsed, serialized, sanitized, or included in geometry.

- [ ] **Step 7: Extend the presentation contract and geometry**

In `presentation.ts`:

```ts
export type InlineImageLayout = 'inline' | 'block'
export const INLINE_IMAGE_DEFAULT_INLINE_WIDTH = 160

export type InlineImagePresentation = {
  displayWidth: number | null
  naturalWidth: number | null
  naturalHeight: number | null
  crop: NormalizedInlineImageCrop | null
  layout: InlineImageLayout
  rotation: InlineImageRotation
}
```

Parse layout with missing/invalid → `block`; parse rotation with missing/invalid → `0`. Serialize `data-layout` only for explicit `inline` and `data-rotation` only when nonzero, so legacy block/0 output remains compact. Extend geometry with:

```ts
sceneWidth: number
sceneHeight: number
sceneOffsetX: number
sceneOffsetY: number
rotation: InlineImageRotation
```

Use the rotated crop aspect for frame height. For 90/270, `sceneWidth = frameHeight`, `sceneHeight = frameWidth`; otherwise scene size equals frame size. Center the scene before applying rotation.

In `rich-text-sanitizer.ts`, allow `data-layout` and `data-rotation` on `img` and continue delegating values to `sanitizeInlineImagePresentationAttributes()`.

- [ ] **Step 8: Run focused tests and full typecheck**

Run:

```bash
job_id="$(portly temp 'npx tsc --noEmit && npx tsx --test tests/regression/inline-image-rotation.test.ts tests/regression/inline-image-presentation.test.ts tests/regression/rich-text-sanitizer.test.ts' --path . --timeout 10m)" && portly wait "$job_id"
```

Expected: PASS. Update existing presentation fixtures only to include explicit `layout: 'block', rotation: 0`; do not weaken the required type.

- [ ] **Step 9: Commit**

```bash
git add src/lib/inline-images/rotation.ts src/lib/inline-images/presentation.ts src/lib/rich-text-sanitizer.ts tests/regression/inline-image-rotation.test.ts tests/regression/inline-image-presentation.test.ts tests/regression/rich-text-sanitizer.test.ts tests/regression
git commit -m "feat: define inline image layout and rotation geometry"
```

---

### Task 2: Same-Direction Crop Drag and Rotated Visual Crop State

**Files:**
- Modify: `src/components/rich-text/inline-image-crop.ts`
- Modify: `src/components/rich-text/inline-image-crop-editor.tsx`
- Modify: `tests/regression/inline-image-crop.test.ts`

**Interfaces:**
- Consumes: `InlineImagePresentation.layout`, `.rotation`, `canonicalCropToVisualCrop`, `visualCropToCanonicalCrop`, `rotatedInlineImageDimensions`.
- Produces:
  - `InlineImageCropDraft.rotation: InlineImageRotation`
  - crop draft coordinates in visual orientation;
  - `inlineImageCropApplyAttributes()` mapping visual crop back to canonical source attrs;
  - pointer and keyboard movement sharing the same positive-direction rule.

- [ ] **Step 1: Write the failing inversion regression**

Replace/add the region movement test:

```ts
it('moves the crop box in the same direction as pointer and arrow deltas', () => {
  const base = createInlineImageCropDraft(presentation({
    crop: { x: 2000, y: 1000, width: 3000, height: 4000 },
  }))
  assert.deepEqual(panInlineImageCrop(base, 500, 250).crop, {
    x: 2500, y: 1250, width: 3000, height: 4000,
  })
  assert.equal(stepInlineImageCropRegion(base, 'ArrowRight', false).crop.x, 2010)
  assert.equal(stepInlineImageCropRegion(base, 'ArrowDown', false).crop.y, 1010)
})
```

Name the production change that makes this pass: `panInlineImageCrop` adds deltas, and keyboard no longer negates them.

- [ ] **Step 2: Run crop tests and verify RED**

```bash
job_id="$(portly temp 'npx tsx --test tests/regression/inline-image-crop.test.ts' --path . --timeout 10m)" && portly wait "$job_id"
```

Expected: FAIL showing the box moved to `1500/750` instead of `2500/1250`.

- [ ] **Step 3: Apply the minimal direction fix**

Change only:

```ts
crop: clampCrop({ ...draft.crop, x: draft.crop.x + dx, y: draft.crop.y + dy })
```

and call `panInlineImageCrop(draft, dx, dy)` from `stepInlineImageCropRegion()`.

- [ ] **Step 4: Run crop tests and verify GREEN**

Run Step 2. Expected: PASS after updating old inverted expectations, not weakening assertions.

- [ ] **Step 5: Write failing rotated-crop draft tests**

Add tests for a 90° presentation:

```ts
const rotated = createInlineImageCropDraft(presentation({
  rotation: 90,
  crop: { x: 1000, y: 2000, width: 3000, height: 4000 },
}))
assert.deepEqual(rotated.crop, { x: 4000, y: 1000, width: 4000, height: 3000 })

const applied = inlineImageCropApplyAttributes({
  draft: rotated,
  displayWidth: 160,
  naturalWidth: 800,
  naturalHeight: 600,
})
assert.deepEqual(
  { x: applied.cropX, y: applied.cropY, width: applied.cropWidth, height: applied.cropHeight },
  { x: 1000, y: 2000, width: 3000, height: 4000 },
)
assert.equal(applied.rotation, 90)
assert.equal(applied.layout, 'inline')
```

Also test 90° preset aspect uses rotated dimensions `600×800`, boundary movement, handle semantics, Reset, zoom, wheel, and pinch.

- [ ] **Step 6: Run crop tests and verify RED**

Run Step 2. Expected: FAIL because crop drafts do not project rotation or map Apply back to canonical coordinates.

- [ ] **Step 7: Implement visual crop projection**

- Add `rotation` and `layout` to `InlineImageCropDraft`.
- In `createInlineImageCropDraft`, project canonical crop via `canonicalCropToVisualCrop`.
- Pass rotated natural dimensions to aspect presets and display-delta conversion.
- In `inlineImageCropApplyAttributes`, map `draft.crop` through `visualCropToCanonicalCrop` before serialization and retain layout/rotation.
- In `inline-image-crop-editor.tsx`, render the source in a bounded rotated scene using shared trusted geometry; style the region from visual draft coordinates.
- Preserve the existing captured visible width within 1 CSS pixel.
- Keep `touch-action` behavior scoped to the crop surface and preserve pointer capture/rebase logic.

- [ ] **Step 8: Run crop regression and typecheck**

```bash
job_id="$(portly temp 'npx tsc --noEmit && npx tsx --test tests/regression/inline-image-crop.test.ts tests/regression/inline-image-rotation.test.ts' --path . --timeout 10m)" && portly wait "$job_id"
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/components/rich-text/inline-image-crop.ts src/components/rich-text/inline-image-crop-editor.tsx tests/regression/inline-image-crop.test.ts
git commit -m "fix: make rotated crop controls follow input"
```

---

### Task 3: TipTap Metadata and Inline 160px Insertion Defaults

**Files:**
- Modify: `src/components/rich-text/inline-image-extension.ts`
- Modify: `src/components/rich-text/rich-text-editor.tsx`
- Modify: `src/components/rich-text/inline-image-node-view.tsx` retry path only
- Modify: `tests/regression/inline-image-editor.test.ts`

**Interfaces:**
- Consumes: `INLINE_IMAGE_DEFAULT_INLINE_WIDTH`, `InlineImageLayout`, `InlineImageRotation`.
- Produces:
  - node attrs `layout` and `rotation`;
  - `inlineImageUploadSuccessAttributes(upload, alt, align, presentationDefaults?)` preserving inline/160 defaults;
  - one shared `newInlineImagePlacementAttributes()` for toolbar, paste, drop, and retry.

- [ ] **Step 1: Write failing insertion/default tests**

Add behavioral assertions that:

```ts
assert.deepEqual(newInlineImagePlacementAttributes(), {
  align: 'center',
  layout: 'inline',
  rotation: 0,
  displayWidth: 160,
})
```

Parse legacy `<img src="/api/inline-images/<uuid>" data-align="right">` and assert `layout === 'block'`, `rotation === 0`. Parse/render an explicit inline 90° node and assert sanitized HTML contains `data-layout="inline" data-rotation="90" data-width="160"`. Exercise the real FileHandler insertion helper for toolbar/paste/drop positions rather than source-regex checks.

- [ ] **Step 2: Run editor tests and verify RED**

```bash
job_id="$(portly temp 'npx tsx --test tests/regression/inline-image-editor.test.ts' --path . --timeout 10m)" && portly wait "$job_id"
```

Expected: FAIL because new placement attrs and node attrs do not exist.

- [ ] **Step 3: Implement minimal semantic node/insertion changes**

In `inline-image-extension.ts`:

```ts
export function newInlineImagePlacementAttributes() {
  return { align: 'center' as const, layout: 'inline' as const, rotation: 0 as const, displayWidth: 160 }
}
```

- Add `layout` and `rotation` node attrs.
- Include them in `INLINE_IMAGE_PRESENTATION_DATA_ATTRIBUTES`, `inlineImageNodePresentation`, `parseHTML`, and `renderHTML` through the shared parser/serializer.
- Make pending insertion attrs spread `newInlineImagePlacementAttributes()`.
- Make successful upload and retry retain the node’s current layout, rotation, and display width rather than overwriting them.
- Keep legacy parsed nodes block/0 through shared parser defaults.

- [ ] **Step 4: Run editor tests and typecheck**

```bash
job_id="$(portly temp 'npx tsc --noEmit && npx tsx --test tests/regression/inline-image-editor.test.ts tests/regression/inline-image-client.test.ts' --path . --timeout 10m)" && portly wait "$job_id"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/rich-text/inline-image-extension.ts src/components/rich-text/rich-text-editor.tsx src/components/rich-text/inline-image-node-view.tsx tests/regression/inline-image-editor.test.ts
git commit -m "feat: default new rich text images inline"
```

---

### Task 4: Editor Placement and Rotation Controls

**Files:**
- Modify: `src/components/rich-text/inline-image-toolbar.tsx`
- Modify: `src/components/rich-text/inline-image-node-view.tsx`
- Modify: `src/app/globals.css`
- Modify: `tests/regression/inline-image-editor.test.ts`
- Modify: `tests/regression/inline-image-crop.test.ts` where NodeView presentation fixtures require final geometry.

**Interfaces:**
- Consumes: `rotateInlineImage`, extended frame geometry, semantic layout/rotation attrs.
- Produces:
  - toolbar callbacks `onLayoutChange`, `onRotateLeft`, `onRotateRight`, `onResetRotation`;
  - block-only alignment controls;
  - `data-layout` and trusted rotated scene on the final NodeView frame.

- [ ] **Step 1: Write failing toolbar and NodeView behavior tests**

Add tests that render/invoke the real toolbar presenter and assert:

- Inline and Block buttons have accessible names and correct `aria-pressed`.
- Alignment buttons are disabled or absent while inline and return with stored alignment in block mode.
- Rotate right cycles `0→90→180→270→0`; rotate left maps `0→270`; reset stores 0.
- Placement and rotation callbacks commit one selection-preserving node transaction.
- Crop mode disables/hides placement and rotation actions.
- Final frame carries `data-layout="inline"` and width 160; block mode carries a full-row wrapper.

- [ ] **Step 2: Run editor tests and verify RED**

Use the Task 3 focused command. Expected: FAIL because toolbar controls and NodeView behavior are missing.

- [ ] **Step 3: Implement toolbar controls with existing icons**

Use Lucide `WrapText` or `BetweenHorizontalStart` for placement, `RotateCcw` for rotate-left, `RotateCw` for rotate-right, and a labeled reset action. Keep every icon `aria-hidden="true"`; the button supplies the accessible name. Do not add a package.

Change `ToolbarIconButton` mobile classes to preserve 24px desktop targets and at least 44px coarse-pointer targets through CSS. Keep 8px coarse-pointer spacing where feasible. Allow the toolbar to wrap or use an existing overflow treatment without horizontal viewport scrolling; do not hide critical Apply/Cancel/Remove actions.

- [ ] **Step 4: Implement NodeView placement and rotated scene**

- Read `layout`/`rotation` only from `inlineImageNodePresentation(node.attrs)`.
- Give `NodeViewWrapper` `data-layout` and classes/CSS that are `inline`/`inline-block` for inline and full-width block for block.
- Keep `.inline-image-node-frame` shrink-wrapped around the final visible frame.
- Render a generated rotation scene from shared geometry for rotated bare and cropped images; do not duplicate crop math.
- Pass final visible frame width to resize and same-size crop capture.
- Commit placement and rotation through `applyInlineImageAttributes()`.
- Keep block alignment metadata stored while inline but visually inactive.

- [ ] **Step 5: Implement responsive CSS**

Add semantic selectors such as:

```css
[data-inline-image-node][data-layout='inline'] {
  display: inline;
  width: auto;
  max-width: 100%;
  vertical-align: middle;
}
[data-inline-image-node][data-layout='inline'] .inline-image-node-frame {
  display: inline-block;
  margin: 0 .125rem;
  vertical-align: middle;
}
[data-inline-image-node][data-layout='block'] {
  display: block;
  width: 100%;
}
.inline-image-rotation-scene {
  position: absolute;
  transform-origin: center;
}
.inline-image-crop-surface { touch-action: none; overscroll-behavior: contain; }
```

Use geometry-provided numeric scene dimensions/offsets and allowlisted rotation only in React style values. Preserve `max-width: 100%`, visible focus, no animation, and coarse-pointer 44px targets.

- [ ] **Step 6: Run editor/crop tests and typecheck**

```bash
job_id="$(portly temp 'npx tsc --noEmit && npx tsx --test tests/regression/inline-image-editor.test.ts tests/regression/inline-image-crop.test.ts tests/regression/inline-image-rotation.test.ts' --path . --timeout 10m)" && portly wait "$job_id"
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/rich-text/inline-image-toolbar.tsx src/components/rich-text/inline-image-node-view.tsx src/app/globals.css tests/regression/inline-image-editor.test.ts tests/regression/inline-image-crop.test.ts
git commit -m "feat: add inline placement and image rotation controls"
```

---

### Task 5: Trusted Application and Email Output

**Files:**
- Modify: `src/lib/rich-text-presentation.ts`
- Modify: `src/app/globals.css`
- Modify: `tests/regression/formatted-description-output.test.ts`

**Interfaces:**
- Consumes: sanitized `InlineImagePresentation`, rotated frame geometry.
- Produces: trusted app wrappers carrying only generated `data-layout`, `data-align`, and numeric style geometry; unchanged private-image email redaction.

- [ ] **Step 1: Write failing application-output matrix tests**

For one canonical private image, generate and assert all representative paths:

```ts
const cases = [
  { layout: 'inline', rotation: 0, cropped: false },
  { layout: 'inline', rotation: 90, cropped: false },
  { layout: 'inline', rotation: 270, cropped: true },
  { layout: 'block', rotation: 180, cropped: true },
] as const
```

Assert inline output uses an inline placement/frame with 160px final width and surrounding `before`/`after` text remains in the same `<p>`. Assert block output uses a block placement with exact alignment. Assert 90/270 swap visible aspect. Assert malicious stored style/class/45° transform never reaches generated output.

Retain/add email assertions that canonical URLs, resolved data URIs, `data-layout`, and `data-rotation` do not leak image bytes and the placeholder/alt words remain.

- [ ] **Step 2: Run formatted output tests and verify RED**

```bash
job_id="$(portly temp 'npx tsx --test tests/regression/formatted-description-output.test.ts' --path . --timeout 10m)" && portly wait "$job_id"
```

Expected: FAIL because app materialization ignores layout/rotation.

- [ ] **Step 3: Implement one trusted image materializer**

Refactor the existing cropped-only replacement into a function that:

1. receives already-sanitized `<img>` attributes;
2. parses the shared presentation;
3. leaves safe unrotated legacy fallback behavior when geometry cannot be produced;
4. emits inline or block trusted wrapper markup;
5. emits a centered rotation scene and canonical crop-positioned image for rotated/cropped paths;
6. serializes only finite numbers from shared geometry and fixed allowlisted classes/rotation;
7. never changes `materializeRichTextForEmail()` image redaction order.

Do not accept user-provided style/class at this boundary.

- [ ] **Step 4: Add application CSS**

Make `.rich-text__image-frame[data-layout='inline']` inline-block/middle-aligned with compact inline margins and no block margin. Keep block frames block-displayed with existing margin/alignment. Scope absolute image rules to generated crop/rotation scene children so ordinary bare inline images remain measurable.

- [ ] **Step 5: Run output tests and typecheck**

```bash
job_id="$(portly temp 'npx tsc --noEmit && npx tsx --test tests/regression/formatted-description-output.test.ts tests/regression/rich-text-sanitizer.test.ts' --path . --timeout 10m)" && portly wait "$job_id"
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/rich-text-presentation.ts src/app/globals.css tests/regression/formatted-description-output.test.ts
git commit -m "feat: render inline rotated images in application views"
```

---

### Task 6: Owner-Scoped PDF Placement and Rotation Parity

**Files:**
- Modify: `src/lib/inline-images/pdf.ts`
- Modify: `src/lib/pdf.ts`
- Modify: `tests/regression/inline-image-rendering.test.ts`

**Interfaces:**
- Consumes: the same parsed presentation and trusted geometry as Task 5.
- Produces: authorized PDF HTML for inline/block × quarter-turn × bare/cropped without changing owner queries or reads.

- [ ] **Step 1: Write failing behavioral PDF matrix tests**

Extend the existing owner-scoped test to loop:

```ts
for (const layout of ['inline', 'block'] as const) {
  for (const rotation of [0, 90, 180, 270] as const) {
    for (const cropped of [false, true]) {
      // resolveInlineImagesForPdf(...)
      // assert exact data-layout, data-rotation/scene transform,
      // trusted width/aspect, crop geometry, and no canonical URL remains.
    }
  }
}
```

For block cases, additionally loop left/center/right alignment. For every matrix invocation assert owner-scoped asset lookup, one authorized file read per distinct asset, exact trusted data URI, and no change to authorization predicates.

- [ ] **Step 2: Run PDF regression and verify RED**

```bash
job_id="$(portly temp 'npx tsx --test tests/regression/inline-image-rendering.test.ts' --path . --timeout 10m)" && portly wait "$job_id"
```

Expected: FAIL because PDF output ignores layout/rotation.

- [ ] **Step 3: Implement PDF trusted geometry output**

Update the existing authorized image tag renderer to reuse the same geometry fields and fixed wrapper structure as app output, substituting only the authorized data URI and asset-row dimensions. Do not trust persisted natural dimensions for PDF geometry. Preserve alt fallback on missing/not-owned/read-failed assets.

- [ ] **Step 4: Update PDF CSS**

- Inline frames: `display:inline-block; vertical-align:middle; margin-inline:.125rem; break-inside:avoid`.
- Block frames: existing block margin/alignment behavior.
- Rotation scene: centered absolute scene with transform origin center.
- Inner source: existing absolute crop percentages.
- No raw authored style interpolation.

- [ ] **Step 5: Run PDF and output regressions**

```bash
job_id="$(portly temp 'npx tsc --noEmit && npx tsx --test tests/regression/inline-image-rendering.test.ts tests/regression/formatted-description-output.test.ts' --path . --timeout 10m)" && portly wait "$job_id"
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/inline-images/pdf.ts src/lib/pdf.ts tests/regression/inline-image-rendering.test.ts
git commit -m "feat: preserve image placement and rotation in pdf output"
```

---

### Task 7: Desktop Browser Acceptance and Persistence

**Files:**
- Modify: `tests/e2e/inline-description-images.spec.ts`

**Interfaces:**
- Consumes: production toolbar, crop surface, sanitized persistence, application view.
- Produces: machine-checkable bounding-box and serialized-metadata evidence under the existing fail-closed disposable E2E gate.

- [ ] **Step 1: Strengthen the crop drag helper and add RED assertions**

Change `panCropSurface()` to return before/after `DOMRect` data and assert a +24/+16 pointer drag yields positive `left/top` movement (within clamp/tolerance), not merely a changed style string:

```ts
expect(after.left).toBeGreaterThan(before.left)
expect(after.top).toBeGreaterThan(before.top)
```

Run against current HEAD before implementation where possible; expected pre-fix failure is inverted movement. If Tasks 1–6 are already present in the execution order, preserve the RED evidence from Task 2 and document this browser assertion as parity coverage rather than fabricating a second RED.

- [ ] **Step 2: Add inline text and rotation browser assertions**

In the existing disposable request flow:

- type `Before `, insert/upload the image at the cursor, then type ` after`;
- assert serialized `data-layout="inline" data-width="160"`;
- compare range/image bounding boxes to prove same paragraph and same line when editor width permits;
- rotate right and assert width remains within 1px while height changes to the swapped aspect;
- crop in the rotated view, drag right/down, Apply, save, reopen, and assert layout/rotation/crop attrs persist;
- switch block, verify left/center/right movement, switch inline, and verify stored alignment no longer changes inline X positioning;
- verify application view bounding boxes and transform metadata match the editor.

- [ ] **Step 3: Run the focused browser gate through Portly**

```bash
job_id="$(portly temp 'npx playwright test tests/e2e/inline-description-images.spec.ts --grep "placement|rotation|crop"' --path . --timeout 30m)" && portly wait "$job_id"
```

Expected with complete disposable environment: PASS. Expected without required `E2E_*` values: explicit thrown `BLOCKED_BROWSER_ENV`, never skipped. Record the exact outcome in the task report.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/inline-description-images.spec.ts
git commit -m "test: cover inline rotation and crop persistence"
```

---

### Task 8: Mobile UI and Touch Acceptance

**Files:**
- Modify: `tests/e2e/inline-description-images.spec.ts`
- Modify: `src/app/globals.css` only if the failing mobile test proves a production defect.

**Interfaces:**
- Consumes: existing fail-closed E2E fixture and production mobile editor.
- Produces: automated 375×812 touch-focused scenario plus overflow checks at 320, 414, and 768 widths.

- [ ] **Step 1: Write the failing mobile test**

Add a dedicated test with:

```ts
test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true })
```

The test must assert real outcomes:

- `document.documentElement.scrollWidth <= window.innerWidth`;
- toolbar/crop controls are inside the viewport;
- every visible image action and crop handle has bounding box width/height ≥44px under coarse-pointer emulation;
- adjacent toolbar targets have non-overlapping boxes and intended gap;
- inline image is 160px or responsively clamped, with text before/after in the same paragraph;
- a dispatched touch/pointer sequence moves crop `left/top` in the same positive direction;
- pinch sequence increases zoom;
- rotated crop uses the visible 90° orientation;
- `Apply`, `Cancel`, `Reset`, save, and reopen remain reachable;
- the editor does not scroll or create a text selection during the crop gesture.

Loop viewport widths `320`, `414`, and `768` for overflow/responsive assertions without repeating database mutation setup.

- [ ] **Step 2: Run mobile test and verify RED**

```bash
job_id="$(portly temp 'npx playwright test tests/e2e/inline-description-images.spec.ts --grep "mobile inline image"' --path . --timeout 30m)" && portly wait "$job_id"
```

Expected with disposable environment: at least one current toolbar/placement assertion fails before responsive CSS is complete. Without environment: `BLOCKED_BROWSER_ENV`; do not change the test to skip.

- [ ] **Step 3: Implement only evidence-driven mobile CSS fixes**

If RED identifies overflow or undersized targets, adjust mobile/coarse-pointer rules only:

- 44×44 controls;
- ≥8px target spacing where feasible;
- wrapped/contained toolbar with critical controls visible;
- `max-width:100%`, `min-inline-size:0`, and no viewport overflow;
- `touch-action:none` and `overscroll-behavior:contain` only on the crop interaction surface;
- no hover-only control exposure.

Do not redesign unrelated editor controls.

- [ ] **Step 4: Re-run mobile and desktop browser scenarios**

Run Step 2, then Task 7 Step 3. Expected with environment: PASS. Otherwise record the unchanged fail-closed block and perform live `agent-browser` acceptance against the Portly-managed dev server without claiming the release gate passed.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/inline-description-images.spec.ts src/app/globals.css
git commit -m "test: verify mobile inline image interactions"
```

---

### Task 9: Whole-Branch Verification, Graph Update, and Review

**Files:**
- Modify: `.superpowers/sdd/2026-08-29-inline-image-placement-rotation-crop/progress.md`
- Create task/review reports under `.superpowers/sdd/2026-08-29-inline-image-placement-rotation-crop/` during subagent-driven execution.

**Interfaces:**
- Consumes: all prior commits and browser evidence.
- Produces: fresh controller-side verification, graph update, review closure, and explicit residual-risk statement.

- [ ] **Step 1: Run focused regression tests together**

```bash
job_id="$(portly temp 'npx tsx --test tests/regression/inline-image-rotation.test.ts tests/regression/inline-image-presentation.test.ts tests/regression/inline-image-crop.test.ts tests/regression/inline-image-editor.test.ts tests/regression/formatted-description-output.test.ts tests/regression/inline-image-rendering.test.ts tests/regression/rich-text-sanitizer.test.ts' --path . --timeout 15m)" && portly wait "$job_id"
```

Expected: PASS.

- [ ] **Step 2: Run the complete repository check**

```bash
job_id="$(portly temp 'npm run check' --path . --timeout 30m)" && portly wait "$job_id"
```

Expected: TypeScript, management tests, and every regression test PASS with no warnings/errors.

- [ ] **Step 3: Update graphify and inspect repository integrity**

```bash
job_id="$(portly temp 'graphify update .' --path . --timeout 10m)" && portly wait "$job_id"
git diff --check
git status --short
git log -12 --oneline
```

Expected: graph update succeeds, diff check is empty, and only intentional SDD/graph artifacts are dirty before their final commit.

- [ ] **Step 4: Run task reviews and authoritative whole-branch review**

Under subagent-driven development, each task receives spec-compliance review followed by code-quality review. After all task fixes are review-clean, dispatch one whole-branch reviewer against the merge base through current HEAD. Critical/Important findings require a new failing test, minimal fix, focused verification, and re-review.

- [ ] **Step 5: Update the SDD ledger**

Record:

- RED and GREEN commands per task;
- commit hashes;
- review verdicts and follow-up hashes;
- exact `npm run check` totals;
- desktop/mobile browser outcome;
- `BLOCKED_BROWSER_ENV` if credentials/records remain unavailable;
- live browser artifact paths without claiming they equal the full gate;
- residual risks.

- [ ] **Step 6: Commit final evidence artifacts**

```bash
git add .superpowers/sdd graphify-out
git commit -m "docs: record inline image placement verification"
```

Do not commit unrelated generated files. If `graphify-out` has no meaningful tracked changes, omit it from the commit.
