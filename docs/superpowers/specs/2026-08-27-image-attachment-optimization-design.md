# Image Attachment Optimization Design

**Date:** 2026-08-27  
**Status:** Approved design; awaiting spec review  
**Scope:** Local repository only; no production migrations or deployment

## Summary

Optimize uploaded image attachments on the server before they are stored. The same optimizer will be used by the request upload action and the solution-draft upload action, so JPG/JPEG/PNG/WebP files receive consistent treatment regardless of which form uploaded them. The existing private-storage, authorization, cleanup, and database model remain authoritative.

The upload UI will report the original browser file size and the final stored size after a successful upload. Existing attachments are not rewritten by this feature.

Inline images inside rich descriptions and table editing are explicitly separate features and are not included.

## Goals

1. Reduce the storage footprint of newly uploaded JPG/JPEG/PNG/WebP attachments.
2. Cap the longest image edge at 2048 pixels without enlarging smaller images.
3. Use quality 82 for JPEG and WebP output.
4. Preserve PNG format and transparency while using palette compression at quality 82.
5. Never replace an image with an optimized result that is larger than the original.
6. Apply the behavior to both `uploadFileAction` and `uploadSolutionDraftAttachmentAction`.
7. Persist the actual stored byte count in `file_attachments.fileSize`.
8. Show a successful uploader the original-to-stored size when optimization reduced the file.
9. Keep malformed, unsupported, and unauthorized uploads from creating files or database rows.

## Non-goals

1. No inline `<img>` support inside descriptions.
2. No table tools or other rich-text editor changes.
3. No rewriting or backfilling existing attachments.
4. No second copy of the original file.
5. No database schema migration.
6. No change to the existing 10 MB per-file limit, attachment-count limit, authorization rules, or private file-access policy.
7. No GIF re-encoding; GIF uploads remain byte-preserving.

## Selected approach

Use a shared server-side Sharp helper rather than browser-only processing or an original-plus-derivative storage model.

Server-side processing is deterministic across browsers, cannot be bypassed by custom clients, and fits the existing action flow: validate metadata, prepare bytes, write through private storage, then create the Prisma row with compensation cleanup on DB failure.

Sharp must remain server-only. It must not be imported by client components or by the browser-safe attachment policy module.

## Optimization policy

### Eligibility

The existing attachment policy remains the first gate. Only a policy-approved JPG/JPEG/PNG/WebP upload is optimized. Eligibility is based on the already validated filename/MIME combination:

- `.jpg` / `.jpeg` + `image/jpeg`
- `.png` + `image/png`
- `.webp` + `image/webp`

GIFs, CAD files, Office files, PDFs, and all other non-eligible files bypass image processing and use their current byte path unchanged.

The request upload input should include `.webp`, which is already accepted by the shared server policy, so the client picker does not hide a supported image type.

### Transformation

The helper accepts the original bytes and validated metadata and returns the bytes to store plus whether the output is smaller.

The common Sharp pipeline is:

1. Decode the image from the uploaded bytes.
2. Apply EXIF orientation with `rotate()`.
3. Resize with `fit: 'inside'`, a 2048px width and height bound, and `withoutEnlargement: true`.
4. Encode in the original image format:
   - JPEG: quality 82 with JPEG optimization enabled.
   - WebP: quality 82.
   - PNG: palette compression at quality 82, maximum PNG compression, and adaptive filtering. Alpha/transparency must be retained.
5. Do not copy metadata back into the output. This removes EXIF metadata while preserving the visual orientation through the normalized pixels.

The original filename and extension remain unchanged. The output format remains compatible with the existing file metadata and preview/export logic.

If the transformed byte buffer is not strictly smaller than the original, store the original bytes instead and report the upload as unchanged. This prevents a lossless or unusually efficient source file from growing due to re-encoding. The original input has already passed the 10 MB limit, so the fallback remains within policy.

### Failure behavior

A supported file that cannot be decoded or transformed returns a controlled, user-safe image-processing error. Sharp error details are logged only if the existing server logging policy permits it; they are never sent to the client. No attachment row is created and no processed file is written when preparation fails.

If the subsequent storage write succeeds but the database insert fails, the existing best-effort physical-file compensation deletes the written file before the action rethrows the database error.

## Components and data flow

### Shared optimizer

Add a focused server-only module such as:

```text
src/lib/attachments/image-optimization.ts
```

It owns format eligibility, the Sharp transformation, output-size comparison, and a small result type. It must not own authorization, Prisma access, filesystem paths, or UI state.

Conceptual interface:

```ts
optimizeImageAttachment(input: {
  bytes: Buffer
  fileName: string
  mimeType: string
}): Promise<{
  bytes: Buffer
  originalSize: number
  storedSize: number
  optimized: boolean
}>
```

The exact exported names may follow repository conventions, but callers must receive the final byte buffer and final size from one well-defined boundary.

### Request upload action

`src/server-actions/files.ts` currently implements `uploadFileAction`. Keep its existing order and authorization checks:

1. Authenticate the caller.
2. Read the `File` and request ID.
3. Validate the original name, MIME type, and size with `validateAttachmentMetadata`.
4. Read the original bytes and invoke the shared optimizer for eligible images.
5. Write the returned bytes through `writeAttachmentFile`.
6. Create `file_attachments` with `fileSize` equal to the returned stored byte length.
7. Keep the current DB-failure compensation, activity log, and revalidation behavior.

The action response must expose the created attachment's actual `fileSize`, which the request uploader can use for its size display.

### Solution draft upload action

Use the same helper in `uploadSolutionDraftAttachmentAction` after its existing active-engineering-role, request-state, and metadata checks. Keep the draft row scoped to the request with `solutionId: null` and the current uploader. Store the optimized byte length in `fileSize`, serialize it through the existing `SerializedAttachment`, and preserve all draft cleanup and later transfer behavior.

The solution upload hook's injected `uploadOne` result must carry the returned stored size through `uploadAttachmentBatch` into the local item state. Existing successful attachment IDs remain reusable and retry behavior remains unchanged.

### UI reporting

Extend the local upload item state only as needed to carry the server-reported stored size. The browser `File.size` remains the original size.

After a successful optimized upload, both attachment surfaces show a concise result such as:

```text
2.74 MB → 327.6 KB · optimized
```

When the file is unchanged, not an eligible image, or the optimized output is not smaller, retain the existing single-size presentation. The displayed result must come from the server response, not a client-side estimate.

Affected client boundaries are limited to the current upload components and batch coordinator:

- `src/components/requests/file-upload-zone.tsx`
- `src/components/solutions/solution-file-upload.tsx`
- `src/lib/attachments/upload-batch.ts`
- `src/hooks/use-solution-attachments.ts`

No UI needs to display image dimensions, quality settings, or Sharp errors.

## Security and compatibility

- Keep the original 10 MB validation before reading and processing the upload.
- Keep all current role, request-state, ownership, and attachment-count checks unchanged.
- Use the private storage layer; never write optimized images under a public static path.
- Resolve and write the same safe UUID-prefixed path as today.
- Treat Sharp decoding as an additional content-integrity check, not as a replacement for the existing extension/MIME policy.
- Preserve the existing `fileType` and display filename because output format remains compatible with the validated input.
- Do not add SVG handling; it is outside the supported image policy.
- Do not expose optimizer internals or filesystem paths in client errors.
- Existing attachment download, preview, export, retention, and deletion flows continue to consume the same attachment row and path fields.

## Testing and verification

Use TDD for the helper and update the existing upload contracts.

### Unit tests

Add focused tests for the optimizer that assert behavior rather than exact byte counts:

- Landscape and portrait images are capped at a 2048px longest edge.
- Images already within the bound are not enlarged.
- JPEG output remains JPEG and uses the configured quality path.
- WebP output remains WebP and uses the configured quality path.
- PNG output remains PNG, retains alpha/transparency, and uses palette compression.
- A transformed output that is larger than its source falls back to the original bytes.
- GIF input is returned unchanged and is not re-encoded.
- Invalid image bytes produce a controlled failure.
- Metadata is not copied into the optimized output.

Synthetic buffers or committed fixtures should be used so tests do not depend on private uploaded content. Size assertions should use broad relationships (smaller/equal/original identity) rather than brittle exact numbers.

### Upload-flow tests

Extend regression coverage to verify:

- Both upload actions invoke the shared optimizer for eligible images.
- `file_attachments.fileSize` is based on the processed buffer, not the original `File.size`.
- The serialized draft result carries the stored size.
- A processing failure does not write a file or create a row.
- Existing authorization and cleanup contracts remain intact.

Update batch/coordinator tests so stored size is carried through successful uploads, retries still skip prior successes, and unchanged files render without a misleading optimization label.

### Required verification

Run:

```text
npm run check
graphify update .
```

Do not run production migrations. Keep the pre-existing untracked `presentation-output/` directory untouched.

## Acceptance criteria

1. New JPG/JPEG/PNG/WebP request and solution uploads are processed by one server-side helper.
2. Eligible images never exceed a 2048px longest edge unless the original is retained because optimization would increase storage.
3. JPEG/WebP use quality 82; PNG uses palette compression at quality 82 while retaining transparency.
4. GIFs and non-image attachments remain unchanged.
5. The stored database size equals the bytes actually written to private storage.
6. The uploader displays original-to-stored size for successful reductions.
7. Corrupt supported images fail safely without orphan files or database rows.
8. Existing authorization, private storage, cleanup, preview, download, export, and retention behavior remains intact.
9. Existing attachments are not rewritten and no database migration is required.
10. `npm run check` passes and the graph is updated.
