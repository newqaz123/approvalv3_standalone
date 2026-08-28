# Inline Image Resize, Crop, and Curated Colors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the selected-image form row with a floating toolbar, add accessible drag resize and non-destructive inline crop, and add curated text/highlight colors that persist safely across app, PDF, and HTML email output.

**Architecture:** Keep original private image bytes and canonical URLs unchanged. Persist bounded image placement metadata and semantic color tokens in sanitized HTML, drive editor interactions through testable pure geometry/controllers, and materialize only trusted numeric styles and hard-coded palette colors after sanitization for app/email/PDF output.

**Tech Stack:** Next.js 15.5.23, React 19, TipTap 3.30.1/ProseMirror, TypeScript, sanitize-html 2.17.5, Radix Popover/Dropdown/Tooltip, Tailwind CSS, Puppeteer PDF, node:test/tsx, Playwright, Portly, agent-browser.

**Spec:** `docs/superpowers/specs/2026-08-28-inline-image-resize-crop-design.md`

## Global Constraints

- Use TDD: observe focused RED for the intended missing behavior before implementation, then focused GREEN and `npm run check`.
- Use Portly for every test, build, graph refresh, and persistent server action. Start with `portly status`; reuse `ApprovalAppV3-InlineImages/dev` on port 3101 when healthy.
- Do not run production migrations, `prisma db push`, destructive database commands, seed a shared database, deploy, push, or touch `presentation-output/`.
- No database migration is required. Original private image bytes, asset ownership, references, canonical URLs, quotas, retention, and authenticated GET behavior remain unchanged.
- Stored descriptions may contain only canonical `/api/inline-images/<UUID>` sources, bounded image data attributes, and exact semantic color/highlight tokens. Never store arbitrary `style`, `class`, blob/data/external image URLs, crop-generated URLs, or arbitrary colors.
- Display width is integer 80–2048. Natural dimensions are integer 1–65535. Crop coordinates use integer 0–10,000 units and must remain fully inside the source.
- Calm Document text tokens are exactly `ink`, `slate`, `blue`, `teal`, `green`, `amber`, `red`; highlight tokens are exactly `yellow`, `blue`, `green`, `pink`, `violet`, `red`, `gray`.
- Preserve approved colors in application views, PDF, and HTML email; plain text keeps words only. Images in email remain `[Image: alt]` placeholders with no private URL or bytes.
- Do not install or replace the editor with the Aslam97 Minimal Tiptap registry. Its MIT interaction patterns may be referenced; any directly copied code must retain required license notice. Keep the project’s custom sanitizer, upload coordinator, NodeView, and output security boundaries.
- Add only `@radix-ui/react-tooltip@1.2.16`; do not add a crop/resize library. Pure project-owned geometry keeps stored metadata and output rendering aligned.
- Keep each new file focused. Do not grow `inline-image-node-view.tsx` into a combined geometry, toolbar, crop, and lifecycle module.
- After source changes run `graphify update .`; the optional `tree_sitter_sql` warning is non-blocking.

## File Structure

### New focused modules

- `src/lib/inline-images/presentation.ts` — bounded placement metadata, crop/resize geometry, serialization, and trusted image-frame style generation.
- `src/lib/rich-text-palette.ts` — token types, exact Calm Document maps, validation, and trusted app/email/PDF color materialization.
- `src/components/rich-text/rich-text-color-extensions.ts` — restricted TipTap text-color/highlight marks and commands.
- `src/components/rich-text/rich-text-color-controls.tsx` — desktop palette controls and narrow-layout overflow content.
- `src/components/rich-text/inline-image-toolbar.tsx` — floating selected-image actions, alt popover, tooltips, alignment/reset/delete.
- `src/components/rich-text/inline-image-resize.ts` — pure resize session/controller used by pointer and keyboard adapters.
- `src/components/rich-text/inline-image-crop.ts` — pure crop draft/preset/pan/zoom/bounds conversion.
- `src/components/rich-text/inline-image-crop-editor.tsx` — in-editor crop UI only.
- `src/components/ui/tooltip.tsx` — project-standard Radix tooltip wrapper.

### Existing boundaries to modify

- `src/lib/rich-text-sanitizer.ts` — exact image metadata and semantic color-token whitelist.
- `src/components/rich-text/inline-image-extension.ts` — stable width/natural/crop attrs and upload dimensions.
- `src/components/rich-text/inline-image-node-view.tsx` — composition/lifecycle shell for stable image, toolbar, resize, and crop editor.
- `src/components/rich-text/rich-text-editor.tsx` — mark extensions, palette controls, crop edit blocking, upload success metadata.
- `src/hooks/use-inline-description-images.ts` — active-edit tokens and combined blocking reason.
- Six form surfaces from the original image work — combined blocking state and crop-specific guidance.
- `src/components/ui/formatted-text.tsx`, `src/lib/formatted-text.ts`, `src/server-actions/notifications.ts` — trusted app/email materialization.
- `src/lib/inline-images/pdf.ts`, `src/lib/pdf.ts` — owner-scoped image crop and shared color palette in print output.
- `src/app/globals.css` — responsive image frames and palette presentation.
- Regression and Playwright tests listed per task.

---

### Task 1: Bounded image placement metadata and pure geometry

**Files:**
- Create: `src/lib/inline-images/presentation.ts`
- Modify: `src/lib/inline-images/policy.ts`
- Modify: `src/lib/rich-text-sanitizer.ts`
- Create: `tests/regression/inline-image-presentation.test.ts`
- Modify: `tests/regression/rich-text-sanitizer.test.ts`
- Modify: `tests/regression/inline-image-policy.test.ts`

**Interfaces:**
- Consumes: canonical source/alt/alignment rules from `src/lib/inline-images/policy.ts`.
- Produces:

```ts
export type NormalizedInlineImageCrop = {
  x: number
  y: number
  width: number
  height: number
}

export type InlineImagePresentation = {
  displayWidth: number | null
  naturalWidth: number | null
  naturalHeight: number | null
  crop: NormalizedInlineImageCrop | null
}

export const INLINE_IMAGE_MIN_DISPLAY_WIDTH = 80
export const INLINE_IMAGE_MAX_DISPLAY_WIDTH = 2048
export const INLINE_IMAGE_CROP_SCALE = 10_000

export function parseInlineImagePresentation(
  attributes: Record<string, string | null | undefined>,
): InlineImagePresentation

export function serializeInlineImagePresentation(
  presentation: InlineImagePresentation,
): Record<string, string>

export function clampInlineImageDisplayWidth(width: number, editorWidth: number): number

export function cropAspectRatio(input: {
  crop: NormalizedInlineImageCrop
  naturalWidth: number
  naturalHeight: number
}): number

export function sanitizeInlineImagePresentationAttributes(
  attributes: Record<string, string | undefined>,
): Record<string, string>
```

- Later tasks must use these functions; they must not reparse crop attributes independently.

- [ ] **Step 1: Write failing metadata and geometry tests**

Create table-driven tests that assert strict integer parsing, width/natural-dimension bounds, all-or-nothing crop acceptance, `x + width` / `y + height` containment, crop-without-natural-dimensions removal, deterministic serialization order, resize clamping, and physical crop aspect ratio.

```ts
it('rejects partial and out-of-bounds crop metadata while preserving safe width', () => {
  assert.deepEqual(parseInlineImagePresentation({
    'data-width': '480',
    'data-natural-width': '1600',
    'data-natural-height': '900',
    'data-crop-x': '4000',
    'data-crop-y': '0',
    'data-crop-width': '7000',
    'data-crop-height': '10000',
  }), {
    displayWidth: 480,
    naturalWidth: 1600,
    naturalHeight: 900,
    crop: null,
  })
})

it('computes crop aspect from normalized source coordinates', () => {
  assert.equal(cropAspectRatio({
    crop: { x: 1000, y: 1000, width: 5000, height: 5000 },
    naturalWidth: 1600,
    naturalHeight: 900,
  }), 1600 / 900)
})
```

Extend sanitizer tests with malicious values such as `480px`, `+480`, `4e2`, decimals, negative values, overflow, incomplete crop groups, style injection, and canonical images with valid metadata.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
job_id="$(portly temp 'npx tsx --test tests/regression/inline-image-presentation.test.ts tests/regression/rich-text-sanitizer.test.ts tests/regression/inline-image-policy.test.ts' --path "$PWD" --timeout 30m)"
portly wait "$job_id"
```

Expected: FAIL because `presentation.ts` and the new sanitized attributes do not exist.

- [ ] **Step 3: Implement the minimal pure contract**

Implement strict decimal integer parsing with `/^(?:0|[1-9][0-9]*)$/`, finite/safe-integer checks, and exact bounds. Parse natural dimensions only as a pair. Parse crop only when all four crop attributes and both natural dimensions are valid.

Update the sanitizer image transform to merge only the returned safe attributes:

```ts
const presentation = sanitizeInlineImagePresentationAttributes(attribs)
return {
  tagName: 'img',
  attribs: {
    src: canonicalInlineImageSrc(id),
    alt: (attribs.alt ?? '').slice(0, MAX_INLINE_ALT_LENGTH),
    'data-align': align,
    ...presentation,
  },
}
```

Add the seven data attributes to the image allowlist; keep `style`, `class`, `width`, and `height` disallowed.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the Step 2 command. Expected: all focused tests PASS.

- [ ] **Step 5: Run related description/reference tests**

```bash
job_id="$(portly temp 'npx tsx --test tests/regression/rich-description-validation.test.ts tests/regression/inline-image-references.test.ts tests/regression/formatted-description-rendering.test.ts' --path "$PWD" --timeout 30m)"
portly wait "$job_id"
```

Expected: PASS; canonical ID extraction and visible-content validation remain unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/lib/inline-images/presentation.ts src/lib/inline-images/policy.ts src/lib/rich-text-sanitizer.ts tests/regression/inline-image-presentation.test.ts tests/regression/rich-text-sanitizer.test.ts tests/regression/inline-image-policy.test.ts
git commit -m 'feat: validate inline image presentation metadata'
```

---

### Task 2: Curated palette contract and restricted TipTap marks

**Files:**
- Create: `src/lib/rich-text-palette.ts`
- Create: `src/components/rich-text/rich-text-color-extensions.ts`
- Modify: `src/lib/rich-text-sanitizer.ts`
- Create: `tests/regression/rich-text-palette.test.ts`
- Modify: `tests/regression/rich-text-sanitizer.test.ts`
- Modify: `tests/regression/inline-image-editor.test.ts`

**Interfaces:**
- Consumes: sanitized rich-text HTML boundary.
- Produces:

```ts
export const TEXT_COLOR_VALUES = {
  ink: '#1E293B', slate: '#475569', blue: '#1D4ED8', teal: '#0F766E',
  green: '#15803D', amber: '#B45309', red: '#B91C1C',
} as const

export const HIGHLIGHT_COLOR_VALUES = {
  yellow: '#FEF3C7', blue: '#DBEAFE', green: '#D1FAE5', pink: '#FCE7F3',
  violet: '#EDE9FE', red: '#FEE2E2', gray: '#E2E8F0',
} as const

export type TextColorToken = keyof typeof TEXT_COLOR_VALUES
export type HighlightColorToken = keyof typeof HIGHLIGHT_COLOR_VALUES
export function isTextColorToken(value: unknown): value is TextColorToken
export function isHighlightColorToken(value: unknown): value is HighlightColorToken
export function materializeRichTextPalette(
  html: string,
  target: 'app' | 'email' | 'pdf',
): string

export const TextColorTokenMark: Mark
export const HighlightColorTokenMark: Mark
```

TipTap command augmentation:

```ts
declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    textColorToken: {
      setTextColorToken: (token: TextColorToken) => ReturnType
      unsetTextColorToken: () => ReturnType
    }
    highlightColorToken: {
      setHighlightColorToken: (token: HighlightColorToken) => ReturnType
      unsetHighlightColorToken: () => ReturnType
    }
  }
}
```

- [ ] **Step 1: Write failing palette, sanitizer, and mark tests**

Assert exact token maps, case-sensitive token acceptance, invalid-token text preservation, arbitrary `style="color:..."` stripping, nested color+highlight+bold+link round trips, independent unset commands, and deterministic materialization for app/email/PDF.

```ts
it('keeps exact semantic tokens and strips arbitrary pasted color styles', () => {
  assert.equal(
    sanitizeRichText('<span data-text-color="blue" style="font-size:99px">A</span><span style="color:#ff00ff">B</span>'),
    '<span data-text-color="blue">A</span><span>B</span>',
  )
})

it('materializes only hard-coded palette values for email', () => {
  assert.equal(
    materializeRichTextPalette('<mark data-highlight="yellow">Check</mark>', 'email'),
    '<mark style="background-color:#FEF3C7">Check</mark>',
  )
})
```

Instantiate a headless TipTap editor with StarterKit plus both marks and verify serialized semantic attributes contain no style.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
job_id="$(portly temp 'npx tsx --test tests/regression/rich-text-palette.test.ts tests/regression/rich-text-sanitizer.test.ts tests/regression/inline-image-editor.test.ts' --path "$PWD" --timeout 30m)"
portly wait "$job_id"
```

Expected: FAIL because the palette module and marks do not exist and sanitizer does not allow semantic spans/marks.

- [ ] **Step 3: Implement palette constants, custom marks, and sanitization**

Use `Mark.create` rather than TipTap’s generic style-emitting color extension:

```ts
export const TextColorTokenMark = Mark.create({
  name: 'textColorToken',
  addAttributes() {
    return { token: { default: null, rendered: false } }
  },
  parseHTML() {
    return [{
      tag: 'span[data-text-color]',
      getAttrs: element => {
        const token = element.getAttribute('data-text-color')
        return isTextColorToken(token) ? { token } : false
      },
    }]
  },
  renderHTML({ mark }) {
    return ['span', { 'data-text-color': mark.attrs.token }, 0]
  },
  addCommands() {
    return {
      setTextColorToken: token => ({ commands }) => commands.setMark(this.name, { token }),
      unsetTextColorToken: () => ({ commands }) => commands.unsetMark(this.name),
    }
  },
})
```

Implement Highlight equivalently with `<mark data-highlight>`. Add `span` and `mark` to allowed tags and only their semantic attributes. Invalid tokens become neutral inline tags with children preserved.

`materializeRichTextPalette` must sanitize/transform token names to hard-coded values and never interpolate an unvalidated string into style output.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the Step 2 command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/rich-text-palette.ts src/components/rich-text/rich-text-color-extensions.ts src/lib/rich-text-sanitizer.ts tests/regression/rich-text-palette.test.ts tests/regression/rich-text-sanitizer.test.ts tests/regression/inline-image-editor.test.ts
git commit -m 'feat: add curated rich text color marks'
```

---

### Task 3: Trusted application and HTML-email presentation

**Files:**
- Create: `src/lib/rich-text-presentation.ts`
- Modify: `src/components/ui/formatted-text.tsx`
- Modify: `src/lib/formatted-text.ts`
- Modify: `src/server-actions/notifications.ts`
- Modify: `src/app/globals.css`
- Create: `tests/regression/rich-text-presentation.test.ts`
- Modify: `tests/regression/formatted-text.test.ts`
- Modify: `tests/regression/formatted-description-output.test.ts`
- Modify: `tests/regression/email-notification-transport.test.ts`

**Interfaces:**
- Consumes: `parseInlineImagePresentation`, `cropAspectRatio`, `materializeRichTextPalette`, and `sanitizeRichText`.
- Produces:

```ts
export function materializeRichTextForApp(source: string): string
export function materializeRichTextForEmail(source: string, maxVisibleCharacters?: number): string
export function truncateSanitizedRichTextHtml(source: string, maxVisibleCharacters: number): string
```

- Materialized styles are trusted output only; they are never sent back to save actions or stored.

- [ ] **Step 1: Write failing application/email materialization tests**

Assert:

- uncropped images remain bare sanitized images;
- valid cropped images become an overflow-hidden frame with bounded generated dimensions;
- invalid crop metadata falls back to uncropped image;
- generated styles contain numbers derived only from validated metadata;
- app output materializes palette tokens;
- email first replaces images with alt placeholders, preserves palette marks around text, and contains no canonical image URL/data URI;
- over-budget email truncation keeps balanced tags and approved color/highlight around retained text;
- plain text strips palette marks and keeps words.

```ts
it('never stores or echoes hostile style text through application materialization', () => {
  const html = materializeRichTextForApp('<span data-text-color="blue" style="position:fixed">Safe</span>')
  assert.match(html, /color:#1D4ED8/)
  assert.doesNotMatch(html, /position|fixed/)
})
```

- [ ] **Step 2: Run tests and verify RED**

```bash
job_id="$(portly temp 'npx tsx --test tests/regression/rich-text-presentation.test.ts tests/regression/formatted-text.test.ts tests/regression/formatted-description-output.test.ts tests/regression/email-notification-transport.test.ts' --path "$PWD" --timeout 30m)"
portly wait "$job_id"
```

Expected: FAIL because presentation materializers do not exist and `FormattedText` still injects sanitizer output directly.

- [ ] **Step 3: Implement trusted app/email output**

`materializeRichTextForApp` must call `sanitizeRichText` first, then transform validated cropped images to a generated wrapper. Use fixed element/class names and numeric serialization from Task 1. Do not carry user-provided style/class attributes.

Use a second sanitize-html pass with a stateful `textFilter` to implement `truncateSanitizedRichTextHtml`; stop emitting text after the Unicode code-point budget while allowing the parser to close retained tags. Run image placeholder replacement before email truncation.

Update `FormattedText`:

```tsx
const rendered = maxVisibleCharacters === undefined
  ? materializeRichTextForApp(text)
  : materializeRichTextForApp(
      inlineImageAltPlaceholder(
        truncateSanitizedRichTextHtml(sanitizeRichText(text), maxVisibleCharacters),
      ),
    )
const html = { __html: rendered }
return <span className={cn(className, 'rich-text')} dangerouslySetInnerHTML={html} />
```

Update `renderDescriptionHtml` to call `materializeRichTextForEmail`. Keep `renderDescriptionPlainText` mark-free. Both truncated application previews and HTML email must preserve balanced approved color/highlight marks around retained text; image placeholders remain URL-free.

Add fixed `.rich-text__image-frame` CSS for relative positioning, overflow clipping, alignment, max-width, and reduced motion. Generated inline values may contain only validated numeric dimensions/offsets.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the Step 2 command. Expected: PASS.

- [ ] **Step 5: Run notification and formatted-output compatibility tests**

```bash
job_id="$(portly temp 'npx tsx --test tests/regression/rich-pdf-render.test.ts tests/regression/formatted-description-rendering.test.ts tests/regression/formatted-text-ui.test.ts' --path "$PWD" --timeout 30m)"
portly wait "$job_id"
```

Expected: PASS with updated approved-color expectations and unchanged private-image email placeholders.

- [ ] **Step 6: Commit**

```bash
git add src/lib/rich-text-presentation.ts src/components/ui/formatted-text.tsx src/lib/formatted-text.ts src/server-actions/notifications.ts src/app/globals.css tests/regression/rich-text-presentation.test.ts tests/regression/formatted-text.test.ts tests/regression/formatted-description-output.test.ts tests/regression/email-notification-transport.test.ts
git commit -m 'feat: render trusted rich text presentation'
```

---

### Task 4: Active image-edit blocking across every form

**Files:**
- Modify: `src/hooks/use-inline-description-images.ts`
- Modify: `src/components/requests/request-form.tsx`
- Modify: `src/components/solutions/solution-form.tsx`
- Modify: `src/components/admin/template-form.tsx`
- Modify: `src/components/requests/resubmit-request-dialog.tsx`
- Modify: `src/components/requests/request-resubmit-modal.tsx`
- Modify: `src/components/requests/submitter-modal.tsx`
- Modify: `tests/regression/inline-image-client.test.ts`
- Modify: `tests/regression/inline-image-form-wiring.test.ts`

**Interfaces:**
- Extends `InlineImageCoordinator`:

```ts
export type InlineImageBlockingReason = 'upload' | 'image-edit' | null

beginImageEdit(editId: string): void
endImageEdit(editId: string): void
hasActiveImageEdits: boolean
hasBlockingOperations: boolean
blockingReason: InlineImageBlockingReason
```

- Produces shared copy:

```ts
export function inlineImageBlockingMessage(reason: InlineImageBlockingReason): string | null
```

- [ ] **Step 1: Write failing coordinator and form-wiring tests**

Test idempotent edit tokens, multiple simultaneous tokens, begin/end notifications, upload precedence, reset/clear/dispose edit cleanup, and exact messages. Source-wiring tests must assert all six form surfaces disable using `hasBlockingOperations`, show crop-specific guidance for `image-edit`, and preserve existing upload guidance.

```ts
it('blocks save until every active image edit token ends', () => {
  coordinator.beginImageEdit('crop-a')
  coordinator.beginImageEdit('crop-b')
  coordinator.endImageEdit('crop-a')
  assert.equal(coordinator.hasBlockingOperations, true)
  assert.equal(coordinator.blockingReason, 'image-edit')
  coordinator.endImageEdit('crop-b')
  assert.equal(coordinator.hasBlockingOperations, false)
})
```

- [ ] **Step 2: Run focused tests and verify RED**

```bash
job_id="$(portly temp 'npx tsx --test tests/regression/inline-image-client.test.ts tests/regression/inline-image-form-wiring.test.ts' --path "$PWD" --timeout 30m)"
portly wait "$job_id"
```

Expected: FAIL because the edit-token API and combined blocking state do not exist.

- [ ] **Step 3: Implement token state and update forms**

Maintain `const activeEditIds = new Set<string>()` inside the coordinator. `beginImageEdit`/`endImageEdit` must be idempotent and call the existing state-change notifier only when membership changes. Reset/clear/dispose clear the set.

Blocking precedence:

```ts
get blockingReason() {
  if (hasBlockingInlineImageUploads(records)) return 'upload'
  if (activeEditIds.size > 0) return 'image-edit'
  return null
}
```

Update defense-in-depth submit handlers and buttons, not just visual messages. Keep upload session payloads, clear-on-success, reset-on-cancel, attachment behavior, and callback result contracts unchanged.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the Step 2 command. Expected: PASS.

- [ ] **Step 5: Run related modal/reset tests**

```bash
job_id="$(portly temp 'npx tsx --test tests/regression/request-modal-reset.test.ts tests/regression/formatted-description-editors.test.ts tests/regression/solution-upload-actions.test.ts' --path "$PWD" --timeout 30m)"
portly wait "$job_id"
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/use-inline-description-images.ts src/components/requests/request-form.tsx src/components/solutions/solution-form.tsx src/components/admin/template-form.tsx src/components/requests/resubmit-request-dialog.tsx src/components/requests/request-resubmit-modal.tsx src/components/requests/submitter-modal.tsx tests/regression/inline-image-client.test.ts tests/regression/inline-image-form-wiring.test.ts
git commit -m 'feat: block saves during inline image edits'
```

---

### Task 5: Floating image toolbar and accessible drag resize

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/components/ui/tooltip.tsx`
- Create: `src/components/rich-text/inline-image-toolbar.tsx`
- Create: `src/components/rich-text/inline-image-resize.ts`
- Modify: `src/components/rich-text/inline-image-extension.ts`
- Modify: `src/components/rich-text/inline-image-node-view.tsx`
- Modify: `src/components/rich-text/rich-text-editor.tsx`
- Modify: `src/app/globals.css`
- Create: `tests/regression/inline-image-resize.test.ts`
- Modify: `tests/regression/inline-image-editor.test.ts`

**Interfaces:**
- Consumes: Task 1 metadata and Task 4 coordinator.
- Produces:

```ts
export type InlineImageResizeSession = {
  preview(pointerX: number): number
  commit(): number | null
  cancel(): number
  keyboard(key: 'ArrowLeft' | 'ArrowRight' | 'Home', shiftKey: boolean): number | null
}

export function createInlineImageResizeSession(input: {
  edge: 'left' | 'right'
  startPointerX: number
  startWidth: number
  editorWidth: number
  onPreview: (width: number) => void
  onCommit: (width: number | null) => void
}): InlineImageResizeSession
```

- Stable TipTap attrs added by `InlineImageExtension`: `displayWidth`, `naturalWidth`, `naturalHeight`, `cropX`, `cropY`, `cropWidth`, `cropHeight`.

- [ ] **Step 1: Install the tooltip primitive through Portly**

```bash
job_id="$(portly temp 'npm install @radix-ui/react-tooltip@1.2.16 --save-exact --no-audit --no-fund' --path "$PWD" --timeout 30m)"
portly wait "$job_id"
```

Expected: package/lock add only the tooltip primitive and compatible transitive packages.

- [ ] **Step 2: Write failing resize, serialization, and toolbar tests**

Test left/right corner deltas, min/max/editor clamp, cancel, one commit per session, keyboard increments, Home reset, natural dimensions on upload success, TipTap HTML round trip, and absence of the old full-width action row.

```ts
it('previews continuously but commits one clamped width', () => {
  const previews: number[] = []
  const commits: Array<number | null> = []
  const resize = createInlineImageResizeSession({
    edge: 'right',
    startPointerX: 100,
    startWidth: 400,
    editorWidth: 600,
    onPreview: width => previews.push(width),
    onCommit: width => commits.push(width),
  })
  assert.equal(resize.preview(450), 600)
  assert.equal(resize.commit(), 600)
  assert.deepEqual(commits, [600])
})
```

Assert selected toolbar icon accessible names: Image alt text, Align left/center/right, Crop image, Reset image size, Remove image. Assert tooltip uses `Trigger asChild`, Portal, collision avoidance, and focus-visible styles.

- [ ] **Step 3: Run focused tests and verify RED**

```bash
job_id="$(portly temp 'npx tsx --test tests/regression/inline-image-resize.test.ts tests/regression/inline-image-editor.test.ts tests/regression/rich-text-editor.test.ts' --path "$PWD" --timeout 30m)"
portly wait "$job_id"
```

Expected: FAIL because resize controller, attrs, and floating toolbar do not exist.

- [ ] **Step 4: Implement tooltip, resize controller, stable attrs, and floating toolbar**

Create a standard Radix tooltip wrapper with Provider/Root/Trigger `asChild`/Portal/Content and collision handling. Use Lucide icons (`AlignLeft`, `AlignCenter`, `AlignRight`, `Crop`, `RotateCcw`, `Trash2`, `TextCursorInput`).

The NodeView shell must compose focused components:

```tsx
<InlineImageFrame presentation={presentation} selected={selected}>
  <img ref={imageRef} ... />
  {selected && !cropMode && (
    <>
      <InlineImageToolbar ... />
      <InlineImageResizeHandles ... />
    </>
  )}
</InlineImageFrame>
```

Populate natural dimensions on successful upload/retry from `InlineImageUpload.width/height`. `renderHTML` emits Task 1 serialized data attributes only; upload/transient attrs remain `rendered: false`.

Do not commit node attrs on every pointer move. Keep preview width in local state and call `updateAttributes({ displayWidth })` once on pointer-up/keyboard action.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run the Step 3 command. Expected: PASS.

- [ ] **Step 6: Manually verify resize in the live request dialog**

Use agent-browser against `http://localhost:3101/requests`: open New Request, upload `/tmp/inline-image-ui-demo-rgb.png`, select it, capture before/after bounding boxes, drag a corner, verify the floating toolbar does not change editor document height, and inspect sanitized HTML through the DOM/editor state for `data-width` with no `style`.

Save screenshots under `/tmp`; do not add them to the repository.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/components/ui/tooltip.tsx src/components/rich-text/inline-image-toolbar.tsx src/components/rich-text/inline-image-resize.ts src/components/rich-text/inline-image-extension.ts src/components/rich-text/inline-image-node-view.tsx src/components/rich-text/rich-text-editor.tsx src/app/globals.css tests/regression/inline-image-resize.test.ts tests/regression/inline-image-editor.test.ts
git commit -m 'feat: add floating image resize controls'
```

---

### Task 6: In-editor non-destructive crop interaction

**Files:**
- Create: `src/components/rich-text/inline-image-crop.ts`
- Create: `src/components/rich-text/inline-image-crop-editor.tsx`
- Modify: `src/components/rich-text/inline-image-toolbar.tsx`
- Modify: `src/components/rich-text/inline-image-node-view.tsx`
- Modify: `src/app/globals.css`
- Create: `tests/regression/inline-image-crop.test.ts`
- Modify: `tests/regression/inline-image-editor.test.ts`

**Interfaces:**
- Consumes: Task 1 normalized crop/presentation and Task 4 edit-token API.
- Produces:

```ts
export type InlineImageCropPreset = 'free' | 'original' | '1:1' | '4:3' | '16:9'
export type InlineImageCropDraft = {
  crop: NormalizedInlineImageCrop
  zoom: number
  panX: number
  panY: number
  preset: InlineImageCropPreset
}

export function createInlineImageCropDraft(presentation: InlineImagePresentation): InlineImageCropDraft
export function applyInlineImageCropPreset(
  draft: InlineImageCropDraft,
  preset: InlineImageCropPreset,
  naturalWidth: number,
  naturalHeight: number,
): InlineImageCropDraft
export function panInlineImageCrop(draft: InlineImageCropDraft, dx: number, dy: number): InlineImageCropDraft
export function zoomInlineImageCrop(draft: InlineImageCropDraft, zoom: number): InlineImageCropDraft
export function resizeInlineImageCropEdge(
  draft: InlineImageCropDraft,
  edge: 'top' | 'right' | 'bottom' | 'left' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right',
  dx: number,
  dy: number,
): InlineImageCropDraft
```

- [ ] **Step 1: Write failing crop geometry and interaction-contract tests**

Test full-image draft, all aspect presets, edge/corner bounds, minimum crop extent, pan/zoom clamps, wheel and pinch zoom normalization, keyboard steps, Reset, Apply serialization, Cancel exact restoration, invalid/missing natural-dimension refusal with accessible guidance, and one transaction on Apply.

```ts
it('keeps every crop inside the normalized source after pan and resize', () => {
  const moved = panInlineImageCrop(
    { crop: { x: 1000, y: 1000, width: 5000, height: 5000 }, zoom: 1, panX: 0, panY: 0, preset: 'free' },
    9000,
    -9000,
  )
  assert.ok(moved.crop.x >= 0 && moved.crop.y >= 0)
  assert.ok(moved.crop.x + moved.crop.width <= 10_000)
  assert.ok(moved.crop.y + moved.crop.height <= 10_000)
})
```

Source/behavior tests must assert crop mode calls `beginImageEdit(editId)` once, Apply/Cancel/unmount call `endImageEdit(editId)`, normal toolbar/resize handles hide during crop, Escape cancels, and focus returns to Crop.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
job_id="$(portly temp 'npx tsx --test tests/regression/inline-image-crop.test.ts tests/regression/inline-image-editor.test.ts tests/regression/inline-image-client.test.ts' --path "$PWD" --timeout 30m)"
portly wait "$job_id"
```

Expected: FAIL because crop modules and edit lifecycle wiring do not exist.

- [ ] **Step 3: Implement the pure crop model and in-editor crop UI**

Keep pointer/touch state in `InlineImageCropEditor`; call pure functions for every update. Crop UI includes dimmed outside regions, eight crop handles, pan surface, labeled zoom range, Free/Original/1:1/4:3/16:9 controls, Cancel, Reset, and Apply.

On enter:

```ts
const snapshot = parseInlineImagePresentation(node.attrs)
const editId = `crop:${node.attrs.src}:${crypto.randomUUID()}`
coordinator?.beginImageEdit(editId)
```

On Apply, commit serialized natural/crop attrs once, end the token, exit crop, and focus Crop. On Cancel/Escape, restore snapshot without emitting new attrs, end token, and focus Crop. A cleanup effect must end any still-active token on NodeView teardown.

Disable editor formatting commands during crop by publishing crop state through extension options/controller; do not disable crop controls themselves.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the Step 2 command. Expected: PASS.

- [ ] **Step 5: Manually verify crop in the live request dialog**

Use the existing Portly server and headed agent-browser session. Verify Free plus all presets, pointer pan, zoom, Apply persistence in the DOM, Cancel restoration, Escape, narrow viewport controls, and submit disabled with exact crop guidance. Capture `/tmp/inline-image-crop-*.png` screenshots only.

- [ ] **Step 6: Commit**

```bash
git add src/components/rich-text/inline-image-crop.ts src/components/rich-text/inline-image-crop-editor.tsx src/components/rich-text/inline-image-toolbar.tsx src/components/rich-text/inline-image-node-view.tsx src/app/globals.css tests/regression/inline-image-crop.test.ts tests/regression/inline-image-editor.test.ts
git commit -m 'feat: add non-destructive inline image crop'
```

---

### Task 7: Responsive text-color and highlight controls

**Files:**
- Create: `src/components/rich-text/rich-text-color-controls.tsx`
- Modify: `src/components/rich-text/rich-text-editor.tsx`
- Modify: `src/app/globals.css`
- Create: `tests/regression/rich-text-color-controls.test.ts`
- Modify: `tests/regression/rich-text-editor.test.ts`
- Modify: `tests/regression/inline-image-editor.test.ts`

**Interfaces:**
- Consumes: Task 2 marks/token maps.
- Produces:

```ts
export type RichTextColorControlsProps = {
  editor: Editor
  disabled: boolean
  compact: boolean
}
```

- Desktop exposes Text color and Highlight toolbar triggers. The narrow layout exposes identical palette actions inside More.

- [ ] **Step 1: Write failing color-control tests**

Assert exact swatch counts/names/values, selected state, Default text/No highlight, keyboard-accessible popovers, current token indicators, desktop visibility, narrow More placement, and command calls. Assert no `<input type="color">` and no arbitrary hex entry.

Behaviorally instantiate TipTap and verify selecting text, applying text color then highlight, toggling bold, unsetting highlight, and serializing exact semantic marks.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
job_id="$(portly temp 'npx tsx --test tests/regression/rich-text-color-controls.test.ts tests/regression/rich-text-editor.test.ts tests/regression/inline-image-editor.test.ts tests/regression/rich-text-palette.test.ts' --path "$PWD" --timeout 30m)"
portly wait "$job_id"
```

Expected: FAIL because the toolbar controls and editor extensions are not registered.

- [ ] **Step 3: Implement responsive palette controls**

Register `TextColorTokenMark` and `HighlightColorTokenMark` in `useEditor.extensions`. Build palette controls from the exported maps, not duplicated arrays.

Use Lucide `Palette`, `Highlighter`, and `MoreHorizontal`. Preserve selection when opening a popover by preventing trigger mouse-down from collapsing the editor selection. Restore editor focus after choosing/resetting a token.

Use a responsive CSS/container breakpoint owned by the toolbar wrapper: desktop renders the two palette triggers; narrow layout renders a single More dropdown containing both labeled palettes. Do not infer layout from `window.innerWidth` during server render.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the Step 2 command. Expected: PASS.

- [ ] **Step 5: Manually verify in the request dialog**

With agent-browser, apply every text/highlight token, combine color+highlight+bold+link, reset each independently, resize viewport to mobile, and verify More contains both controls without toolbar overflow. Inspect editor HTML for semantic tokens and absence of style.

- [ ] **Step 6: Commit**

```bash
git add src/components/rich-text/rich-text-color-controls.tsx src/components/rich-text/rich-text-editor.tsx src/app/globals.css tests/regression/rich-text-color-controls.test.ts tests/regression/rich-text-editor.test.ts tests/regression/inline-image-editor.test.ts
git commit -m 'feat: add curated editor color controls'
```

---

### Task 8: Owner-scoped cropped PDF and shared print colors

**Files:**
- Modify: `src/lib/inline-images/pdf.ts`
- Modify: `src/lib/pdf.ts`
- Modify: `tests/regression/inline-image-rendering.test.ts`
- Modify: `tests/regression/rich-pdf-render.test.ts`
- Modify: `tests/regression/pdf-rendering.test.ts`
- Modify: `tests/regression/rich-text-palette.test.ts`

**Interfaces:**
- Consumes: Task 1 image geometry, Task 2 palette, and current `resolveInlineImagesForPdf({ html, owner })` authorization boundary.
- Produces: same public PDF resolver signature; returned trusted HTML now materializes approved crop/size and palette presentation.

- [ ] **Step 1: Write failing PDF crop/color tests**

Use owner-scoped fake assets with authoritative width/height. Assert:

- cropped frame contains the authorized data URI and expected generated geometry;
- stored natural dimensions cannot override authoritative DB dimensions for PDF;
- unowned/missing/tampered assets remain escaped alt placeholders;
- invalid crop degrades to uncropped authorized image;
- shared Calm Document palette values appear in PDF HTML;
- arbitrary colors/styles never appear;
- no data URI or generated style is written to Prisma.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
job_id="$(portly temp 'npx tsx --test tests/regression/inline-image-rendering.test.ts tests/regression/rich-pdf-render.test.ts tests/regression/pdf-rendering.test.ts tests/regression/rich-text-palette.test.ts' --path "$PWD" --timeout 30m)"
portly wait "$job_id"
```

Expected: FAIL because PDF image queries/rendering do not include crop geometry or palette materialization.

- [ ] **Step 3: Implement trusted PDF presentation**

Extend the owner-scoped asset selection to include `width` and `height`. Keep `references: { some: owner }`, MIME checks, private path containment, and read-once behavior unchanged.

After authorization and byte resolution, materialize crop frames using authoritative asset dimensions. Then call `materializeRichTextPalette(html, 'pdf')`. Add print CSS for overflow-hidden frames, alignment, `max-width:100%`, and `break-inside/page-break-inside:avoid`.

The resolver must remain read-only and must not accept data URIs from stored input.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the Step 2 command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/inline-images/pdf.ts src/lib/pdf.ts tests/regression/inline-image-rendering.test.ts tests/regression/rich-pdf-render.test.ts tests/regression/pdf-rendering.test.ts tests/regression/rich-text-palette.test.ts
git commit -m 'feat: render cropped colored descriptions in PDFs'
```

---

### Task 9: Browser release gate, full verification, and live UI acceptance

**Files:**
- Modify: `tests/e2e/inline-description-images.spec.ts`
- Modify: `tests/regression/formatted-description-editors.test.ts`
- Modify: `tests/regression/inline-image-form-wiring.test.ts`
- No Playwright configuration change.

**Interfaces:**
- Consumes: all previous tasks.
- Produces: a non-vacuous release gate covering resize, crop, color/highlight, persistence, template independence, app/PDF/email parity, and legacy upload behavior.

- [ ] **Step 1: Extend the Playwright gate before relying on implementation**

Add serial scenarios that assert:

1. Floating toolbar appears without the old full-width action row.
2. Four corner handles exist and a real mouse drag changes image width.
3. Saved/reopened image has the same canonical URL, display width, and crop metadata.
4. Reset size removes `data-width`.
5. Inline crop Free/Original/1:1/4:3/16:9, pan, zoom, Cancel, Reset, Apply, and Escape work.
6. Submit is disabled with `Apply or cancel the image edit before saving.` during crop.
7. Cropped template copy initially matches and request crop then diverges independently while URL remains shared.
8. Every Calm Document text/highlight token applies and round-trips; unsupported pasted color styles are stripped.
9. Narrow viewport moves color controls into More and keeps crop controls usable.
10. Existing attachment upload and canonical private-image authorization checks still pass.

Use DOM/network assertions, not screenshots alone. Inspect the real serialized HTML through editor DOM/attributes and saved rendering. Continue requiring canonical `/api/inline-images/<UUID>` sources.

- [ ] **Step 2: Run Playwright discovery and deliberate missing-env proof**

```bash
job_id="$(portly temp 'npx playwright test tests/e2e/inline-description-images.spec.ts --list' --path "$PWD" --timeout 30m)"
portly wait "$job_id"
```

Expected: all updated tests list. The existing gate must still throw rather than skip when required disposable variables are missing.

- [ ] **Step 3: Run focused integration regressions**

```bash
job_id="$(portly temp 'npx tsx --test tests/regression/inline-image-*.test.ts tests/regression/rich-text-*.test.ts tests/regression/formatted-description-editors.test.ts tests/regression/formatted-description-output.test.ts tests/regression/formatted-text.test.ts tests/regression/pdf-rendering.test.ts' --path "$PWD" --timeout 30m)"
portly wait "$job_id"
```

Expected: PASS.

- [ ] **Step 4: Run the full project check**

```bash
job_id="$(portly temp 'npm run check' --path "$PWD" --timeout 30m)"
portly wait "$job_id"
```

Expected: TypeScript, management-tool tests, and every regression test PASS with zero failures.

- [ ] **Step 5: Run manual headed acceptance on the disposable worktree**

```bash
portly status
portly logs ApprovalAppV3-InlineImages/dev --tail 100
```

Reuse the healthy server on `http://localhost:3101`. With agent-browser, log into the disposable database, open `/requests`, click New Request, and exercise toolbar upload, paste, drop, floating actions, resize, crop, colors, highlights, reset, cancel cleanup, and responsive viewport. Record screenshots/video under `/tmp` only.

If the server is stale, use `portly restart ApprovalAppV3-InlineImages/dev`; never run `npm run dev` directly.

- [ ] **Step 6: Run the full automated browser gate only when prerequisites exist**

Run the gate through Portly with its declared `TEST_BASE_URL`/`E2E_*` disposable variables. If the environment owner has not supplied all migrated disposable records/accounts, report `BLOCKED_BROWSER_ENV`; do not skip, weaken the test, migrate a shared database, or substitute production credentials.

- [ ] **Step 7: Refresh graph and inspect repository state**

```bash
job_id="$(portly temp 'graphify update .' --path "$PWD" --timeout 30m)"
portly wait "$job_id"
git diff --check
git status --short
git log --oneline -15
```

Expected: graph refresh succeeds; only planned changes are present; no migration, production, or `presentation-output/` change exists.

- [ ] **Step 8: Commit**

```bash
git add tests/e2e/inline-description-images.spec.ts tests/regression/formatted-description-editors.test.ts tests/regression/inline-image-form-wiring.test.ts
git commit -m 'test: cover image editing and curated colors'
```

- [ ] **Step 9: Final whole-branch review**

Generate a review package from `d792bd2` to `HEAD`. Review all spec acceptance criteria, stored HTML security, output materialization, crop geometry, edit blocking, template independence, and browser-gate non-vacuousness. Fix every Critical/Important finding with a focused RED/GREEN regression and re-review before reporting completion.
