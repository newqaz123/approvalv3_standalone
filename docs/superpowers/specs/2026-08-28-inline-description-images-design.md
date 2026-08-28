# Inline Description Images Design

**Date:** 2026-08-28  
**Status:** Approved design; awaiting spec review  
**Selected direction:** Dedicated inline-image assets with private storage and reference tracking  
**Scope:** All rich description editors; migration file included, no production migration run

## Summary

Add privately stored inline images to the shared TipTap description editor. Users can add an image through the toolbar, paste it from the clipboard, or drag it into the editor. The same feature will be available in request, solution, resubmission, and template description editors.

Inline images are a separate asset type from downloadable `file_attachments`. A draft image is uploaded before its parent request, solution, or template necessarily exists, then linked transactionally when the description is saved. Saved descriptions store only stable internal URLs such as `/api/inline-images/<uuid>`; they never store base64 data, temporary blob URLs, signed URLs, or filesystem paths.

The rich-text sanitizer remains authoritative. It will preserve only internal image URLs and approved image attributes. Existing attachment behavior and existing descriptions without images remain unchanged.

## Design Reference

Approved through the brainstorming session of 2026-08-28:

- Dedicated inline-image assets rather than reusing `file_attachments` or storing base64.
- Enabled in all shared description editors.
- Toolbar upload, clipboard paste, and drag-and-drop.
- Private authenticated delivery, draft cleanup, shared template references, image alignment, and alt-text editing.

## Goals

1. Let users place uploaded images inside every shared rich description editor.
2. Support toolbar selection, clipboard paste, and drag-and-drop through one upload pipeline.
3. Keep image bytes out of description strings and private filesystem paths out of HTML.
4. Reuse the existing image validation, optimization, private-storage, and compensation patterns.
5. Support descriptions copied from templates without duplicating image bytes or breaking the original template.
6. Keep draft uploads owner-scoped and remove abandoned or unreferenced files safely.
7. Preserve inline images in application rendering and completed-approval PDF output.
8. Keep existing rich text, legacy formatted text, and downloadable attachments working unchanged.

## Non-goals

1. External image URLs, data URLs, SVG, remote image importing, or hotlinking.
2. Image cropping, freeform resizing, captions, galleries, lightboxes, or annotations.
3. Replacing or merging the existing attachment uploader.
4. Backfilling or rewriting existing descriptions or attachments.
5. Storing an original plus multiple image derivatives.
6. Embedding private image binaries in notification emails. Email summaries will use image alt text and direct recipients to the authenticated application.
7. Running a production migration or deploying the feature from the local development workflow.

## 1. Data model

Add an `inline_description_images` asset model with these fields:

- `id`: UUID primary key.
- `uploadedById`: owning user for draft authorization and auditing.
- `uploadSessionId`: client-generated UUID that scopes one editor session.
- `fileName`: sanitized display filename.
- `fileType`: verified output MIME type.
- `originalSize`: validated original byte count.
- `fileSize`: actual stored byte count.
- `filePath`: private storage path.
- `width` / `height`: normalized output dimensions.
- `deletionPendingAt`: nullable timestamp used by retry-safe physical cleanup.
- `createdAt`: upload time.

An asset is a draft while it has no saved references. It becomes committed when at least one reference is created. No client-provided status flag is authoritative.

Add an `inline_description_image_references` model with:

- `id`: UUID primary key.
- `imageId`: required foreign key to the asset, `onDelete: Cascade`.
- Exactly one nullable owner foreign key: `requestId`, `solutionId`, or `templateId`, each `onDelete: Cascade`.
- `createdAt`.

The migration adds a PostgreSQL check constraint requiring exactly one owner column to be non-null. Unique constraints prevent duplicate `(imageId, ownerId)` references for each owner type. Indexes cover `imageId`, every owner ID, `uploadedById`, `uploadSessionId`, and `createdAt`.

Using real owner foreign keys preserves database integrity while still allowing one immutable image asset to be referenced by a template and by any requests created from that template.

Update Prisma relations on `User`, `requests`, `solutions`, and `templates`. Add a migration file, but do not run a production migration locally.

## 2. Upload session and asset lifecycle

Each form instance creates one stable `crypto.randomUUID()` upload-session ID. It remains unchanged across renders and preview/edit transitions and is replaced only after a successful save or explicit reset.

A shared client coordinator owns:

- the upload-session ID;
- pending, uploading, failed, and successful upload state;
- retry and draft removal;
- whether form submission must be blocked;
- deterministic cancel/reset cleanup;
- best-effort unmount cleanup.

The editor receives this coordinator rather than implementing storage or form submission itself. All editor entry points call the same upload function.

### Upload

1. Authenticate the caller and require an active account.
2. Validate the upload-session ID as a UUID.
3. Validate original filename, MIME type, non-empty size, and the existing 10 MB per-file limit.
4. Accept only JPEG, PNG, WebP, and GIF. Reject SVG even if its metadata claims an image MIME.
5. Decode the bytes server-side to verify that they are a real supported image.
6. Reuse `optimizeImageAttachment` for orientation normalization, metadata removal, resizing, and format-preserving optimization. GIF remains byte-preserving after successful format verification.
7. Record normalized dimensions and actual stored size.
8. Write through the private storage layer under an inline-image-specific UUID path.
9. Create the draft database row. If the insert fails, delete the physical file using the existing compensation pattern.
10. Return only serializable public metadata: ID, stable internal URL, MIME, dimensions, and stored size.

### Save and claim

Every request, solution, resubmission, and template save path must use one shared server helper inside the same database transaction as its owner write:

1. Sanitize the submitted description.
2. Extract unique inline image IDs only from canonical internal `src` URLs.
3. Enforce no more than 10 inline images in one description.
4. Load every referenced asset and fail the save if any ID is missing.
5. A reference is eligible when either:
   - it is an unreferenced draft owned by the current user and matching the submitted upload-session ID; or
   - it is already committed and therefore reusable from a saved template/request/solution description available to the caller.
6. Create missing references for the saved owner.
7. Remove references no longer present in that owner's description.
8. Persist the sanitized canonical description and reference changes atomically.

A failed owner save leaves matching drafts available for retry. A successful save clears only local coordinator state; it must not delete newly committed assets.

### Removal and cleanup

- Removing an uncommitted image from the editor deletes that owner/session-scoped draft row first, then removes its physical file. A failure remains visible and retryable.
- Removing a committed image from an edited description changes references only when the owner save succeeds. Cancelling an edit leaves existing references untouched.
- Explicit form cancel cleans every unreferenced draft owned by the current user and upload session before closing when the UI can await the result.
- Unmount cleanup is best-effort and owner/session scoped; it never deletes committed assets.
- A cleanup helper removes unreferenced assets older than 24 hours. It runs opportunistically before a new upload and is callable from maintenance/retention flows.
- Cleanup is retry-safe: a transaction locks an unreferenced candidate and sets `deletionPendingAt`; claim/link helpers reject deletion-pending assets; physical deletion runs next; then a second transaction deletes the still-unreferenced row. If physical deletion fails, the pending row and private path remain for a later retry. A missing physical file counts as already deleted so a retry can finish removing the row.
- Request, solution, or template deletion cascades its references. An asset shared by another owner remains. The unreferenced-asset cleanup removes it only after its final reference disappears.

## 3. Editor behavior

Extend the TipTap schema with a focused image node or extension. It must support only the attributes needed by this feature:

- canonical internal `src`;
- `alt` text;
- `data-align` with `left`, `center`, or `right`.

### Insertion methods

- **Toolbar:** an Image button opens an image-only file picker.
- **Paste:** clipboard image files upload at the current selection. Ordinary HTML containing external `<img>` tags is sanitized and does not import remote images.
- **Drag-and-drop:** dropped image files upload at the drop position. Non-image files continue to be ignored by the editor and may be handled by the separate attachment uploader.

Every inserted file creates a client-only upload node/NodeView with progress. Transient blob URLs and upload IDs must not enter the controlled description value. Controlled-value synchronization must preserve local pending nodes until they become a stable image node or are removed.

On success, the transient node becomes a normal image node using the returned internal URL. On failure, the node displays a concise error with Retry and Remove controls. Submission is disabled while any inline image is uploading or failed; the user must wait, retry, or remove it.

### Image controls

Selecting a committed image exposes:

- editable alt text, capped at 300 characters;
- alignment: left, center, or right;
- remove.

The default alt text is the sanitized filename without its extension. A user may set empty alt text to mark an image decorative. Controls must be keyboard-accessible and include labels and visible focus states.

Images render responsively with `max-width: 100%` and intrinsic aspect ratio. Alignment is represented by the approved `data-align` value and renderer CSS, not arbitrary inline styles or classes supplied by users.

The lazy-editor error boundary remains in place. If TipTap fails to load, the plain fallback can display and edit text/HTML but cannot upload new images; it must not discard already stored image markup silently.

## 4. Editor coverage

Enable the coordinator and image-capable shared editor in every current `RichTextEditor` authoring surface:

- `src/components/requests/request-form.tsx`
- `src/components/requests/request-resubmit-modal.tsx`
- `src/components/requests/resubmit-request-dialog.tsx`
- `src/components/solutions/solution-form.tsx`
- both request and solution description modes in `src/components/requests/submitter-modal.tsx`
- `src/components/admin/template-form.tsx`

Template selection copies description HTML unchanged. Saved template image assets remain immutable and may receive additional request references when the copied request description is saved. Deactivating or editing the template cannot break requests that already reference the same assets.

Preview/edit transitions in solution submission must retain the same upload session and pending state. Existing attachment state and retry behavior remain independent.

## 5. API, storage, and authorization

Add these authenticated route handlers:

- `POST /api/inline-images`: upload one draft image; multipart form data includes `file` and `uploadSessionId`.
- `GET /api/inline-images/[id]`: stream one private image.
- `DELETE /api/inline-images/[id]`: remove one unreferenced draft; the request includes `uploadSessionId`, and the server matches it with the authenticated uploader.

### Read authorization

- Draft image: only its active uploader may read it.
- Request reference: caller must be allowed to view that request under existing request visibility rules.
- Solution reference: authorization derives from the related request and existing solution visibility.
- Template-only reference: caller must be allowed to use the active template; inactive/admin-only template access follows existing template authorization.
- If any reference grants access, the committed image may be streamed.

Responses use the stored verified MIME, a fixed content length, `X-Content-Type-Options: nosniff`, and private cache headers. They never expose `filePath` or accept a client-provided path.

Server-side PDF/export code reads bytes through a server-only asset resolver scoped to the exported owner; it does not bypass ownership by accepting arbitrary IDs from HTML.

## 6. Sanitization and canonical HTML

Extend `RICH_TEXT_ALLOWED_TAGS` with `img`, but do not add a general image URL scheme.

`sanitizeRichText` must preserve an image only when:

- `src` exactly matches the canonical same-origin path `/api/inline-images/<UUID>`;
- the UUID is canonical and normalized;
- attributes are limited to `src`, `alt`, and `data-align`;
- `data-align` is `left`, `center`, or `right`.

All event attributes, `style`, `class`, `id`, `srcset`, external URLs, protocol-relative URLs, `data:`, `blob:`, `file:`, SVG, and malformed paths are removed. If an image loses its valid `src`, remove the image element rather than preserving a broken node.

Canonicalization occurs before storage and again at every render boundary. Stored HTML is still treated as untrusted. The existing link rules and all non-image rich-text rules remain unchanged.

Description validation continues to use the 20,000-character stored HTML limit. Visible-content validation treats a valid image as content even when its alt text is empty; `<p><br></p>` remains empty.

## 7. Rendering, email, and PDF

### Application UI

All existing `FormattedText` rich-HTML render paths preserve sanitized internal image elements and apply shared responsive/alignment CSS. Legacy `**bold**` descriptions and rich descriptions without images follow their current paths unchanged.

Broken or unauthorized image responses show the browser's normal missing-image state and retain meaningful alt text. Rendering must not fall back to an external URL.

### Notification email

Email summaries do not attach or remotely expose private image bytes. Before truncation, the email renderer replaces each approved image with escaped alt text such as `[Image: floor plan]`, or `[Image]` when alt text is empty. The email's existing authenticated request link remains the path to the full description. Plain-text email uses the same replacement.

### Completed-approval PDF and server export

The completed-approval PDF must include images referenced by the exported request/solution descriptions. The server-only export renderer:

1. sanitizes the description;
2. extracts canonical image IDs;
3. verifies that each image is referenced by the exported owner;
4. reads the private optimized bytes;
5. substitutes a bounded data URI only in the trusted, server-generated PDF HTML.

Stored descriptions never receive data URIs. Missing assets render their alt text and do not fail the entire export. Print CSS keeps images within the page content width and avoids splitting an image when practical.

Retention backup/report generation uses the same owner-scoped PDF resolver. Raw inline-image files need not be duplicated separately when the generated report already contains them, unless the existing backup contract is later expanded explicitly.

## 8. Limits and abuse prevention

- Maximum original upload size: existing 10 MB per image.
- Maximum images referenced by one description: 10.
- Maximum logical image bytes per description: 100 MB, calculated from referenced assets' stored sizes.
- Maximum live drafts in one upload session: 10; maximum cumulative original bytes in that session: 100 MB. The upload route enforces both before accepting another file.
- Maximum concurrent uploads from one editor: 3; additional files queue locally.
- Supported formats: JPEG, PNG, WebP, GIF.
- SVG and all non-image attachments are rejected.
- The server enforces count and byte limits; client checks exist only for early feedback.
- Upload and cleanup errors return user-safe messages and log implementation details server-side according to current logging conventions.

The storage dashboard must include inline-image stored bytes so administrators see their disk impact. Existing attachment totals remain separately identifiable where the current UI distinguishes categories.

## 9. Failure behavior

- Validation or decode failure: no file and no database row.
- Storage write failure: no database row.
- Database insert failure after storage: best-effort physical-file compensation.
- Upload network failure: failed node remains retryable; form submission stays blocked.
- Owner save failure: uploaded drafts and editor content remain available for retry.
- Reference reconciliation failure: owner description write rolls back in the same transaction.
- Draft cleanup failure: affected item remains visible when the UI is still mounted; unmount cleanup logs the failure.
- Physical cleanup failure: keep the asset row with `deletionPendingAt` and its private path for maintenance retry; never report a false successful deletion.
- PDF image resolution failure: render alt text, record an export warning where supported, and continue the export.

## 10. Testing and verification

Implementation uses TDD.

### Sanitizer and description validation

- Accept canonical internal image URLs and approved attributes.
- Normalize valid UUID paths and alignment values.
- Reject external, protocol-relative, data, blob, file, SVG, malformed, and traversal-style sources.
- Strip event handlers, styles, classes, ids, and `srcset`.
- Remove `<img>` when its source is invalid.
- Count a valid image as description content while retaining current empty-text behavior.
- Preserve all existing rich-text and legacy-format tests.

### Upload and storage

- Require authentication, active user, and valid upload-session UUID.
- Reject unsupported metadata, oversized input, spoofed/corrupt bytes, and SVG.
- Optimize supported raster images and persist actual MIME, dimensions, and stored byte count.
- Preserve verified GIF bytes.
- Compensate physical files when database creation fails.
- Never expose private paths in responses.

### Claiming, references, and cleanup

- Claim matching owner/session drafts transactionally with request, solution, and template saves.
- Reject another user's draft or a draft from another session.
- Reuse committed template assets without duplicating bytes.
- Reconcile added and removed owner references.
- Keep shared assets after one owner removes or deletes its reference.
- Delete only assets with no references.
- Clean owner/session drafts on cancel and drafts older than 24 hours.
- Preserve drafts after owner-save failure.
- Enforce the 10-image server limit.

### Authorization and rendering

- Restrict draft reads to the uploader.
- Apply existing request, solution, and template visibility to committed reads.
- Return safe content headers and verified MIME.
- Render responsive alignment in application HTML.
- Replace images with alt text in HTML and plain-text emails.
- Embed only owner-referenced images in PDF HTML; use alt text on missing/unauthorized assets.
- Include inline-image bytes in storage dashboard totals.

### Editor and form integration

- Toolbar, paste, and drag/drop all invoke one upload coordinator.
- Pending NodeViews never leak blob URLs or transient IDs into controlled HTML.
- Successful uploads become canonical image nodes.
- Failure exposes Retry and Remove.
- Alt-text and alignment edits emit sanitized canonical HTML.
- Active or failed uploads block submission.
- Cancel cleans drafts; successful save clears local state without deleting committed images.
- Preview/edit transitions preserve session and upload state.
- Every listed description editor is wired.
- Existing attachment upload/retry flows remain unchanged.

### Required verification

Run:

```text
npm run check
graphify update .
```

Do not run production migrations. Keep the pre-existing untracked `presentation-output/` directory untouched.

## Acceptance Criteria

1. Every shared request, solution, resubmission, and template description editor supports image toolbar upload, clipboard paste, and drag-and-drop.
2. Descriptions store only sanitized canonical internal image URLs; no base64, blob, signed, external, or filesystem URLs are stored.
3. JPEG, PNG, WebP, and GIF uploads pass server-side byte verification; supported images reuse the existing optimizer and private storage.
4. Drafts are owner/session scoped, retryable after save failure, cleaned on cancel/expiry, and cannot be claimed or deleted by another user.
5. Saving a description links and reconciles image references atomically with its request, solution, or template write.
6. Template images can be reused by requests without byte duplication and survive template edits or removal while another owner references them.
7. Application rendering preserves responsive images, approved alignment, and alt text; notification emails use alt-text placeholders; completed PDFs embed authorized image bytes.
8. The sanitizer rejects external/data/blob/SVG sources and all unapproved attributes without weakening existing link or rich-text rules.
9. Submission is blocked for active or failed image uploads, and users can retry or remove failures.
10. Existing descriptions, legacy formatting, downloadable attachments, authorization, previews, notifications, retention, and exports remain functional.
11. Storage reporting includes inline-image bytes.
12. A migration file is included without running a production migration locally.
13. `npm run check` passes and `graphify update .` refreshes the project graph after implementation.
