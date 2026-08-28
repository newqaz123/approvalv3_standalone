# Inline Description Images Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add secure, privately stored inline images to every rich description editor, including upload/paste/drop UX, transactional reference tracking, cleanup, rendering, email fallbacks, and PDF embedding.

**Architecture:** A dedicated Prisma asset model stores immutable optimized image bytes in private storage; a reference model links an asset to a request, solution, or template. A form-scoped upload coordinator stages owner/session-scoped drafts, while shared server helpers sanitize HTML and reconcile references inside each owner transaction. TipTap uses a custom image node and NodeView for progress/errors/controls, and renderers preserve only canonical internal image URLs.

**Tech Stack:** Next.js 15.5 App Router route handlers, React 19, TipTap 3.30 (`@tiptap/extension-image`, `@tiptap/extension-file-handler`, React NodeViews), Prisma 6.1/PostgreSQL, Sharp 0.34, `sanitize-html` 2.17, node:test/tsx, Playwright, Portly.

**Spec:** `docs/superpowers/specs/2026-08-28-inline-description-images-design.md`

## Global Constraints

- Canonical stored source: `/api/inline-images/<canonical UUID>` only. Never store base64, `blob:`, signed, external, protocol-relative, `file:`, SVG, or filesystem URLs.
- Supported upload formats: JPEG, PNG, WebP, and GIF. Maximum original size is 10 MB per image; maximum 10 images and 100 MB logical stored bytes per description/session.
- Maximum three concurrent client uploads; additional files queue.
- Allowed image HTML attributes: `src`, `alt` (maximum 300 characters), and `data-align` (`left`, `center`, `right`).
- Reuse `optimizeImageAttachment`; JPEG/PNG/WebP normalize orientation, strip metadata, cap the longest edge at 2048 px, and keep the smaller result. GIF is byte-preserving after Sharp verifies it.
- Draft access is uploader-only. Committed reads reuse request visibility, solution→request visibility, or active-template/admin authorization.
- Reference writes must be in the same Prisma transaction as the request, solution, or template description write.
- No production migration is run locally. Create and validate the migration file only.
- Notification emails render image alt placeholders, not private binary data. Completed PDFs embed only owner-referenced bytes after server-side resolution.
- Existing `file_attachments`, legacy formatted descriptions, rich text without images, workflow transitions, and attachment retry behavior must remain unchanged.
- Use TDD. After every implementation task, run the focused tests and then `npm run check` through Portly.
- Never start a development server directly. Start with `portly status`; use a healthy managed server or create one through Portly for browser verification.
- Keep the existing untracked `presentation-output/` directory untouched.
- Commit once per task with the exact message shown.

## File Structure

### New server/domain files

- `src/lib/inline-images/policy.ts` — canonical URL/UUID parsing, limits, HTML extraction, and public types.
- `src/lib/inline-images/storage.ts` — inline-image private paths and storage wrappers.
- `src/lib/inline-images/processing.ts` — byte verification, optimization, dimensions, and MIME validation.
- `src/lib/inline-images/lifecycle.ts` — draft creation/deletion, authorization, expiry, and retry-safe cleanup.
- `src/lib/inline-images/references.ts` — prepare/sanitize/authorize descriptions and transactionally reconcile owner references.
- `src/lib/inline-images/pdf.ts` — owner-scoped private-byte resolution for trusted PDF HTML.
- `src/app/api/inline-images/route.ts` — authenticated multipart draft upload.
- `src/app/api/inline-images/[id]/route.ts` — authenticated private GET and owner/session draft DELETE.

### New client/editor files

- `src/lib/inline-images/client.ts` — XHR upload transport with progress and DELETE transport.
- `src/hooks/use-inline-description-images.ts` — upload queue/session lifecycle and submission-blocking state.
- `src/components/rich-text/inline-image-extension.ts` — TipTap node schema, parsing/rendering, and FileHandler integration.
- `src/components/rich-text/inline-image-node-view.tsx` — placeholder, retry/remove, alt text, and alignment controls.

### Existing boundaries changed

- `prisma/schema.prisma` plus one migration — assets and owner references.
- `src/lib/rich-text-sanitizer.ts`, `src/lib/schemas/solution-schemas.ts` — approved `<img>` and image-as-content validation.
- `src/server-actions/{requests,solutions,templates}.ts` — session-aware transactional reference reconciliation.
- Shared editor plus every current editor call site — coordinator wiring.
- `src/lib/formatted-text.ts`, `src/components/ui/formatted-text.tsx`, `src/server-actions/notifications.ts`, `src/lib/pdf.ts`, `src/server-actions/reports.ts` — UI/email/PDF behavior.
- Storage dashboard and retention hard-delete — accounting and final-reference cleanup.

---

### Task 1: Prisma asset and reference schema

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260828000000_add_inline_description_images/migration.sql`
- Create: `tests/regression/inline-image-schema.test.ts`

**Interfaces:**
- Consumes: existing `User`, `requests`, `solutions`, and `templates` models.
- Produces: Prisma models `inline_description_images` and `inline_description_image_references`, including retry marker `deletionPendingAt`.

- [ ] **Step 1: Write the failing schema test**

```ts
// tests/regression/inline-image-schema.test.ts
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const schema = readFileSync('prisma/schema.prisma', 'utf8')
const migration = () => readFileSync(
  'prisma/migrations/20260828000000_add_inline_description_images/migration.sql',
  'utf8',
)

describe('inline description image schema', () => {
  it('stores owner/session metadata and retry-safe deletion state', () => {
    assert.match(schema, /model inline_description_images/)
    for (const field of ['uploadedById', 'uploadSessionId', 'originalSize', 'fileSize', 'filePath', 'width', 'height', 'deletionPendingAt']) {
      assert.match(schema, new RegExp(`\\b${field}\\b`))
    }
  })

  it('supports exactly one request, solution, or template owner', () => {
    assert.match(schema, /model inline_description_image_references/)
    assert.match(migration(), /num_nonnulls\("requestId", "solutionId", "templateId"\) = 1/)
    assert.match(migration(), /ON DELETE CASCADE/g)
  })
})
```

- [ ] **Step 2: Run the test and verify RED**

```bash
job_id="$(portly temp 'npx tsx --test tests/regression/inline-image-schema.test.ts' --path . --timeout 30m)"
portly wait "$job_id"
```

Expected: FAIL because the models/migration do not exist.

- [ ] **Step 3: Add the Prisma models and relations**

Add these models, then add inverse relation arrays to `User`, `requests`, `solutions`, and `templates`:

```prisma
model inline_description_images {
  id                String   @id @default(uuid())
  uploadedById      String
  uploadSessionId   String
  fileName          String
  fileType          String
  originalSize      Int
  fileSize          Int
  filePath          String
  width             Int
  height            Int
  deletionPendingAt DateTime?
  createdAt         DateTime @default(now())
  uploadedBy        User     @relation(fields: [uploadedById], references: [id])
  references        inline_description_image_references[]

  @@index([uploadedById])
  @@index([uploadSessionId])
  @@index([createdAt])
  @@index([deletionPendingAt])
}

model inline_description_image_references {
  id         String   @id @default(uuid())
  imageId    String
  requestId  String?
  solutionId String?
  templateId String?
  createdAt  DateTime @default(now())
  image      inline_description_images @relation(fields: [imageId], references: [id], onDelete: Cascade)
  request    requests?  @relation(fields: [requestId], references: [id], onDelete: Cascade)
  solution   solutions? @relation(fields: [solutionId], references: [id], onDelete: Cascade)
  template   templates? @relation(fields: [templateId], references: [id], onDelete: Cascade)

  @@unique([imageId, requestId])
  @@unique([imageId, solutionId])
  @@unique([imageId, templateId])
  @@index([imageId])
  @@index([requestId])
  @@index([solutionId])
  @@index([templateId])
}
```

Use relation names only if Prisma reports ambiguity. The inverse fields are arrays and do not alter existing owner columns.

- [ ] **Step 4: Write the migration SQL**

Use this complete migration; Prisma generates UUID strings client-side, matching existing models:

```sql
BEGIN;

CREATE TABLE "inline_description_images" (
  "id" TEXT NOT NULL,
  "uploadedById" TEXT NOT NULL,
  "uploadSessionId" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "fileType" TEXT NOT NULL,
  "originalSize" INTEGER NOT NULL,
  "fileSize" INTEGER NOT NULL,
  "filePath" TEXT NOT NULL,
  "width" INTEGER NOT NULL,
  "height" INTEGER NOT NULL,
  "deletionPendingAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inline_description_images_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "inline_description_image_references" (
  "id" TEXT NOT NULL,
  "imageId" TEXT NOT NULL,
  "requestId" TEXT,
  "solutionId" TEXT,
  "templateId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inline_description_image_references_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inline_image_reference_exactly_one_owner"
    CHECK (num_nonnulls("requestId", "solutionId", "templateId") = 1)
);

CREATE INDEX "inline_description_images_uploadedById_idx" ON "inline_description_images"("uploadedById");
CREATE INDEX "inline_description_images_uploadSessionId_idx" ON "inline_description_images"("uploadSessionId");
CREATE INDEX "inline_description_images_createdAt_idx" ON "inline_description_images"("createdAt");
CREATE INDEX "inline_description_images_deletionPendingAt_idx" ON "inline_description_images"("deletionPendingAt");
CREATE INDEX "inline_description_image_references_imageId_idx" ON "inline_description_image_references"("imageId");
CREATE INDEX "inline_description_image_references_requestId_idx" ON "inline_description_image_references"("requestId");
CREATE INDEX "inline_description_image_references_solutionId_idx" ON "inline_description_image_references"("solutionId");
CREATE INDEX "inline_description_image_references_templateId_idx" ON "inline_description_image_references"("templateId");
CREATE UNIQUE INDEX "inline_description_image_references_imageId_requestId_key" ON "inline_description_image_references"("imageId", "requestId");
CREATE UNIQUE INDEX "inline_description_image_references_imageId_solutionId_key" ON "inline_description_image_references"("imageId", "solutionId");
CREATE UNIQUE INDEX "inline_description_image_references_imageId_templateId_key" ON "inline_description_image_references"("imageId", "templateId");

ALTER TABLE "inline_description_images"
  ADD CONSTRAINT "inline_description_images_uploadedById_fkey"
  FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inline_description_image_references"
  ADD CONSTRAINT "inline_description_image_references_imageId_fkey"
  FOREIGN KEY ("imageId") REFERENCES "inline_description_images"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inline_description_image_references"
  ADD CONSTRAINT "inline_description_image_references_requestId_fkey"
  FOREIGN KEY ("requestId") REFERENCES "requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inline_description_image_references"
  ADD CONSTRAINT "inline_description_image_references_solutionId_fkey"
  FOREIGN KEY ("solutionId") REFERENCES "solutions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inline_description_image_references"
  ADD CONSTRAINT "inline_description_image_references_templateId_fkey"
  FOREIGN KEY ("templateId") REFERENCES "templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
```

- [ ] **Step 5: Validate schema without applying the migration**

```bash
job_id="$(portly temp 'npx prisma validate && npx prisma generate' --path . --timeout 30m)"
portly wait "$job_id"
job_id="$(portly temp 'npx tsx --test tests/regression/inline-image-schema.test.ts' --path . --timeout 30m)"
portly wait "$job_id"
job_id="$(portly temp 'npm run check' --path . --timeout 30m)"
portly wait "$job_id"
```

Expected: Prisma validation and all tests PASS. Do not run `prisma migrate dev` or `prisma migrate deploy`.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260828000000_add_inline_description_images/migration.sql tests/regression/inline-image-schema.test.ts
git commit -m 'feat: add inline description image schema'
```

---

### Task 2: Canonical image policy and sanitizer

**Files:**
- Create: `src/lib/inline-images/policy.ts`
- Modify: `src/lib/rich-text-sanitizer.ts`
- Modify: `src/lib/schemas/solution-schemas.ts`
- Modify: `tests/regression/rich-text-sanitizer.test.ts`
- Modify: `tests/regression/rich-description-validation.test.ts`
- Create: `tests/regression/inline-image-policy.test.ts`

**Interfaces:**
- Produces:
  - `MAX_INLINE_IMAGES = 10`, `MAX_INLINE_DESCRIPTION_BYTES = 100 * 1024 * 1024`, `MAX_INLINE_ALT_LENGTH = 300`, `MAX_CONCURRENT_INLINE_UPLOADS = 3`.
  - `InlineImageUpload = { id: string; src: string; alt: string; fileType: string; fileSize: number; width: number; height: number }` (client-safe shared response type).
  - `canonicalInlineImageSrc(id: string): string`.
  - `parseInlineImageSrc(src: string): string | null`.
  - `extractInlineImageIds(html: string): string[]`.
  - `inlineImageAltPlaceholder(html: string): string` for email/plain text.

- [ ] **Step 1: Write failing behavioral tests**

```ts
// tests/regression/inline-image-policy.test.ts
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  canonicalInlineImageSrc,
  extractInlineImageIds,
  parseInlineImageSrc,
} from '@/lib/inline-images/policy'

const ID = '123e4567-e89b-42d3-a456-426614174000'

describe('inline image canonical URLs', () => {
  it('round-trips canonical internal URLs and rejects every other source', () => {
    assert.equal(canonicalInlineImageSrc(ID), `/api/inline-images/${ID}`)
    assert.equal(parseInlineImageSrc(`/api/inline-images/${ID}`), ID)
    for (const src of [`https://x/${ID}`, `//x/${ID}`, `data:image/png,x`, `blob:x`, `/api/inline-images/${ID}/x`, `/api/inline-images/../x`]) {
      assert.equal(parseInlineImageSrc(src), null)
    }
  })

  it('extracts unique IDs in document order', () => {
    const html = `<p><img src="/api/inline-images/${ID}"><img src="/api/inline-images/${ID}"></p>`
    assert.deepEqual(extractInlineImageIds(html), [ID])
  })
})
```

Append sanitizer assertions using `<img src="/api/inline-images/123e4567-e89b-42d3-a456-426614174000" alt="Plan" data-align="center">`: it survives, while external/data/blob/SVG-like sources, `onerror`, `style`, `class`, `id`, and `srcset` do not. Append description-schema assertions that this valid image is non-empty and `<img src="data:image/png,x">` alone is empty.

- [ ] **Step 2: Run tests and verify RED**

```bash
job_id="$(portly temp 'npx tsx --test tests/regression/inline-image-policy.test.ts tests/regression/rich-text-sanitizer.test.ts tests/regression/rich-description-validation.test.ts' --path . --timeout 30m)"
portly wait "$job_id"
```

Expected: FAIL because policy and approved image handling are absent.

- [ ] **Step 3: Implement the canonical policy**

```ts
// src/lib/inline-images/policy.ts
import sanitizeHtml from 'sanitize-html'

export const MAX_INLINE_IMAGES = 10
export const MAX_INLINE_DESCRIPTION_BYTES = 100 * 1024 * 1024
export const MAX_INLINE_ALT_LENGTH = 300
export const MAX_CONCURRENT_INLINE_UPLOADS = 3
export const INLINE_IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
export type InlineImageUpload = {
  id: string
  src: string
  alt: string
  fileType: string
  fileSize: number
  width: number
  height: number
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
const SRC_RE = new RegExp(`^/api/inline-images/(${UUID})$`, 'i')

export function parseInlineImageSrc(src: string): string | null {
  return SRC_RE.exec(src)?.[1].toLowerCase() ?? null
}

export function canonicalInlineImageSrc(id: string): string {
  const parsed = parseInlineImageSrc(`/api/inline-images/${id}`)
  if (!parsed) throw new Error('Invalid inline image id')
  return `/api/inline-images/${parsed}`
}

export function extractInlineImageIds(html: string): string[] {
  const ids: string[] = []
  sanitizeHtml(html, {
    allowedTags: ['img'],
    allowedAttributes: { img: ['src'] },
    transformTags: { img: (_tag, attrs) => {
      const id = parseInlineImageSrc(attrs.src ?? '')
      if (id && !ids.includes(id)) ids.push(id)
      return { tagName: 'img', attribs: {} }
    } },
  })
  return ids
}

export function inlineImageAltPlaceholder(html: string): string {
  return html.replace(/<img\b[^>]*\balt=(?:"([^"]*)"|'([^']*)')[^>]*>/gi, (_m, a, b) => {
    const alt = String(a ?? b ?? '').trim()
    return alt ? `[Image: ${alt}]` : '[Image]'
  }).replace(/<img\b[^>]*>/gi, '[Image]')
}
```

- [ ] **Step 4: Extend sanitizer and visible-content validation**

Add `img` to `RICH_TEXT_ALLOWED_TAGS`; allow only `src`, `alt`, `data-align`; transform valid sources to canonical lowercase UUIDs; cap alt to 300; normalize invalid alignment to `center`; transform invalid-source images to a disallowed empty `span` so they disappear. Keep link rules unchanged.

```ts
img: (_tagName, attribs) => {
  const id = parseInlineImageSrc(attribs.src ?? '')
  if (!id) return { tagName: 'span', attribs: {} }
  const align = ['left', 'center', 'right'].includes(attribs['data-align'])
    ? attribs['data-align']
    : 'center'
  return {
    tagName: 'img',
    attribs: {
      src: canonicalInlineImageSrc(id),
      alt: (attribs.alt ?? '').slice(0, MAX_INLINE_ALT_LENGTH),
      'data-align': align,
    },
  }
}
```

Update `visibleNonEmpty` to accept sanitized descriptions containing at least one extracted image ID even when text is empty:

```ts
const sanitized = containsRichTextHtml(value) ? sanitizeRichText(value) : value
return richTextToPlainText(sanitized).trim().length > 0 || extractInlineImageIds(sanitized).length > 0
```

- [ ] **Step 5: Verify GREEN and commit**

```bash
job_id="$(portly temp 'npx tsx --test tests/regression/inline-image-policy.test.ts tests/regression/rich-text-sanitizer.test.ts tests/regression/rich-description-validation.test.ts' --path . --timeout 30m)"
portly wait "$job_id"
job_id="$(portly temp 'npm run check' --path . --timeout 30m)"
portly wait "$job_id"
git add src/lib/inline-images/policy.ts src/lib/rich-text-sanitizer.ts src/lib/schemas/solution-schemas.ts tests/regression/inline-image-policy.test.ts tests/regression/rich-text-sanitizer.test.ts tests/regression/rich-description-validation.test.ts
git commit -m 'feat: whitelist canonical inline image markup'
```

---

### Task 3: Image processing, private storage, lifecycle, and API routes

**Files:**
- Create: `src/lib/inline-images/processing.ts`
- Create: `src/lib/inline-images/storage.ts`
- Create: `src/lib/inline-images/lifecycle.ts`
- Create: `src/app/api/inline-images/route.ts`
- Create: `src/app/api/inline-images/[id]/route.ts`
- Create: `tests/regression/inline-image-lifecycle.test.ts`
- Create: `tests/regression/inline-image-routes.test.ts`

**Interfaces:**
- `prepareInlineImage({ bytes, fileName, mimeType }): Promise<{ bytes; originalSize; storedSize; fileType; width; height }>`.
- `createInlineImageDraft({ userId, uploadSessionId, file }): Promise<InlineImageUpload>` from Task 2.
- `deleteInlineImageDraft({ userId, uploadSessionId, imageId }): Promise<void>`.
- `cleanupUnreferencedInlineImages({ olderThan, limit? }): Promise<{ deleted; warnings }>`.
- `canReadInlineImage(userId, imageId): Promise<boolean>`.

- [ ] **Step 1: Write failing processing/lifecycle tests**

Use Sharp-generated JPEG/PNG/WebP/GIF buffers. Assert declared MIME must match decoded format, SVG/corrupt bytes fail, optimized dimensions are returned, draft delete requires matching uploader/session/no references, and a physical-delete failure keeps `deletionPendingAt` for retry. Build lifecycle tests with an injected fake dependency object rather than a live database.

Define deletion with the narrow injectable contract below so tests need no live database:

```ts
export type DeleteInlineImageDeps = {
  markDeletionPending(input: {
    imageId: string
    userId: string
    uploadSessionId: string
  }): Promise<{ filePath: string } | null>
  deleteFile(filePath: string): Promise<void>
  deleteRow(imageId: string): Promise<boolean>
}

const deps: DeleteInlineImageDeps = {
  markDeletionPending: async () => {
    draft.deletionPendingAt = new Date()
    return { filePath: draft.filePath }
  },
  deleteRow: async () => true,
  deleteFile: async () => { throw new Error('disk') },
}
await assert.rejects(() => deleteInlineImageDraft(input, deps), /could not be deleted/i)
assert.equal(draft.deletionPendingAt instanceof Date, true)
```

Use similarly narrow `CreateInlineImageDeps`, `CleanupInlineImageDeps`, and `ReadInlineImageDeps` contracts containing only the Prisma/storage operations called by their function; each production default is declared in `lifecycle.ts`, while tests pass complete fakes.

Add route source-contract tests asserting authentication, `request.formData()`, UUID validation, `X-Content-Type-Options: nosniff`, private cache headers, and no client-supplied filesystem path.

- [ ] **Step 2: Run tests and verify RED**

```bash
job_id="$(portly temp 'npx tsx --test tests/regression/inline-image-lifecycle.test.ts tests/regression/inline-image-routes.test.ts' --path . --timeout 30m)"
portly wait "$job_id"
```

- [ ] **Step 3: Implement byte preparation and storage wrappers**

`processing.ts` must call Sharp metadata before and after `optimizeImageAttachment`, match decoded `jpeg/png/webp/gif` to the declared MIME, and return dimensions from prepared bytes. For GIF, verification runs but the original bytes remain.

```ts
const EXPECTED = new Map([
  ['image/jpeg', 'jpeg'], ['image/png', 'png'], ['image/webp', 'webp'], ['image/gif', 'gif'],
])
const decoded = await sharp(input.bytes, { animated: true }).metadata()
if (EXPECTED.get(input.mimeType) !== decoded.format) throw new Error('Unable to process image')
const optimized = await optimizeImageAttachment(input)
const finalMeta = await sharp(optimized.bytes, { animated: true }).metadata()
if (!finalMeta.width || !finalMeta.height) throw new Error('Unable to process image')
```

`storage.ts` must keep all paths under the existing private upload root:

```ts
export function createStoredInlineImagePath(userId: string, fileName: string, id: string): string {
  return `inline-images/${userId}/${id}-${sanitizeAttachmentFileName(fileName)}`
}
export const writeInlineImageFile = writeAttachmentFile
export const readInlineImageFile = readAttachmentFile
export const deleteInlineImageFile = deleteAttachmentFile
```

- [ ] **Step 4: Implement lifecycle with injectable adapters**

Production adapters use Prisma and the storage wrappers. Upload enforces active user, session UUID, image metadata, no more than 10 live drafts and 100 MB cumulative original bytes, opportunistically cleans at most five expired rows, writes file before row, and compensates on row failure.

Retry-safe deletion uses this order:

```ts
const marked = await deps.markDeletionPending({ imageId, userId, uploadSessionId })
if (!marked) throw new Error('Image is committed, missing, or belongs to another session')
try {
  await deps.deleteFile(marked.filePath) // ENOENT counts as success
  await deps.deleteRow(imageId)          // requires deletionPendingAt != null and zero refs
} catch (error) {
  throw new Error('Image could not be deleted; cleanup will retry')
}
```

Read authorization: uploader-only for zero-reference drafts; otherwise allow any visible request/solution reference via `canUserViewRequest`, an active template reference for active users, or inactive template reference for admins.

- [ ] **Step 5: Implement route handlers**

`POST /api/inline-images` parses `file` and `uploadSessionId`, returns 201 JSON with `{ id, src, alt, fileType, fileSize, width, height }`, and maps validation/auth failures to 400/401/403/413 without returning internal paths.

`GET /api/inline-images/[id]` awaits Next 15 `params`, authorizes, reads bytes by DB path, and returns verified MIME/length plus:

```ts
headers: {
  'Content-Type': row.fileType,
  'Content-Length': String(bytes.length),
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': row.references.length > 0
    ? 'private, max-age=86400, immutable'
    : 'private, no-store',
}
```

`DELETE` validates `{ uploadSessionId }` JSON and invokes owner/session-scoped draft deletion.

- [ ] **Step 6: Verify and commit**

```bash
job_id="$(portly temp 'npx tsx --test tests/regression/inline-image-lifecycle.test.ts tests/regression/inline-image-routes.test.ts tests/regression/image-optimization.test.ts tests/regression/attachment-storage.test.ts' --path . --timeout 30m)"
portly wait "$job_id"
job_id="$(portly temp 'npm run check' --path . --timeout 30m)"
portly wait "$job_id"
git add src/lib/inline-images/processing.ts src/lib/inline-images/storage.ts src/lib/inline-images/lifecycle.ts src/app/api/inline-images/route.ts 'src/app/api/inline-images/[id]/route.ts' tests/regression/inline-image-lifecycle.test.ts tests/regression/inline-image-routes.test.ts
git commit -m 'feat: add private inline image lifecycle and routes'
```

---

### Task 4: Transactional reference preparation and owner save actions

**Files:**
- Create: `src/lib/inline-images/references.ts`
- Modify: `src/server-actions/requests.ts`
- Modify: `src/server-actions/solutions.ts`
- Modify: `src/server-actions/templates.ts`
- Modify: `src/lib/schemas/solution-schemas.ts`
- Create: `tests/regression/inline-image-references.test.ts`
- Create: `tests/regression/inline-image-action-wiring.test.ts`

**Interfaces:**
- `PreparedInlineDescription = { html: string; imageIds: string[]; uploadSessionId: string }`.
- `prepareInlineDescription({ description, userId, uploadSessionId }): Promise<PreparedInlineDescription>`.
- `reconcileInlineDescriptionImages(tx, { owner, imageIds }): Promise<void>`, where owner is `{ kind: 'request'|'solution'|'template'; id: string }`.
- Add `inlineImageSessionId` to create/update inputs; request resubmit permits it only when `description` is supplied.

- [ ] **Step 1: Write failing reference tests**

Using a fake asset loader/transaction, cover: sanitize before extraction; reject missing IDs, another user's draft, wrong session, deletion-pending asset, unauthorized committed asset, >10 IDs, and >100 MB; allow current draft and authorized committed template reuse; create missing references; delete only references for the current owner; leave other owners intact.

```ts
const prepared = await prepareInlineDescription({
  description: `<p>x<img src="/api/inline-images/${ID}"></p>`,
  userId: USER,
  uploadSessionId: SESSION,
}, deps)
assert.deepEqual(prepared.imageIds, [ID])
assert.equal(prepared.html.includes('/api/inline-images/'), true)
```

The wiring test reads the three server-action files and asserts every description write calls `reconcileInlineDescriptionImages` inside its transaction.

- [ ] **Step 2: Run tests and verify RED**

```bash
job_id="$(portly temp 'npx tsx --test tests/regression/inline-image-references.test.ts tests/regression/inline-image-action-wiring.test.ts' --path . --timeout 30m)"
portly wait "$job_id"
```

- [ ] **Step 3: Implement preparation and reconciliation**

Preparation sanitizes once, extracts IDs, checks limits, and authorizes each row. A zero-reference row must match `uploadedById` and `uploadSessionId`; a committed row must pass `canReadInlineImage`. Return canonical sanitized HTML.

Reconciliation runs against the supplied `Prisma.TransactionClient`:

```ts
export type InlineImageOwner =
  | { kind: 'request'; id: string }
  | { kind: 'solution'; id: string }
  | { kind: 'template'; id: string }

export async function reconcileInlineDescriptionImages(
  tx: Prisma.TransactionClient,
  input: { owner: InlineImageOwner; imageIds: string[] },
): Promise<void> {
  const ownerWhere = input.owner.kind === 'request'
    ? { requestId: input.owner.id }
    : input.owner.kind === 'solution'
      ? { solutionId: input.owner.id }
      : { templateId: input.owner.id }
  await tx.inline_description_image_references.deleteMany({
    where: input.imageIds.length > 0
      ? { ...ownerWhere, imageId: { notIn: input.imageIds } }
      : ownerWhere,
  })
  if (input.imageIds.length > 0) {
    await tx.inline_description_image_references.createMany({
      data: input.imageIds.map((imageId) => ({ imageId, ...ownerWhere })),
      skipDuplicates: true,
    })
  }
}
```

Before writes, re-read all IDs inside the transaction and require `deletionPendingAt: null`; exact-count mismatch aborts.

- [ ] **Step 4: Integrate request and template transactions**

Add `inlineImageSessionId` and prepare before each transaction. Persist `prepared.html`, then reconcile inside the same callback:

```ts
const prepared = await prepareInlineDescription({
  description: validatedFields.data.description,
  userId: user.id,
  uploadSessionId: validatedFields.data.inlineImageSessionId,
})
const request = await prisma.$transaction(async (tx) => {
  const newRequest = await tx.requests.create({
    data: {
      title: validatedFields.data.title,
      description: prepared.html,
      requesterId: user.id,
      departmentId: user.departmentId,
      status: 'ImprovementRequest',
    },
  })
  await reconcileInlineDescriptionImages(tx, {
    owner: { kind: 'request', id: newRequest.id },
    imageIds: prepared.imageIds,
  })
  // existing activity write
  return newRequest
})
```

Apply the same pattern to `resubmitRequest` only when description is updated, and convert `updateTemplate` from a standalone update to an interactive transaction. `createTemplate` already has one.

- [ ] **Step 5: Integrate solution transactions and Zod inputs**

Add required `inlineImageSessionId: z.string().uuid()` to `submitSolutionSchema` and `resubmitSolutionSchema`. Prepare after authorization/validation and before the transaction. In `submitSolution`, reconcile immediately after creating the solution. In `resubmitSolution`, reconcile immediately after updating it. Do not move notifications or physical attachment deletion into transactions.

- [ ] **Step 6: Verify and commit**

```bash
job_id="$(portly temp 'npx tsx --test tests/regression/inline-image-references.test.ts tests/regression/inline-image-action-wiring.test.ts tests/regression/request-approval-transaction.test.ts tests/regression/solution-transaction-notifications.test.ts tests/regression/template-rich-description.test.ts' --path . --timeout 30m)"
portly wait "$job_id"
job_id="$(portly temp 'npm run check' --path . --timeout 30m)"
portly wait "$job_id"
git add src/lib/inline-images/references.ts src/server-actions/requests.ts src/server-actions/solutions.ts src/server-actions/templates.ts src/lib/schemas/solution-schemas.ts tests/regression/inline-image-references.test.ts tests/regression/inline-image-action-wiring.test.ts
git commit -m 'feat: reconcile inline images with description saves'
```

---

### Task 5: Client upload transport and form-scoped coordinator

**Files:**
- Create: `src/lib/inline-images/client.ts`
- Create: `src/hooks/use-inline-description-images.ts`
- Create: `tests/regression/inline-image-client.test.ts`

**Interfaces:**

```ts
import type { InlineImageUpload } from '@/lib/inline-images/policy'

export type InlineImageCoordinator = {
  uploadSessionId: string
  upload(uploadId: string, file: File, onProgress: (percent: number) => void): Promise<InlineImageUpload>
  remove(uploadId: string, imageId?: string): Promise<void>
  hasBlockingUploads: boolean
  reset(): Promise<void>
  clear(): void
}
```

- [ ] **Step 1: Write failing queue/state tests**

Test the exported reducer/queue helpers with fake transports: stable session UUID; maximum three active uploads; FIFO queued files; progress updates; failure remains blocking; retry can succeed; removing a successful local draft calls DELETE; `reset()` waits for all draft deletes before clearing; `clear()` performs no DELETE; unmount cleanup is best-effort.

- [ ] **Step 2: Run tests and verify RED**

```bash
job_id="$(portly temp 'npx tsx --test tests/regression/inline-image-client.test.ts' --path . --timeout 30m)"
portly wait "$job_id"
```

- [ ] **Step 3: Implement XHR transport**

Use XHR because Fetch does not expose browser upload progress:

```ts
export function uploadInlineImage(
  file: File,
  uploadSessionId: string,
  onProgress: (percent: number) => void,
): Promise<InlineImageUpload> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/inline-images')
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100))
    }
    xhr.onerror = () => reject(new Error('Image upload failed'))
    xhr.onload = () => {
      const body = JSON.parse(xhr.responseText || '{}')
      xhr.status >= 200 && xhr.status < 300
        ? resolve(body)
        : reject(new Error(body.error || 'Image upload failed'))
    }
    const data = new FormData()
    data.append('file', file)
    data.append('uploadSessionId', uploadSessionId)
    xhr.send(data)
  })
}
```

DELETE sends `{ uploadSessionId }` and treats 404 as already cleaned, but surfaces 403/409/500.

- [ ] **Step 4: Implement the hook**

Keep session ID plus `{ uploadId, status, imageId? }` records in refs to avoid stale closures. Queue transport promises with three workers. `hasBlockingUploads` is true while queued/uploading/failed records exist. `remove(uploadId)` clears a failed local record without network I/O; `remove(uploadId, imageId)` deletes a successful draft before clearing it. `reset()` snapshots staged image IDs, deletes with `Promise.allSettled`, throws if any real failure occurred, then clears state. `clear()` synchronously empties refs/state without network calls. The unmount effect snapshots and fires best-effort deletes.

- [ ] **Step 5: Verify and commit**

```bash
job_id="$(portly temp 'npx tsx --test tests/regression/inline-image-client.test.ts' --path . --timeout 30m)"
portly wait "$job_id"
job_id="$(portly temp 'npm run check' --path . --timeout 30m)"
portly wait "$job_id"
git add src/lib/inline-images/client.ts src/hooks/use-inline-description-images.ts tests/regression/inline-image-client.test.ts
git commit -m 'feat: coordinate inline image draft uploads'
```

---

### Task 6: TipTap image node, NodeView, toolbar, paste, and drop

**Files:**
- Modify: `package.json`, `package-lock.json`
- Create: `src/components/rich-text/inline-image-extension.ts`
- Create: `src/components/rich-text/inline-image-node-view.tsx`
- Modify: `src/components/rich-text/rich-text-editor.tsx`
- Modify: `src/components/rich-text/rich-text-editor-lazy.tsx`
- Create: `tests/regression/inline-image-editor.test.ts`

**Interfaces:**
- Consumes: `InlineImageCoordinator` from Task 5.
- Extends `RichTextEditorProps` with `inlineImages?: InlineImageCoordinator`.
- Stable node attributes: internal `src`, `alt`, `align`; `align` renders only as HTML `data-align`. Transient non-rendered attributes: `uploadId`, `status`, `progress`, `error`.

- [ ] **Step 1: Install TipTap extensions**

```bash
npm install @tiptap/extension-image@^3.30.1 @tiptap/extension-file-handler@^3.30.1
```

- [ ] **Step 2: Write failing editor contract tests**

Assert the extension uses `ReactNodeViewRenderer`, parses only canonical internal `<img>`, renders transient nodes as a sanitizer-discarded empty span, registers `FileHandler` paste/drop MIME restrictions, includes an accessible Image toolbar button/file input, supports retry/remove, alt length 300, three alignment choices, and never emits `blob:` or transient upload attributes through `onChange`.

- [ ] **Step 3: Run tests and verify RED**

```bash
job_id="$(portly temp 'npx tsx --test tests/regression/inline-image-editor.test.ts tests/regression/rich-text-editor.test.ts' --path . --timeout 30m)"
portly wait "$job_id"
```

- [ ] **Step 4: Implement custom image extension and NodeView**

Build on TipTap Image but override attributes/rendering and add `ReactNodeViewRenderer(InlineImageNodeView)`. Stable output is:

```ts
return node.attrs.src
  ? ['img', { src: node.attrs.src, alt: node.attrs.alt, 'data-align': node.attrs.align }]
  : ['span', { 'data-inline-upload-placeholder': 'true' }]
```

The empty transient span is stripped by `sanitizeRichText`; because the editor's `lastEmitted` guard records that sanitized parent value, controlled-value synchronization does not remove the local NodeView.

The NodeView shows progress, error text, Retry and Remove; when selected and stable, it shows a labeled alt input and Left/Center/Right buttons. Alt updates are sliced to 300. Remove calls `coordinator.removeDraft(id)` only when the image ID exists in the coordinator's local staged set; committed nodes are removed locally and reconciled on owner save.

- [ ] **Step 5: Implement one insertion pipeline**

Keep `Map<uploadId, File>` and insertion positions in editor refs. Toolbar picker, FileHandler `onPaste`, and `onDrop` all call:

```ts
function insertFiles(files: File[], position?: number) {
  for (const file of files.filter((item) => INLINE_IMAGE_MIMES.has(item.type))) {
    const uploadId = crypto.randomUUID()
    fileByUploadId.current.set(uploadId, file)
    editor?.chain().focus().insertContentAt(position ?? editor.state.selection.from, {
      type: 'inlineImage',
      attrs: { uploadId, status: 'uploading', progress: 0, alt: filenameAlt(file.name), align: 'center' },
    }).run()
    void runUpload(uploadId, file)
  }
}
```

On success, update the same node to stable `{ src, alt, align }` while retaining client-only `uploadId`; on failure set `status: 'error'` and retain the File for retry. Node removal calls `coordinator.remove(uploadId, imageId)` for a successful local draft or `coordinator.remove(uploadId)` for a failure. Disable insertion while the editor/coordinator is disabled. Set `immediatelyRender: false` unconditionally to avoid TipTap/Next hydration mismatches.

- [ ] **Step 6: Preserve lazy fallback safely**

The `FormattedTextarea` fallback receives the original HTML unchanged. It exposes no upload controls and must not strip existing `<img>` markup on mount. Pass `inlineImages` only to the dynamic editor implementation.

- [ ] **Step 7: Verify and commit**

```bash
job_id="$(portly temp 'npx tsx --test tests/regression/inline-image-editor.test.ts tests/regression/rich-text-editor.test.ts tests/regression/rich-text-sanitizer.test.ts' --path . --timeout 30m)"
portly wait "$job_id"
job_id="$(portly temp 'npm run check' --path . --timeout 30m)"
portly wait "$job_id"
git add package.json package-lock.json src/components/rich-text/inline-image-extension.ts src/components/rich-text/inline-image-node-view.tsx src/components/rich-text/rich-text-editor.tsx src/components/rich-text/rich-text-editor-lazy.tsx tests/regression/inline-image-editor.test.ts
git commit -m 'feat: add inline image controls to rich text editor'
```

---

### Task 7: Wire every form and submission lifecycle

**Files:**
- Modify: `src/components/requests/request-form.tsx`
- Modify: `src/components/solutions/solution-form.tsx`
- Modify: `src/components/admin/template-form.tsx`
- Modify: `src/components/requests/resubmit-request-dialog.tsx`
- Modify: `src/components/requests/request-resubmit-modal.tsx`
- Modify: `src/components/requests/submitter-modal.tsx`
- Modify: `src/components/requests/request-modal-router.tsx`
- Modify: `src/components/requests/requests-list-client.tsx`
- Modify: `src/components/dashboard/follow-up-dashboard.tsx`
- Modify: `src/app/sequential-stages-preview/page.tsx`
- Modify: `tests/regression/formatted-description-editors.test.ts`
- Create: `tests/regression/inline-image-form-wiring.test.ts`

**Interfaces:**
- Every form creates one `useInlineDescriptionImages()` coordinator and passes it to its editor.
- Every save payload includes `inlineImageSessionId`.
- Callback-based modal contracts return `Promise<{ success: boolean; error?: string }>` so drafts clear only after confirmed success.

- [ ] **Step 1: Write failing wiring tests**

Read every listed editor file and assert `useInlineDescriptionImages`, `inlineImages={inlineImages}`, `inlineImageSessionId`, `hasBlockingUploads` submission disablement, awaited `reset()` on cancel, and `clear()` only in success branches. Assert request template selection still copies description HTML and passes `templateId` through callback data.

- [ ] **Step 2: Run tests and verify RED**

```bash
job_id="$(portly temp 'npx tsx --test tests/regression/inline-image-form-wiring.test.ts tests/regression/formatted-description-editors.test.ts' --path . --timeout 30m)"
portly wait "$job_id"
```

- [ ] **Step 3: Wire direct-action forms**

For `RequestForm`, `SolutionForm`, `TemplateForm`, and `ResubmitRequestDialog`:

```tsx
const inlineImages = useInlineDescriptionImages()
<RichTextEditor
  value={field.value ?? ''}
  onChange={field.onChange}
  minHeight={160}
  inlineImages={inlineImages}
/>
<Button type="submit" disabled={isSubmitting || inlineImages.hasBlockingUploads}>
  {isSubmitting ? 'Saving...' : 'Save'}
</Button>
```

Pass `inlineImageSessionId: inlineImages.uploadSessionId` to the action. After action success call `inlineImages.clear()` before navigation/reset. On server failure do not clear. Cancel/open-close handlers await `inlineImages.reset()`; show a toast/error and keep the form open when cleanup fails.

`SolutionForm` keeps the same coordinator across preview/edit transitions. Final Confirm includes the same session. Existing `useSolutionAttachments` remains independent.

- [ ] **Step 4: Standardize callback modal results**

Update `SubmitterModalProps.onSubmitRequest`, solution callbacks, and `RequestResubmitModalProps.onResubmit` to return a success result. Include `inlineImageSessionId` in callback data. Callers in `requests-list-client.tsx`, `follow-up-dashboard.tsx`, and `request-modal-router.tsx` return `{ success: true }` only after the server action succeeds; catch/error paths return `{ success: false, error }`.

In each modal:

```ts
const result = await onSubmitRequest({
  title,
  description,
  templateId: selectedTemplate || undefined,
  files,
  inlineImageSessionId: inlineImages.uploadSessionId,
})
if (!result.success) {
  setSubmitError(result.error || 'Failed to submit')
  return
}
inlineImages.clear()
onOpenChange(false)
```

Do not close synchronously before callback completion. Update the sequential preview callbacks to async success results so TypeScript remains green.

- [ ] **Step 5: Enforce cancel and blocking behavior**

All close buttons, dialog `onOpenChange(false)`, router-back buttons, and explicit Cancel controls route through one awaited cleanup function. Disable submit/confirm while `hasBlockingUploads` is true and display: `Wait for image uploads, or retry/remove failed images.`

- [ ] **Step 6: Verify and commit**

```bash
job_id="$(portly temp 'npx tsx --test tests/regression/inline-image-form-wiring.test.ts tests/regression/formatted-description-editors.test.ts tests/regression/request-modal-reset.test.ts tests/regression/solution-upload-actions.test.ts' --path . --timeout 30m)"
portly wait "$job_id"
job_id="$(portly temp 'npm run check' --path . --timeout 30m)"
portly wait "$job_id"
git add src/components/requests/request-form.tsx src/components/solutions/solution-form.tsx src/components/admin/template-form.tsx src/components/requests/resubmit-request-dialog.tsx src/components/requests/request-resubmit-modal.tsx src/components/requests/submitter-modal.tsx src/components/requests/request-modal-router.tsx src/components/requests/requests-list-client.tsx src/components/dashboard/follow-up-dashboard.tsx src/app/sequential-stages-preview/page.tsx tests/regression/formatted-description-editors.test.ts tests/regression/inline-image-form-wiring.test.ts
git commit -m 'feat: wire inline image sessions through description forms'
```

---

### Task 8: Application, email, and PDF rendering

**Files:**
- Modify: `src/app/globals.css`
- Modify: `src/components/ui/formatted-text.tsx`
- Modify: `src/lib/formatted-text.ts`
- Modify: `src/server-actions/notifications.ts`
- Create: `src/lib/inline-images/pdf.ts`
- Modify: `src/lib/pdf.ts`
- Modify: `src/server-actions/reports.ts`
- Modify: `tests/regression/formatted-text.test.ts`
- Modify: `tests/regression/rich-pdf-render.test.ts`
- Modify: `tests/regression/pdf-rendering.test.ts`
- Create: `tests/regression/inline-image-rendering.test.ts`

**Interfaces:**
- `renderDescriptionPlainText` and truncated email HTML replace approved images with alt placeholders.
- `resolveInlineImagesForPdf({ html, owner }): Promise<string>` returns sanitized trusted HTML with only owner-referenced internal sources replaced by data URIs.
- `renderRequestEvidenceHTML` becomes async and requires owner IDs in `RequestPDFData` (`id` for request; `solution.id` for solution).

- [ ] **Step 1: Write failing rendering tests**

Assert application sanitizer output includes internal images and CSS alignment; truncated/plain email output returns `[Image: alt]`; PDF resolver embeds only an ID referenced by the supplied owner, never an arbitrary canonical ID; missing bytes become escaped alt text; PDF image CSS is responsive and avoids page splitting.

- [ ] **Step 2: Run tests and verify RED**

```bash
job_id="$(portly temp 'npx tsx --test tests/regression/inline-image-rendering.test.ts tests/regression/rich-pdf-render.test.ts tests/regression/pdf-rendering.test.ts' --path . --timeout 30m)"
portly wait "$job_id"
```

- [ ] **Step 3: Add shared application CSS**

```css
.rich-text img { display: block; max-width: 100%; height: auto; margin-block: .75rem; }
.rich-text img[data-align='left'] { margin-right: auto; }
.rich-text img[data-align='center'] { margin-inline: auto; }
.rich-text img[data-align='right'] { margin-left: auto; }
```

Keep `FormattedText`'s sanitized `dangerouslySetInnerHTML` boundary unchanged except for the new sanitizer behavior.

- [ ] **Step 4: Add email alt placeholders**

Before `richTextToPlainText` or visible truncation, call `inlineImageAltPlaceholder(sanitizeRichText(source))`. For HTML email, escape the placeholder text and preserve existing safe formatting around it; do not attach bytes or emit private `<img src>` URLs. Plain-text email uses the same placeholder conversion.

- [ ] **Step 5: Implement owner-scoped PDF resolver**

Sanitize first, extract IDs, query references constrained to the supplied owner, read only matching private paths, and replace each matching `src` with `data:<verified MIME>;base64,<bytes>`. Invalid/missing/unreferenced IDs become escaped alt text. The function is server-only and never writes its data-URI output to the database.

```ts
export type PdfInlineImageOwner =
  | { kind: 'request'; id: string }
  | { kind: 'solution'; id: string }

export async function resolveInlineImagesForPdf(input: {
  html: string
  owner: PdfInlineImageOwner
}): Promise<string>
```

- [ ] **Step 6: Make PDF HTML rendering async**

Add `solution.id` to `RequestPDFData` and `buildRequestPDFData`. Resolve request and solution descriptions before interpolating them. Await `renderRequestEvidenceHTML` from `generateRequestPDF` and update direct tests/callers.

Add PDF CSS:

```css
.description img { display: block; max-width: 100%; height: auto; margin: 8px auto; break-inside: avoid; page-break-inside: avoid; }
.description img[data-align='left'] { margin-left: 0; margin-right: auto; }
.description img[data-align='right'] { margin-left: auto; margin-right: 0; }
```

- [ ] **Step 7: Verify and commit**

```bash
job_id="$(portly temp 'npx tsx --test tests/regression/inline-image-rendering.test.ts tests/regression/formatted-text.test.ts tests/regression/rich-pdf-render.test.ts tests/regression/pdf-rendering.test.ts tests/regression/email-notification-transport.test.ts' --path . --timeout 30m)"
portly wait "$job_id"
job_id="$(portly temp 'npm run check' --path . --timeout 30m)"
portly wait "$job_id"
git add src/app/globals.css src/components/ui/formatted-text.tsx src/lib/formatted-text.ts src/server-actions/notifications.ts src/lib/inline-images/pdf.ts src/lib/pdf.ts src/server-actions/reports.ts tests/regression/formatted-text.test.ts tests/regression/rich-pdf-render.test.ts tests/regression/pdf-rendering.test.ts tests/regression/inline-image-rendering.test.ts
git commit -m 'feat: render inline images across app and PDF outputs'
```

---

### Task 9: Storage accounting and retention cleanup

**Files:**
- Modify: `src/lib/storage-dashboard.ts`
- Modify: `src/server-actions/storage-dashboard.ts`
- Modify: `src/components/admin/storage-dashboard.tsx`
- Modify: `src/lib/retention-hard-delete.ts`
- Modify: `tests/regression/storage-dashboard.test.ts`
- Modify: `tests/regression/bulk-delete-retention.test.ts`
- Create: `tests/regression/inline-image-retention.test.ts`

**Interfaces:**
- Storage totals add `inlineImageBytes` and `inlineImageCount`; recorded bytes include attachments plus inline images exactly once.
- Hard delete invokes unreferenced inline-image cleanup after request/solution reference cascades commit.

- [ ] **Step 1: Write failing accounting and retention tests**

Add mixed attachment/inline rows and assert totals, trend input, largest-file owner label `inline`, and no double counting for shared references. For hard delete, use a fake cleanup callback to prove database deletion commits before cleanup; cleanup warnings are returned without making the request deletion fail.

- [ ] **Step 2: Run tests and verify RED**

```bash
job_id="$(portly temp 'npx tsx --test tests/regression/storage-dashboard.test.ts tests/regression/bulk-delete-retention.test.ts tests/regression/inline-image-retention.test.ts' --path . --timeout 30m)"
portly wait "$job_id"
```

- [ ] **Step 3: Aggregate assets once**

Load attachments and `inline_description_images` in parallel. Convert both to one storage-row union with `owner: 'request'|'solution'|'other'|'inline'`; inline rows use asset `fileSize` once regardless of reference count. Add dedicated inline metrics while preserving request/solution attachment metrics. Feed the combined rows into trend calculations.

- [ ] **Step 4: Add dashboard labels**

Add an Inline images metric/category and `OWNER_LABEL.inline = 'Inline image'`. Existing attachment labels and volume-strip math remain unchanged.

- [ ] **Step 5: Trigger post-cascade cleanup**

After `hardDeleteArchivedRequests` commits request deletion, call:

```ts
const cleanup = await cleanupUnreferencedInlineImages({ olderThan: new Date(), limit: 100 })
fileWarnings.push(...cleanup.warnings)
```

Do not run file I/O inside the request deletion transaction. Shared assets retain references and are skipped. The upload route's opportunistic 24-hour sweep from Task 3 remains the independent abandoned-draft maintenance path; hard delete handles newly unreferenced committed assets.

- [ ] **Step 6: Verify and commit**

```bash
job_id="$(portly temp 'npx tsx --test tests/regression/storage-dashboard.test.ts tests/regression/bulk-delete-retention.test.ts tests/regression/inline-image-retention.test.ts tests/regression/retention-policy.test.ts' --path . --timeout 30m)"
portly wait "$job_id"
job_id="$(portly temp 'npm run check' --path . --timeout 30m)"
portly wait "$job_id"
git add src/lib/storage-dashboard.ts src/server-actions/storage-dashboard.ts src/components/admin/storage-dashboard.tsx src/lib/retention-hard-delete.ts tests/regression/storage-dashboard.test.ts tests/regression/bulk-delete-retention.test.ts tests/regression/inline-image-retention.test.ts
git commit -m 'feat: account for and clean inline image storage'
```

---

### Task 10: Browser acceptance, full verification, and graph refresh

**Files:**
- Create: `tests/e2e/inline-description-images.spec.ts`
- No Playwright configuration change is planned; use the existing `playwright.config.ts`.

**Interfaces:**
- Produces an opt-in, non-vacuous browser release gate requiring a disposable authenticated test environment with the migration already applied by its environment owner.

- [ ] **Step 1: Write the Playwright gate**

Follow `tests/e2e/formatted-descriptions.spec.ts` environment validation. Require `TEST_BASE_URL`, requester credentials, and disposable request/solution IDs. Generate a small PNG buffer with a fixed name. Cover:

1. Toolbar file selection inserts an uploading placeholder, then a canonical `<img>`.
2. Paste and drop each invoke the same upload route and produce canonical nodes.
3. Alt text and center/right/left controls update sanitized attributes.
4. Submit stays disabled while a route is delayed and while a forced upload fails.
5. Retry succeeds; Remove clears a failed draft.
6. Save/reopen renders the private image for an authorized user.
7. An unauthenticated GET returns 401; a different unauthorized account returns 403.
8. A template image copied into a request renders after both template edit and request save.
9. Existing attachment upload still succeeds independently.

Use Playwright `setInputFiles`, `DataTransfer`, and `ClipboardEvent`; assert the actual DOM `src` matches `/api/inline-images/<UUID>` so the test cannot pass on a local blob preview.

- [ ] **Step 2: Run full static/regression verification**

```bash
job_id="$(portly temp 'npm run check' --path . --timeout 30m)"
portly wait "$job_id"
```

Expected: TypeScript, manage-tool tests, and all regression tests PASS.

- [ ] **Step 3: Run the browser gate through a Portly-managed server**

```bash
portly status
```

Reuse a healthy in-scope server. If none exists, verify port 3101 is free, then register the exact project/server below; never run `npm run dev` directly:

```bash
portly port 3101 --json
portly add-project --name ApprovalAppV3 --path "$(pwd)" --icon checkmark.seal --color '#1e6453' --json
portly add-server --project ApprovalAppV3 --name dev --command 'npm run dev' --port 3101 --start --json
portly status
portly logs ApprovalAppV3/dev --tail 100
```

If `ApprovalAppV3` already exists, omit `add-project`; if `ApprovalAppV3/dev` already exists, run `portly start ApprovalAppV3/dev` instead of `add-server`.

Then run the bounded test job with the required disposable environment variables:

```bash
job_id="$(portly temp 'npx playwright test tests/e2e/inline-description-images.spec.ts' --path . --timeout 30m)"
portly wait "$job_id"
```

Expected: PASS. If the disposable database has not had the migration applied by its owner, report the browser gate as blocked rather than applying a production migration locally.

- [ ] **Step 4: Refresh graph and verify repository state**

```bash
graphify update .
git status --short
git log --oneline -10
```

Expected: graph refresh succeeds; only expected graphify outputs or pre-existing `presentation-output/` remain unstaged; ten feature commits plus the approved spec/plan history are visible.

- [ ] **Step 5: Commit the browser gate**

```bash
git add tests/e2e/inline-description-images.spec.ts
git commit -m 'test: cover inline description image workflow'
```

- [ ] **Step 6: Final report**

Report changed paths, focused/full test results, browser-gate status, migration-not-run status, graph refresh, and residual risks. Do not push, deploy, or apply migrations without explicit instruction.
