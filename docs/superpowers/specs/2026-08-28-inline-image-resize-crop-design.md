# Inline Image Resize and Non-Destructive Crop Design

**Date:** 2026-08-28
**Status:** Approved for planning
**Branch:** `feat/inline-description-images`

## 1. Purpose

Replace the current full-width selected-image action row with a compact contextual editing experience and add direct image resizing plus non-destructive cropping to every rich-text description editor.

The feature must work in request, solution, resubmission, and template editors. Size and crop state must survive save/reopen, template copying, application rendering, and PDF export without modifying or duplicating the original private image bytes.

## 2. Goals

1. Show a compact floating toolbar when an image is selected; do not insert controls into document flow.
2. Resize images by dragging corner handles with a locked aspect ratio.
3. Crop images directly inside the editor with pan, zoom, a movable/resizable crop rectangle, and aspect presets.
4. Keep cropping non-destructive and placement-specific.
5. Persist only canonical private image URLs and strictly bounded numeric presentation metadata.
6. Render the same size/crop in the editor, application views, and PDFs.
7. Preserve email behavior as escaped image-alt placeholders.
8. Keep existing image upload, retry, cleanup, reference sharing, authorization, and attachment behavior unchanged.
9. Provide keyboard, pointer, touch, focus, and reduced-motion-safe interactions.

## 3. Non-Goals

- Re-encoding, mutating, or replacing original image assets.
- Creating a new cropped image asset or database placement model.
- Applying crop edits from a template retroactively to requests that already copied it.
- Adding filters, rotation, annotation, focal-point AI, or image compositing.
- Allowing arbitrary inline CSS, external image URLs, blobs, or data URIs in stored descriptions.
- Changing inline-image ownership, reference, quota, retention, or access-control schema.

## 4. Selected UX Direction

### 4.1 Normal selected state

Selecting a stable uploaded image displays:

- a thin blue selection outline;
- four corner resize handles;
- a compact floating toolbar above the image.

The toolbar contains icon controls, with tooltips and accessible names, for:

- Alt text;
- Align left;
- Align center;
- Align right;
- Crop;
- Reset size;
- Delete.

Alt text opens a small anchored popover. The current full-width `Alt text / Left / Center / Right / Remove` row is removed.

Pending and failed upload placeholders retain their existing progress, retry, and remove controls. Resize and crop are available only after upload succeeds and the canonical image is loaded.

### 4.2 Direct resize

- Dragging any corner handle resizes continuously and preserves the rendered crop aspect ratio.
- Width is clamped from 80 CSS pixels to the current editor content width.
- Persisted width is additionally capped at 2048 to keep metadata bounded.
- The image updates live while dragging; one TipTap node-attribute transaction is committed when the pointer is released.
- Pointer capture keeps the drag active if the pointer leaves the handle.
- Double-clicking a resize handle or choosing Reset size removes the explicit width and returns to intrinsic responsive sizing.
- `max-width: 100%` always prevents overflow on narrower screens.

Keyboard behavior:

- Resize handles are focusable.
- Left/Right arrows change width by 1px.
- Shift+Left/Right changes width by 10px.
- Home resets size; Escape abandons an in-progress drag.

### 4.3 Inline crop mode

Choosing Crop keeps the image inside the editor and switches that node into crop mode. It does not open a nested dialog.

Crop mode provides:

- dimmed regions outside the crop rectangle;
- movable and resizable crop rectangle handles;
- image panning beneath the crop rectangle;
- zoom slider plus wheel/pinch support;
- presets: Free, Original, 1:1, 4:3, and 16:9;
- Cancel, Reset, and Apply crop controls.

The normal image toolbar and resize handles are hidden while cropping. Other editor commands are disabled for that crop session.

- Apply converts the temporary pan/zoom/rectangle state into normalized source coordinates and updates the node once.
- Cancel or Escape restores the exact pre-crop node state.
- Reset selects the full original image while remaining in crop mode.
- Focus returns to the Crop button after Apply or Cancel.
- On narrow screens, controls wrap above the image but remain inside the request dialog.

Keyboard behavior:

- Crop handles and the crop region are focusable.
- Arrow keys move the active crop edge or crop rectangle by one normalized step.
- Shift+arrow uses a larger step.
- The zoom control is a labeled range input.

### 4.4 Save blocking

A crop session is an unfinished image edit. Forms must not silently save temporary crop state.

The inline-image controller gains separate state for active image edits and exposes a combined `hasBlockingOperations` value. Existing forms switch their submit/confirm disablement from upload-only blocking to combined blocking.

While an image is being cropped, forms display:

> Apply or cancel the image edit before saving.

Upload failures retain the existing message:

> Wait for image uploads, or retry/remove failed images.

Closing/cancelling the parent form first cancels local crop UI, then follows the existing awaited draft cleanup path.

## 5. Placement Metadata Contract

### 5.1 Stored HTML

Stored descriptions continue to use canonical image elements. Presentation state is stored as bounded data attributes; no style attribute is stored.

```html
<img
  src="/api/inline-images/123e4567-e89b-42d3-a456-426614174001"
  alt="Assembly detail"
  data-align="center"
  data-width="480"
  data-natural-width="1600"
  data-natural-height="900"
  data-crop-x="1250"
  data-crop-y="800"
  data-crop-width="7000"
  data-crop-height="7800"
/>
```

Attributes:

| Attribute | Meaning | Bounds |
|---|---|---|
| `data-width` | Display width in CSS pixels | integer 80–2048 |
| `data-natural-width` | Decoded source width | integer 1–65535 |
| `data-natural-height` | Decoded source height | integer 1–65535 |
| `data-crop-x` | Source crop left coordinate | integer 0–9999 |
| `data-crop-y` | Source crop top coordinate | integer 0–9999 |
| `data-crop-width` | Source crop width | integer 1–10000 |
| `data-crop-height` | Source crop height | integer 1–10000 |

Crop values use a 0–10,000 normalized coordinate space. Valid crop metadata must satisfy:

- `x + width <= 10000`;
- `y + height <= 10000`;
- natural width and height are both present and valid;
- all four crop values are present and valid.

Temporary editor values such as active handle, pan velocity, pointer position, crop mode, or error text are never serialized.

### 5.2 Compatibility

Existing canonical images without size, natural dimensions, or crop metadata remain valid and render exactly as before.

When cropping an older stable image, the editor reads its decoded `naturalWidth` and `naturalHeight`; Apply persists those dimensions with crop metadata. New uploads populate natural dimensions from the already-verified upload response.

### 5.3 Template reuse

Copying template description HTML copies the current size/crop metadata with the canonical image URL. After copy, the request and template placements are independent HTML nodes:

- editing request crop does not change template crop;
- editing template crop does not change existing requests;
- both continue to reference the same authorized private image asset bytes.

## 6. Sanitization and Security

The rich-text sanitizer remains the stored-HTML trust boundary.

1. `src` must still pass the canonical `/api/inline-images/<UUID>` policy.
2. `alt` and `data-align` retain their existing validation.
3. Numeric metadata is parsed as base-10 integers only; signs, decimals, exponents, units, whitespace tricks, CSS tokens, and overflow values are rejected.
4. Invalid `data-width` is removed independently.
5. Natural dimensions are retained only as a valid pair.
6. Crop metadata is all-or-nothing. Any missing, invalid, or out-of-bounds crop value removes the entire crop group while preserving the safe uncropped image.
7. Crop metadata without valid natural dimensions is removed.
8. Stored HTML never permits `style`, `class`, event handlers, blob/data/external sources, or crop-generated URLs.

Crop values affect presentation only; they never influence storage paths, authorization queries, image IDs, database owner scopes, MIME choice, or filesystem access.

## 7. Geometry and Rendering

### 7.1 Shared pure geometry

A pure inline-image presentation module owns:

- metadata parsing and validation;
- pixel-to-normalized crop conversion;
- crop bounds and aspect calculations;
- resize clamping;
- render-frame geometry;
- safe numeric serialization.

Editor, application, and PDF paths consume this shared contract so crop math cannot drift.

The rendered crop aspect ratio is:

```text
(cropWidth / 10000 × naturalWidth)
──────────────────────────────────
(cropHeight / 10000 × naturalHeight)
```

### 7.2 Editor NodeView

The React NodeView renders a clipped frame whose outer width is `data-width` or the intrinsic responsive width. The inner image is absolutely positioned and scaled from the validated crop rectangle.

Editor-only controls live outside the node's serialized HTML. Pointer-move updates remain local React state; Apply or pointer-up commits one TipTap transaction to preserve useful undo history.

### 7.3 Application rendering

Stored HTML is sanitized first. A trusted presentation materializer then transforms only validated cropped canonical images into a clipped wrapper with generated numeric styles.

The generated wrapper/style is not stored and does not expand the sanitizer allowlist. User strings never enter style declarations; only validated numbers from the shared geometry module are serialized.

Uncropped images retain the existing bare `<img>` rendering path. If presentation materialization fails, the safe fallback is the uncropped sanitized image.

### 7.4 PDF rendering

The existing owner-scoped PDF resolver continues to authorize references and replace canonical sources with verified data URIs. It then uses the same validated crop geometry to emit a clipped print wrapper.

PDF geometry may use the authoritative asset width/height loaded with the owner-authorized image row. Stored natural dimensions are not an authorization or storage trust source.

Missing bytes, unauthorized assets, or invalid crop metadata retain the existing escaped alt-placeholder fallback.

### 7.5 Email and plain text

Email and plain-text paths continue replacing approved images with `[Image: alt]` or `[Image]`. Width/crop metadata is ignored and no bytes or private URLs are emitted.

## 8. Error and Lifecycle Behavior

- Entering crop mode snapshots the last applied node state.
- Cancel, Escape, parent close, or NodeView teardown discards temporary crop state.
- Crop errors preserve the original applied image and show a concise editor-local error.
- Upload retry/remove and transaction cleanup behavior remain unchanged.
- Deleting a stable draft image still awaits coordinator cleanup before removing the node.
- Removing an image while selected exits crop/resize state before existing removal logic runs.
- Undo/redo applies committed width/crop node transactions, not pointer-move frames.
- Reset crop removes the four crop attributes but retains natural dimensions and display width.
- Reset size removes only display width.

## 9. Accessibility and Responsive Behavior

- Every icon button has an accessible name, tooltip, visible focus ring, pressed state where applicable, and disabled state.
- Toolbar and crop controls are reachable in logical tab order.
- Resize/crop handles have at least a 24px invisible hit target on desktop and 44px on touch layouts.
- Controls do not depend on color alone; selected boundaries combine outline, handles, and state labels.
- Pan/zoom/crop interactions expose concise live status text without announcing every pointer frame.
- Reduced-motion users receive no animated crop/resize transitions.
- The floating toolbar flips below the image when insufficient space exists above it.
- Images and crop frames always use `max-width: 100%` and cannot overflow the modal/editor.

## 10. Component and Interface Changes

Expected boundaries:

- `src/lib/inline-images/presentation.ts` — shared metadata and geometry contract.
- `src/components/rich-text/inline-image-extension.ts` — stable width/natural/crop attrs and TipTap parsing/rendering.
- `src/components/rich-text/inline-image-node-view.tsx` — floating toolbar, handles, crop mode, focus/error behavior.
- `src/components/rich-text/rich-text-editor.tsx` — image-edit blocking integration.
- `src/hooks/use-inline-description-images.ts` — active-edit tokens and combined blocking state.
- Form components wired in the original inline-image work — use `hasBlockingOperations` and crop-specific blocking copy.
- `src/lib/rich-text-sanitizer.ts` and inline-image policy — strict metadata validation.
- `src/components/ui/formatted-text.tsx` plus a trusted presentation helper/component — application crop rendering.
- `src/lib/inline-images/pdf.ts` and `src/lib/pdf.ts` — owner-scoped cropped PDF rendering.
- `src/app/globals.css` — selection/frame/toolbar/application rules that do not rely on stored arbitrary styles.

The exact file decomposition may be refined in the implementation plan, but geometry/validation must remain independent from React interaction code.

## 11. Testing Strategy

### 11.1 TDD unit and regression tests

Add failing tests before implementation for:

- strict integer parsing and bounds;
- all-or-nothing crop validation;
- resize clamping;
- normalized crop conversion and aspect math;
- sanitizer retention/removal behavior;
- TipTap parse/render round trips with no transient attrs/styles;
- existing image compatibility;
- template HTML copy preserving independent metadata;
- application materialization producing only generated safe styles;
- PDF owner authorization remaining required while crop is applied;
- email placeholders ignoring crop metadata;
- combined upload/crop blocking state;
- Apply/Cancel/Reset/undo transaction behavior;
- keyboard resize/crop commands.

### 11.2 Browser acceptance

Extend the opt-in browser gate and manually test the live request dialog to prove:

1. Selected image uses a floating toolbar without document reflow.
2. Corner drag changes displayed size and persists after save/reopen.
3. Reset size restores intrinsic responsive size.
4. Crop mode runs in place.
5. Free crop, each aspect preset, pan, and zoom update the preview.
6. Cancel preserves prior crop; Apply persists it.
7. Request copied from a cropped template initially matches, then edits independently.
8. Application detail view and PDF match the applied crop.
9. Keyboard controls and narrow viewport remain usable.
10. Stored HTML contains canonical URL plus bounded data metadata and no style/blob/data URL.

The current disposable worktree database may be used for manual UI testing. The existing full release gate remains opt-in and requires its declared disposable credentials/records.

### 11.3 Verification

- Focused geometry/sanitizer/editor/rendering tests.
- `npm run check` through Portly.
- Playwright test discovery and live gate when its environment is available.
- Agent-browser manual request-dialog verification at desktop and mobile viewport.
- `graphify update .`.

## 12. Acceptance Criteria

1. The current full-width image action row no longer appears.
2. Selecting an image shows a floating toolbar and four resize handles without moving surrounding content.
3. Free corner drag resizes proportionally, clamps safely, and persists after save/reopen.
4. Inline crop supports free/original/1:1/4:3/16:9, pan, zoom, Cancel, Reset, and Apply.
5. Crop is non-destructive and original private bytes remain unchanged.
6. Crop and width are placement-specific; template copies become independently editable while sharing bytes.
7. Stored HTML contains only canonical image URLs and validated data metadata; no arbitrary style or transient edit state.
8. Invalid metadata degrades to a safe uncropped image.
9. Editor, application, and owner-authorized PDF rendering agree on crop and size.
10. Email/plain text remains alt-placeholder-only.
11. Active crop sessions block save with specific guidance; upload blocking behavior remains intact.
12. Existing images, attachments, authorization, cleanup, reference reconciliation, quotas, and retention continue passing regression tests.
13. Pointer, touch, and keyboard operation are usable in the request dialog and narrow viewports.
14. No database migration, destructive crop asset, or duplicate image bytes are introduced.
