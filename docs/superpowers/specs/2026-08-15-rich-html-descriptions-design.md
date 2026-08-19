# Approval App Rich HTML Descriptions and PDF Export Design

**Date:** 2026-08-15
**Status:** Approved for planning
**Selected direction:** TipTap editor + whitelist sanitization + dual-format rendering

## Summary

Request and solution descriptions today are plain strings with `**bold**` markers, edited through a minimal textarea (`FormattedTextarea`) with a single Bold button, rendered through a safe tokenizer, and exported to PDF as escaped text. Users need fuller formatting — bold, italic, underline, strikethrough, lists, headings, and links — in the submitter (request/solution/resubmit) flows, and the completed-approval PDF export must reproduce that formatting.

This design introduces a TipTap-based rich text editor behind the existing controlled-component contract, sanitizes all description HTML against a strict whitelist at every render/save boundary, renders old and new formats side by side without a data migration, and upgrades the existing Puppeteer export path so descriptions keep their formatting in the PDF.

The security posture changes from "escape everything" to "sanitize then render": user-authored HTML is only ever rendered after whitelist sanitization, so tampered stored rows cannot inject markup, scripts, or hostile links into screens, emails, or PDFs.

## Design Reference

Chosen through the brainstorming session of 2026-08-15 (core rich text feature set; TipTap over custom contentEditable; MIT-licensed extensions only).

## Goals

1. Let submitters author descriptions with bold, italic, underline, strikethrough, bullet and numbered lists, headings, and links.
2. Render that formatting consistently in every existing description surface (modals, tables, previews, emails).
3. Preserve the formatting in the completed-approval PDF export.
4. Keep existing `**bold**`-format requests rendering exactly as today — no data migration.
5. Never render unsanitized HTML anywhere (React, email HTML, PDF).
6. Keep the editor off the critical path (lazy-loaded) and behind the existing form contracts.

## Non-goals

1. Inline images inside descriptions (attachments system already exists).
2. Tables or text/background colors in v1 (whitelist stays small).
3. Real-time collaborative editing (paid TipTap cloud features).
4. Migrating or rewriting historical `**bold**` description rows.
5. Changing request/solution schemas, server-action signatures, workflow status transitions, or the export builder's item-selection model.
6. Replacing the pending-`approval-chain` or engineering sub-task text areas.

## 1. Editor

A new `RichTextEditor` client component wraps TipTap:

- Extensions (all MIT): `Document`, `Paragraph`, `Text`, `Bold`, `Italic`, `Underline`, `Strike`, `BulletList`, `OrderedList`, `ListItem`, `Heading` (levels 2–3 only), `Link` (http/https/mailto), `History` (undo/redo).
- Toolbar buttons: **B / I / U / S**, bullet list, numbered list, H2, H3, link, undo, redo — each disabled/active from editor state, each keyboard-accessible with visible focus.
- Keyboard shortcuts from TipTap (Ctrl/Cmd+B, I, U, Z) work out of the box.
- Paste is normalized by TipTap into the supported node set; anything outside the schema is dropped on paste, not stored.
- The component exposes the same controlled contract as `FormattedTextarea`: `value: string`, `onChange(next: string)`, `disabled`, `placeholder`, `id`. Parents keep owning state; swap-in is mechanical.
- The editor is `next/dynamic`-lazy with a lightweight skeleton so TipTap never loads on pages that don't open an editing modal.
- `onChange` emits editor HTML **after sanitize** (defense in depth — the store should never even receive non-whitelisted markup from the editor).

Deployment targets (all description-authoring surfaces):

- `SubmitterModal` modes: `request`, `solution`, `resubmit` (`src/components/requests/submitter-modal.tsx`).
- Full-page solution form (`src/components/solutions/solution-form.tsx`).
- Request resubmit dialog (`src/components/requests/resubmit-request-dialog.tsx` / `request-resubmit-modal.tsx`).

`FormattedTextarea` stays for any consumer not migrated in this effort and remains exported; no consumer is forced.

## 2. Sanitization

Add `sanitize-html` (MIT, widely used) as the single sanitization authority.

- One exported whitelist module (`src/lib/rich-text-sanitizer.ts`) defines the allowed set: tags `p, br, strong, em, u, s, ul, ol, li, h2, h3, a`; attributes: `a[href]` restricted to `http:`, `https:`, `mailto:`; `target="_blank" rel="noopener noreferrer"` forced on links; all classes, styles, ids, and event attributes stripped.
- Exported helpers: `sanitizeRichText(html): string` and `containsRichTextHtml(source): boolean`. Detection requires **both**: the source's first non-whitespace character is `<`, and the source contains at least one whitelisted tag. TipTap output always satisfies this (top-level `<p>`, `<h2>`, `<h3>`, `<ul>`, or `<ol>` first); legacy prose that merely mentions a tag mid-sentence (e.g. `Use <h2> for headings`) starts with a letter and stays on the legacy tokenizer path.
- Applied at **every** boundary: editor `onChange` before parent state commits; React render path; email HTML generation; PDF HTML generation. Rendering code never trusts stored or incoming HTML directly.

## 3. Rendering — dual format, no migration

`FormattedText` (the safe React renderer used by 12+ consumers) gains format detection:

- If `containsRichTextHtml(source)` → render `dangerouslySetInnerHTML` with `sanitizeRichText(source)` (safe because it just passed the whitelist).
- Otherwise → existing `**bold**` tokenizer path, byte-for-byte unchanged. Residual edge: a legacy row that *starts* with literal HTML-looking text switches to the sanitized-HTML path, where unknown tags are stripped — visible degradation is limited to that row's literal tag text, with no security impact.
- Old rows keep today's rendering; new rows render rich; no DB rewrite, no backfill job, no dual columns.

Email (`src/server-actions/notifications.ts`) and PDF (`src/lib/pdf.ts`) use the same detection + `sanitizeRichText` before embedding.

## 4. PDF export after complete

The existing completed-approval export path is reused, not duplicated:

- `renderRequestEvidenceHTML` renders descriptions through the same detection/sanitize step, with print CSS for the new elements (headings scale down, lists indent, links show as blue text with the URL printed after the link text).
- Puppeteer generation (`generatePdfFromHTML`) is unchanged mechanically; it simply receives richer HTML.
- The export button/builder flow, package item selection, merge order, and eligibility rules (completed-only) are untouched.

## 5. Storage and validation

- DB column stays `string` — HTML is just a string format within it.
- Zod schemas for request/solution description: `max(5000)` → `max(20000)` (HTML envelope overhead: tags, entities, link attributes). The non-empty check (`min(1)`) validates against **visible text after tag-stripping**, so `<p><br></p>` alone is rejected just like whitespace today.
- Attachment, title, and all other field validations unchanged.

## 6. Accessibility and interaction requirements

- Toolbar buttons carry `aria-label` + `aria-pressed` for toggles; the editable region is a proper `contenteditable` with `aria-multiline`.
- Visible keyboard focus on toolbar controls; Tab order: toolbar → editor body.
- Screen-reader text alternatives unchanged: description fields keep their existing `<Label>` wiring through the shared `id`.
- No focus traps beyond the existing modal's; editor must not swallow Escape inside modals.

## 7. Data flow and error handling

- Client editor → `sanitizeRichText` → parent state → existing server action (Zod-validated) → DB.
- Render surfaces read the same string and always re-sanitize; stored tampering is inert.
- Sanitizer never throws on hostile input — worst case it returns stripped text.
- TipTap load failure degrades to the existing `FormattedTextarea` so submission flows never hard-fail on a chunk-load error.

## 8. Testing and verification

TDD throughout:

- `rich-text-sanitizer.test.ts`: whitelist acceptance for every allowed tag; rejection of `<script>`, `onerror`/`onclick` attributes, `javascript:`/`data:` hrefs, `<img>`, `<table>`, style/class/id attributes, nested unknown tags; link `target`/`rel` enforcement.
- `formatted-text.test.ts` additions: detection precedence; legacy `**bold**` path unchanged when no HTML present; HTML path renders sanitized output.
- Editor contract tests: controlled value/onChange round-trip, toolbar toggles emit expected tags, paste normalization keeps only whitelisted nodes.
- `pdf.ts` tests: description HTML reaches `renderRequestEvidenceHTML` sanitized and styled; legacy rows unchanged.
- Updated regressions where old contracts referenced the 5000 limit or Bold-only editor.
- e2e smoke: author formatted description in submitter modal → submit → view rendered → export PDF → assert PDF contains formatted text.
- Full `npm run check` green.

## Acceptance Criteria

1. Submitters can apply bold, italic, underline, strikethrough, bullet/numbered lists, H2/H3, and links in request and solution description editors.
2. Formatting renders correctly in all existing description surfaces with zero regressions to legacy `**bold**` rows.
3. The completed-approval PDF export reproduces the formatting.
4. No unsanitized HTML ever reaches a React render, email, or PDF; the sanitizer test suite covers the listed XSS vectors.
5. Descriptions up to 20000 stored characters validate; visually empty rich text is rejected.
6. No schema migrations, no server-action signature changes, no workflow changes.
7. Editor is lazy-loaded and degrades gracefully on load failure.
8. `npm run check` fully green including new suites.
