# Inline Image Placement, Rotation, and Crop Interaction Design

**Date:** 2026-08-29  
**Status:** Approved in chat; awaiting written-spec review  
**Branch:** `feat/inline-description-images`

## 1. Summary

Extend rich-text inline images with three coordinated improvements:

1. Correct the crop-region drag direction so the crop box follows the pointer or finger.
2. Make newly uploaded, pasted, and dropped images inline with surrounding text by default at a 160px visible width, while retaining block placement as an explicit option and preserving legacy block behavior.
3. Add non-destructive placement-specific quarter-turn rotation: rotate left 90°, rotate right 90°, and reset rotation.

The editor, sanitized application output, and PDF output must agree on placement, width, crop, and rotation. Original private image bytes remain unchanged. HTML email retains the existing private-image placeholder behavior, and plain text retains words/alt text only.

## 2. Goals

- Dragging the crop region right/down moves the visible crop region right/down.
- Touch and pointer interactions use the same directional model.
- New successful image insertions default to inline placement at 160 CSS pixels.
- Text can appear immediately before and after an inline image in the same paragraph and line when space permits; normal line wrapping applies when space is insufficient.
- Users can switch an image between inline and block placement.
- Block placement retains left/center/right full-row alignment and no text wrapping beside the block image.
- Users can rotate left or right in 90° increments and reset rotation.
- Crop mode shows the rotated orientation, so users crop what they see.
- Width, crop, layout, and rotation remain placement-specific and non-destructive.
- Existing saved images retain block behavior unless explicitly changed.
- Mobile controls remain usable, accessible, and free of horizontal overflow.

## 3. Non-Goals

- Arbitrary-angle rotation.
- Horizontal or vertical flip.
- Text floating or multi-line wrapping beside block images.
- Destructive pixel rotation, crop, re-encoding, or duplicate asset creation.
- Changes to private image authorization, retention, quotas, reference reconciliation, or storage paths.
- Rendering private image bytes in HTML email.
- Persisting arbitrary CSS, classes, transforms, external URLs, blob URLs, or data URLs.

## 4. Architecture Decision

Use semantic, bounded attributes on the existing TipTap `inlineImage` node.

- `data-layout="inline|block"`
- `data-rotation="0|90|180|270"`

The existing node is already schema-inline. Presentation code will choose whether its NodeView/output wrapper behaves as inline content or as a full-width block row. This avoids a second ProseMirror node type and avoids node replacement when switching placement modes.

Missing `data-layout` means legacy `block`. Missing `data-rotation` means `0`. New insertion flows explicitly set `layout: inline` and `displayWidth: 160`.

Rejected alternatives:

- Inferring layout from paragraph context is ambiguous during copy/paste, templates, sanitization, and PDF conversion.
- Separate inline and block image node types require migrations and fragile node replacement for selection and undo history.

## 5. Presentation Contract

Extend the shared inline-image presentation record with:

```ts
export type InlineImageLayout = 'inline' | 'block'
export type InlineImageRotation = 0 | 90 | 180 | 270

export type InlineImagePresentation = {
  displayWidth: number | null
  naturalWidth: number | null
  naturalHeight: number | null
  crop: InlineImageCrop | null
  layout: InlineImageLayout
  rotation: InlineImageRotation
}
```

Contract rules:

- `displayWidth` remains an integer from 80 through 2048.
- New inline image insertions use `displayWidth: 160`.
- Natural dimensions remain integers from 1 through 65535.
- Crop coordinates remain integer normalized original-source coordinates from 0 through 10,000 and must be fully contained.
- Layout accepts only `inline` or `block`.
- Rotation accepts only `0`, `90`, `180`, or `270`.
- Invalid layout or rotation is removed independently and falls back to block or 0°.
- No free-form transform string is accepted or serialized.

The visible width is always `displayWidth`. At 90° and 270°, shared geometry swaps the effective aspect ratio when calculating the visible height.

## 6. Crop Interaction

### 6.1 Root cause

The current pointer flow computes same-sign pointer deltas, then `panInlineImageCrop()` subtracts them from crop coordinates. This implements “move the source image under a fixed crop,” while the UI exposes and labels a movable crop region. The visible box therefore travels opposite the pointer.

### 6.2 Correct behavior

Dragging inside the crop region moves the crop region itself:

- rightward pointer delta increases visual crop X;
- leftward pointer delta decreases visual crop X;
- downward pointer delta increases visual crop Y;
- upward pointer delta decreases visual crop Y.

The crop remains clamped to the visible rotated source. Its size does not change during region movement. Edge/corner handles keep their existing direct movement semantics. Arrow keys move the crop in their named direction; Shift+arrow uses the existing larger step.

### 6.3 Rotated crop mapping

Crop coordinates remain canonical against the original source. Crop mode projects the canonical crop into the current rotated orientation. Pointer, touch, keyboard, preset, and resize operations occur in visual rotated coordinates, then map back to canonical source coordinates for Apply.

Quarter-turn mapping must be centralized in pure geometry functions and round-trip exactly for all four rotations. Rotating an already-cropped image rotates the same selected source region; it does not clear or mutate the crop.

Cancel or Escape restores the exact pre-session presentation. Reset crop selects the full rotated visual source while retaining layout, display width, and rotation.

## 7. Placement and Editor UX

### 7.1 New insertion defaults

Toolbar upload, paste, and drop all create inline placements at the cursor with an explicit 160px display width. Pending and failed upload placeholders occupy the same logical inline position. Successful retry preserves the intended inline layout and width.

Legacy images without layout metadata render as block. Template copies preserve the source placement initially and then diverge independently.

### 7.2 Inline placement

An inline image behaves as an atomic inline element inside a paragraph:

- text may appear immediately before and after it;
- wrapper uses inline-block behavior and middle vertical alignment;
- the image may increase line-box height;
- normal text wrapping occurs when remaining line width is insufficient;
- `max-width: 100%` prevents viewport/editor overflow;
- resize remains proportional and bounded.

Block left/center/right controls are not meaningful while inline. Switching to block reveals/enables block alignment controls. Switching back to inline preserves the stored alignment for a later block-mode return but alignment has no visual effect inline.

### 7.3 Toolbar controls

The selected-image toolbar adds:

- placement toggle: Inline / Block;
- Rotate left 90°;
- Rotate right 90°;
- Reset rotation.

Rotation cycles modulo 360 and commits one TipTap node-attribute transaction per activation. Buttons use existing SVG/Lucide icon conventions, accessible names, visible focus states, and pressed/current state where applicable. No emoji icons are used.

Crop sessions continue blocking conflicting editor commands and parent save actions. Rotation and placement changes are unavailable during an active crop session unless performed through crop-specific controls explicitly designed for that session; this version keeps them disabled until Apply or Cancel.

## 8. Trusted Rendering

### 8.1 Editor

The React NodeView consumes only parsed shared presentation metadata. It renders:

- inline wrapper for inline layout;
- full-width row plus shrink-wrapped aligned frame for block layout;
- trusted geometry for bare or cropped quarter-turn rotation;
- selection outline, floating toolbar, and resize handles around the final visible frame.

Rotation must not change the configured visible width. At 90°/270°, frame height uses the swapped effective aspect ratio. Resize handles operate on final visible width.

### 8.2 Application views

Stored HTML is sanitized first. The trusted materializer converts validated image metadata into generated wrappers and numeric styles. Inline wrappers remain inline with prose. Block wrappers remain independent full-width rows with left/center/right margins. Bare and cropped rotated images use the same shared geometry authority as the editor.

Generated classes/styles are output-only and never persisted. If materialization fails, output falls back safely to the sanitized unrotated image with valid remaining metadata rather than exposing untrusted styling.

### 8.3 PDF

PDF HTML uses the same validated presentation and geometry. Tests cover inline/block, all quarter turns, and bare/cropped paths. Block alignment remains left/center/right; inline images participate in surrounding text flow as supported by Chromium print layout.

Owner-scoped authorization and the single authorized private file read remain unchanged.

### 8.4 Email and plain text

HTML email continues replacing private canonical images and resolved data URIs with the existing safe placeholder/alt representation. Rotation, crop, and layout do not cause private bytes to be embedded. Plain text retains surrounding words and image alt text only.

## 9. Sanitization and Security

- Canonical source policy remains `/api/inline-images/<UUID>` only.
- Layout and rotation use explicit allowlists.
- Numeric metadata keeps existing strict integer parsing and bounds.
- Crop metadata remains all-or-nothing and requires valid natural dimensions.
- Invalid transform metadata cannot affect storage IDs, owner queries, file paths, MIME detection, retention, quotas, or reference reconciliation.
- Stored HTML never permits arbitrary `style`, `class`, event handlers, CSS transforms, external sources, blob sources, or data sources.
- Rotation and layout are placement metadata only; original bytes are never modified or duplicated.

## 10. Mobile and Accessibility Requirements

Guidance incorporates `nextlevelbuilder/ui-ux-pro-max-skill` targeted UX searches for dragging movements, touch targets, toolbar overflow, and responsive image scaling.

- Mobile crop and toolbar controls use at least 44×44 CSS-pixel touch targets, exceeding the WCAG 2.2 web minimum and matching the project’s existing coarse-pointer requirement.
- Adjacent touch targets use at least 8px separation where layout permits.
- Drag operations retain single-pointer alternatives: crop-region arrow-key operation, focusable handles, preset controls, zoom input, and explicit rotate buttons.
- Crop surfaces use appropriate `touch-action` behavior to prevent delayed or conflicting gestures while preserving intended scrolling outside the surface.
- Pointer/touch crop gestures must not accidentally select text, scroll the editor, trigger pull-to-refresh, or lose capture when leaving a handle.
- Controls must not rely on hover and must expose accessible labels and visible keyboard focus.
- Toolbars and images must not create horizontal viewport scrolling at 320, 375, 414, or 768 CSS pixels.
- Inline images remain `max-width: 100%` and responsive after viewport changes.
- No transform or resize transition is required; reduced-motion users receive no decorative movement.

The stack search recommended `next/image`, but this editor intentionally retains authenticated canonical `<img>` rendering because TipTap node views, private runtime routes, crop geometry, and HTML/PDF materialization require direct image semantics. The general recommendation is not applied blindly.

## 11. Testing Strategy

All production changes follow strict red-green-refactor TDD.

### 11.1 Crop-direction regression

- Pure failing test: positive X/Y drag moves crop X/Y positively.
- Boundary tests in all directions.
- Pointer integration test proves pointer deltas are not inverted.
- Browser bounding-box test proves the crop rectangle follows right/down and left/up drags.
- Touch test proves the crop rectangle follows the finger.

### 11.2 Rotation geometry

- Parse/serialize/sanitize all four allowed rotations and reject all other values.
- Rotate-left/right modulo-360 cycles and reset.
- Visual-to-canonical and canonical-to-visual crop mappings round-trip for 0°, 90°, 180°, and 270°.
- Rotated crop bounds, preset application, handle resizing, keyboard movement, wheel zoom, and pinch zoom.
- Existing crop remains selected across rotation.
- Display width remains unchanged; visible height swaps correctly at quarter turns.

### 11.3 Placement

- Missing layout defaults to legacy block.
- Toolbar upload, paste, drop, and retry insert inline at 160px.
- Text before and after an inline image remains in the same paragraph and same line when measured space permits.
- Normal wrapping occurs without overflow when space is insufficient.
- Inline/block switching preserves image metadata and undo/redo.
- Block alignment remains correct and inactive inline alignment does not affect inline position.

### 11.4 Output parity

Behavioral generated-output tests cover:

- inline and block;
- 0°, 90°, 180°, and 270°;
- bare and cropped;
- block left, center, and right alignment;
- trusted private-image resolution and owner scoping;
- save/reopen and template-copy independence.

Editor/application/PDF geometry assertions compare visible width, effective aspect ratio, crop, rotation, and placement.

### 11.5 Mobile UI

Automated mobile browser coverage at minimum 375×812, with responsive assertions at 320, 414, and 768 widths, verifies:

- new image insertion at 160px without horizontal overflow;
- same-line text before/after when space permits and normal wrapping otherwise;
- reachable placement and rotation controls;
- no toolbar overflow or clipped critical controls;
- at least 44×44 touch targets and adequate spacing;
- same-direction touch crop drag in both axes;
- pinch zoom after drag-direction correction;
- rotated crop interaction in the visible orientation;
- Apply, Cancel, Reset, save, and reopen;
- no accidental editor scrolling or text selection during gestures;
- responsive inline/block rendering after viewport changes.

The full opt-in browser release gate remains fail-closed and throws `BLOCKED_BROWSER_ENV` when disposable `E2E_*` credentials or records are unavailable. Focused regression/component browser coverage must run in the normal suite where the repository harness permits it; live acceptance artifacts supplement but do not misrepresent the blocked release gate as passing.

## 12. Acceptance Criteria

1. Crop-box pointer and touch movement follows the input direction in both axes.
2. New toolbar, paste, and drop images default inline at 160px.
3. Text can appear before and after an inline image on the same line when space permits.
4. Existing images without layout metadata remain block.
5. Users can switch inline/block without losing width, crop, rotation, alt text, source, or stored block alignment.
6. Users can rotate left/right in 90° increments and reset; no arbitrary rotation or flip exists.
7. Crop mode displays the current rotated orientation and Apply persists the intended original-source crop.
8. Rotation never modifies or duplicates private source bytes.
9. Editor, application view, and PDF agree for inline/block × quarter-turn rotation × bare/cropped images.
10. HTML email does not embed private image bytes; plain text preserves words/alt text only.
11. Mobile controls are touch-usable, keyboard-accessible, and free of horizontal overflow.
12. Sanitized storage contains only canonical sources and bounded semantic metadata—never arbitrary CSS or transient editor state.
13. Authorization, reference tracking, retention, quota, upload cleanup, templates, and existing rich-text behavior remain regression-clean.
14. `npm run check`, `graphify update .`, and `git diff --check` pass before completion.
