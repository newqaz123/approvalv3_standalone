# Image Attachment Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Optimize newly uploaded JPG/JPEG/PNG/WebP attachments server-side, persist the actual stored size, and show users the original-to-stored size reduction.

**Architecture:** A focused server-only Sharp module prepares validated image bytes before either existing upload action writes them through private storage. The action results carry the persisted size through the solution upload coordinator and both upload UIs, while authorization, attachment records, cleanup, and non-image handling stay unchanged.

**Tech Stack:** Next.js Server Actions, TypeScript, Sharp, Prisma existing `file_attachments` model, React upload components, Node `node:test` regression tests.

**Spec:** `docs/superpowers/specs/2026-08-27-image-attachment-optimization-design.md`

## Global Constraints

- Optimize only policy-approved JPG/JPEG/PNG/WebP uploads; GIFs and all non-eligible attachments remain byte-preserving.
- Cap eligible images at a 2048px longest edge with `withoutEnlargement: true`.
- Encode JPEG and WebP at quality 82.
- Encode PNG with palette compression at quality 82, retain transparency, and keep the original bytes when the result is not smaller.
- Normalize EXIF orientation and do not copy metadata into optimized output.
- Validate the original upload against the existing 10 MB/type policy before reading and processing it.
- Use the existing private storage layer and UUID-prefixed path convention; do not write under a public static path.
- Store the byte length actually written to disk in `file_attachments.fileSize`.
- Do not rewrite existing attachments, add a database migration, store a second original, or add inline description images/table tools.
- Keep the pre-existing untracked `presentation-output/` directory untouched.
- Run `npm run check` and `graphify update .` after implementation; do not run production migrations.

---

### Task 1: Add and test the shared image optimizer

**Files:**
- Create: `src/lib/attachments/image-optimization.ts`
- Create: `tests/regression/image-optimization.test.ts`
- Modify: `package.json` dependencies to add `sharp` directly at `^0.34.3`
- Modify: `package-lock.json` through npm install
- Modify: `next.config.mjs` to list `sharp` in `serverExternalPackages`

**Interfaces:**
- Produces `ImageOptimizationResult` and `optimizeImageAttachment(input)` for Task 2.
- `optimizeImageAttachment` accepts `{ bytes: Buffer; fileName: string; mimeType: string }` and returns `Promise<{ bytes: Buffer; originalSize: number; storedSize: number; optimized: boolean }>`.
- Throws for an eligible file that Sharp cannot decode or encode; returns the original bytes for ineligible formats and non-beneficial output.

- [ ] **Step 1: Write the failing optimizer tests**

Create deterministic synthetic images with Sharp and assert behavior without depending on private uploaded content. The test file should include these cases:

```ts
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import { optimizeImageAttachment } from '../../src/lib/attachments/image-optimization'

async function createImage(
  width: number,
  height: number,
  channels: 3 | 4,
  format: 'jpeg' | 'png' | 'webp',
) {
  const input = sharp({
    create: {
      width,
      height,
      channels,
      background: channels === 4
        ? { r: 30, g: 90, b: 150, alpha: 0.5 }
        : { r: 30, g: 90, b: 150 },
    },
  })
  if (format === 'jpeg') return input.jpeg({ quality: 100 }).toBuffer()
  if (format === 'webp') return input.webp({ quality: 100 }).toBuffer()
  return input.png({ compressionLevel: 9 }).toBuffer()
}

describe('optimizeImageAttachment', () => {
  it('caps landscape and portrait images at a 2048px longest edge', async () => {
    for (const [fileName, mimeType, format] of [
      ['landscape.jpg', 'image/jpeg', 'jpeg'],
      ['portrait.webp', 'image/webp', 'webp'],
    ] as const) {
      const input = await createImage(4000, 3000, 3, format)
      const result = await optimizeImageAttachment({ bytes: input, fileName, mimeType })
      const metadata = await sharp(result.bytes).metadata()
      assert.ok(Math.max(metadata.width ?? 0, metadata.height ?? 0) <= 2048)
      assert.ok(result.storedSize <= result.originalSize)
      assert.equal(result.storedSize, result.bytes.length)
    }
  })

  it('does not enlarge an image already within the bound', async () => {
    const input = await createImage(800, 600, 3, 'jpeg')
    const result = await optimizeImageAttachment({
      bytes: input,
      fileName: 'small.jpg',
      mimeType: 'image/jpeg',
    })
    const metadata = await sharp(result.bytes).metadata()
    assert.equal(metadata.width, 800)
    assert.equal(metadata.height, 600)
  })

  it('keeps PNG format and transparency while palette-compressing', async () => {
    const input = await createImage(2400, 1600, 4, 'png')
    const result = await optimizeImageAttachment({
      bytes: input,
      fileName: 'transparent.png',
      mimeType: 'image/png',
    })
    const metadata = await sharp(result.bytes).metadata()
    assert.equal(metadata.format, 'png')
    assert.equal(metadata.hasAlpha, true)
    assert.equal(result.storedSize, result.bytes.length)
  })

  it('falls back to original bytes when optimization is larger', async () => {
    const input = await sharp({
      create: { width: 1, height: 1, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 1 } },
    }).png({ compressionLevel: 9 }).toBuffer()
    const result = await optimizeImageAttachment({
      bytes: input,
      fileName: 'tiny.png',
      mimeType: 'image/png',
    })
    assert.equal(result.optimized, false)
    assert.deepEqual(result.bytes, input)
    assert.equal(result.storedSize, input.length)
  })

  it('passes GIF and non-image bytes through unchanged', async () => {
    const gif = Buffer.from('gif-bytes')
    const pdf = Buffer.from('pdf-bytes')
    const gifResult = await optimizeImageAttachment({ bytes: gif, fileName: 'a.gif', mimeType: 'image/gif' })
    const pdfResult = await optimizeImageAttachment({ bytes: pdf, fileName: 'a.pdf', mimeType: 'application/pdf' })
    assert.equal(gifResult.optimized, false)
    assert.equal(pdfResult.optimized, false)
    assert.deepEqual(gifResult.bytes, gif)
    assert.deepEqual(pdfResult.bytes, pdf)
  })

  it('rejects corrupt eligible image bytes', async () => {
    await assert.rejects(
      () => optimizeImageAttachment({ bytes: Buffer.from('not an image'), fileName: 'bad.jpg', mimeType: 'image/jpeg' }),
      Error,
    )
  })
})
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```bash
job_id="$(portly temp 'npx tsx --test tests/regression/image-optimization.test.ts' --path . --timeout 30m)"
portly wait "$job_id"
```

Expected: FAIL because `src/lib/attachments/image-optimization.ts` does not exist.

- [ ] **Step 3: Add the direct Sharp dependency and server external configuration**

Run:

```bash
npm install sharp@^0.34.3 --save
```

Then modify `next.config.mjs` so the existing list becomes:

```js
serverExternalPackages: ['nodemailer', 'sharp'],
```

This prevents the native Sharp package from being pulled into a browser/client bundle while keeping the existing Nodemailer configuration.

- [ ] **Step 4: Implement the minimal optimizer**

Create `src/lib/attachments/image-optimization.ts` with the following behavior and names:

```ts
import sharp from 'sharp'

export const MAX_OPTIMIZED_IMAGE_EDGE = 2048
export const OPTIMIZED_IMAGE_QUALITY = 82

export interface ImageOptimizationResult {
  bytes: Buffer
  originalSize: number
  storedSize: number
  optimized: boolean
}

type OptimizableFormat = 'jpeg' | 'png' | 'webp'

function extensionOf(fileName: string): string {
  const baseName = fileName.toLowerCase().split(/[\\/]/).pop() ?? ''
  const dot = baseName.lastIndexOf('.')
  return dot === -1 ? '' : baseName.slice(dot + 1)
}

function getOptimizableFormat(fileName: string, mimeType: string): OptimizableFormat | null {
  const extension = extensionOf(fileName)
  const mime = mimeType.toLowerCase()
  if (mime === 'image/jpeg' && (extension === 'jpg' || extension === 'jpeg')) return 'jpeg'
  if (mime === 'image/png' && extension === 'png') return 'png'
  if (mime === 'image/webp' && extension === 'webp') return 'webp'
  return null
}

export async function optimizeImageAttachment(input: {
  bytes: Buffer
  fileName: string
  mimeType: string
}): Promise<ImageOptimizationResult> {
  const originalSize = input.bytes.length
  const format = getOptimizableFormat(input.fileName, input.mimeType)
  if (!format) {
    return { bytes: input.bytes, originalSize, storedSize: originalSize, optimized: false }
  }

  const resized = sharp(input.bytes)
    .rotate()
    .resize({
      width: MAX_OPTIMIZED_IMAGE_EDGE,
      height: MAX_OPTIMIZED_IMAGE_EDGE,
      fit: 'inside',
      withoutEnlargement: true,
    })

  const transformed = format === 'jpeg'
    ? await resized.jpeg({ quality: OPTIMIZED_IMAGE_QUALITY, mozjpeg: true }).toBuffer()
    : format === 'webp'
      ? await resized.webp({ quality: OPTIMIZED_IMAGE_QUALITY }).toBuffer()
      : await resized.png({
          palette: true,
          quality: OPTIMIZED_IMAGE_QUALITY,
          compressionLevel: 9,
          adaptiveFiltering: true,
        }).toBuffer()

  if (transformed.length >= originalSize) {
    return { bytes: input.bytes, originalSize, storedSize: originalSize, optimized: false }
  }

  return {
    bytes: transformed,
    originalSize,
    storedSize: transformed.length,
    optimized: true,
  }
}
```

Do not import the attachment policy, Prisma, filesystem functions, or React into this module. The actions remain responsible for policy validation, authorization, paths, and persistence.

- [ ] **Step 5: Run the focused tests to verify they pass**

Run:

```bash
job_id="$(portly temp 'npx tsx --test tests/regression/image-optimization.test.ts' --path . --timeout 30m)"
portly wait "$job_id"
```

Expected: PASS for all optimizer cases.

- [ ] **Step 6: Commit the isolated optimizer**

```bash
git add package.json package-lock.json next.config.mjs src/lib/attachments/image-optimization.ts tests/regression/image-optimization.test.ts
git commit -m "feat: add server-side image attachment optimization"
```

---

### Task 2: Wire optimized bytes and sizes into both server upload actions

**Files:**
- Modify: `src/server-actions/files.ts:7-12,174-205,344-375`
- Create: `tests/regression/image-upload-wiring.test.ts`

**Interfaces:**
- Consumes `optimizeImageAttachment` from Task 1.
- Produces action persistence that writes `prepared.bytes` and stores `prepared.storedSize`.
- `uploadFileAction` continues returning `{ success: true, fileAttachment }` or `{ success: false, error }`.
- `uploadSolutionDraftAttachmentAction` continues returning `DraftUploadResult`; its existing serialized `fileAttachment.fileSize` becomes the optimized stored size.

- [ ] **Step 1: Write failing source-wiring tests**

Create a regression contract test following the repository's existing server-action source assertions:

```ts
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync('src/server-actions/files.ts', 'utf8')
const requestUpload = source.slice(
  source.indexOf('export async function uploadFileAction'),
  source.indexOf('/**\n * A file_attachment row serialized'),
)
const draftUpload = source.slice(
  source.indexOf('export async function uploadSolutionDraftAttachmentAction'),
  source.indexOf('export type CleanupSolutionDraftAttachmentsResult'),
)

describe('image upload action optimization wiring', () => {
  it('uses the shared optimizer in request uploads', () => {
    assert.match(requestUpload, /optimizeImageAttachment/)
    assert.match(requestUpload, /writeAttachmentFile\(storedPath, prepared\.bytes\)/)
    assert.match(requestUpload, /fileSize:\s*prepared\.storedSize/)
  })

  it('uses the shared optimizer in solution draft uploads', () => {
    assert.match(draftUpload, /optimizeImageAttachment/)
    assert.match(draftUpload, /writeAttachmentFile\(storedPath, prepared\.bytes\)/)
    assert.match(draftUpload, /fileSize:\s*prepared\.storedSize/)
  })

  it('returns a controlled image-processing error from both actions', () => {
    assert.equal((requestUpload.match(/Unable to process image/g) ?? []).length, 1)
    assert.equal((draftUpload.match(/Unable to process image/g) ?? []).length, 1)
  })

  it('keeps the existing private storage and compensation calls', () => {
    assert.match(requestUpload, /createStoredAttachmentPath/)
    assert.match(requestUpload, /deleteAttachmentFile/)
    assert.match(draftUpload, /createStoredAttachmentPath/)
    assert.match(draftUpload, /deleteAttachmentFile/)
  })
})
```

- [ ] **Step 2: Run the wiring test to verify it fails**

Run:

```bash
job_id="$(portly temp 'npx tsx --test tests/regression/image-upload-wiring.test.ts' --path . --timeout 30m)"
portly wait "$job_id"
```

Expected: FAIL because the upload actions still write the original `bytes` and `file.size`.

- [ ] **Step 3: Add the optimizer import and prepare bytes after authorization**

Add this import to `src/server-actions/files.ts`:

```ts
import {
  optimizeImageAttachment,
  type ImageOptimizationResult,
} from '@/lib/attachments/image-optimization'
```

In both upload actions, leave authentication, metadata validation, request lookup, role checks, and request-state checks in their current order. Immediately after those checks and before `writeAttachmentFile`, replace the direct write preparation with this concrete request-upload block:

```ts
const bytes = Buffer.from(await file.arrayBuffer())
let prepared: ImageOptimizationResult
try {
  prepared = await optimizeImageAttachment({
    bytes,
    fileName: file.name,
    mimeType: file.type,
  })
} catch (error) {
  console.warn('[uploadFileAction] Failed to optimize image attachment', error)
  return { success: false, error: 'Unable to process image' }
}

const storedPath = createStoredAttachmentPath(requestId, file.name)
await writeAttachmentFile(storedPath, prepared.bytes)
```

Use the same typed preparation block in the solution-draft action, changing only the log prefix to `[uploadSolutionDraftAttachmentAction]`. Keep each existing `try/catch` around the Prisma insert. Change only the persisted size fields:

```ts
fileSize: prepared.storedSize,
```

Leave `fileType: file.type`, the sanitized display filename, description, uploader, request/solution relations, activity logging, revalidation, and compensation deletion unchanged. The optimizer runs after authorization, so an unauthorized caller cannot spend processing resources or create a file.

- [ ] **Step 4: Run the wiring and existing upload contract tests**

Run:

```bash
job_id="$(portly temp 'npx tsx --test tests/regression/image-upload-wiring.test.ts tests/regression/solution-upload-actions.test.ts tests/regression/private-storage-wiring.test.ts' --path . --timeout 30m)"
portly wait "$job_id"
```

Expected: PASS, including the pre-existing authorization, private-storage, draft-transfer, and cleanup contracts.

- [ ] **Step 5: Commit the server-action integration**

```bash
git add src/server-actions/files.ts tests/regression/image-upload-wiring.test.ts
git commit -m "feat: optimize bytes in attachment upload actions"
```

---

### Task 3: Carry the persisted size through solution upload coordination

**Files:**
- Modify: `src/lib/attachments/upload-batch.ts:3-14,88-90`
- Modify: `src/hooks/use-solution-attachments.ts:158-166`
- Modify: `tests/regression/upload-batch.test.ts`

**Interfaces:**
- Consumes the successful draft action result with `fileAttachment.fileSize` from Task 2.
- Produces `AttachmentUploadItem.storedSize?: number`.
- `UploadOneAttachment` success results carry `storedSize?: number`; the optional property keeps existing pure coordinator test callbacks source-compatible while the production hook always supplies it.
- `uploadAttachmentBatch` copies `result.storedSize` into the successful item without changing ID ordering, retry semantics, or failure handling.

- [ ] **Step 1: Add failing coordinator and hook contract tests**

Append these tests/assertions to the existing upload-batch regression suite:

```ts
it('keeps the server-reported stored size on successful items', async () => {
  const result = await uploadAttachmentBatch(
    [item('image', 'photo.pdf')],
    async () => ({
      success: true,
      attachmentId: '11111111-1111-1111-1111-111111111111',
      storedSize: 327600,
    }),
  )
  assert.equal(result.items[0].storedSize, 327600)
})

it('preserves a prior successful stored size when retrying other items', async () => {
  const prior = {
    ...item('prior', 'prior.pdf'),
    status: 'success' as const,
    attachmentId: '11111111-1111-1111-1111-111111111111',
    storedSize: 100,
  }
  const result = await uploadAttachmentBatch(
    [prior, { ...item('retry', 'retry.pdf'), status: 'error' }],
    async () => ({
      success: true,
      attachmentId: '22222222-2222-2222-2222-222222222222',
      storedSize: 200,
    }),
  )
  assert.equal(result.items[0].storedSize, 100)
  assert.equal(result.items[1].storedSize, 200)
})
```

Also add a source assertion in the hook contract section:

```ts
assert.match(hookSource, /storedSize:\s*actionResult\.fileAttachment\.fileSize/)
```

- [ ] **Step 2: Run the focused coordinator tests to verify they fail**

Run:

```bash
job_id="$(portly temp 'npx tsx --test tests/regression/upload-batch.test.ts' --path . --timeout 30m)"
portly wait "$job_id"
```

Expected: FAIL because successful items and the solution hook do not carry `storedSize`.

- [ ] **Step 3: Extend the coordinator and hook types**

In `src/lib/attachments/upload-batch.ts`, add the optional item field and success result field:

```ts
export interface AttachmentUploadItem {
  id: string
  file: File
  status: 'pending' | 'uploading' | 'success' | 'error'
  attachmentId?: string
  storedSize?: number
  error?: string
}

export type UploadOneAttachment = (item: AttachmentUploadItem) => Promise<
  | { success: true; attachmentId: string; storedSize?: number }
  | { success: false; error: string }
>
```

Change the successful result branch to copy the server value:

```ts
items[index] = result.success
  ? {
      ...uploading,
      status: 'success',
      attachmentId: result.attachmentId,
      storedSize: result.storedSize,
    }
  : { ...uploading, status: 'error', error: result.error }
```

In `use-solution-attachments.ts`, return the serialized server size from the draft action:

```ts
return actionResult.success
  ? {
      success: true,
      attachmentId: actionResult.attachmentId,
      storedSize: actionResult.fileAttachment.fileSize,
    }
  : { success: false, error: actionResult.error }
```

Do not change `attachmentIds`, `ensureUploaded`, cleanup, retry skipping, or item state transitions.

- [ ] **Step 4: Run coordinator, hook, and existing upload tests**

Run:

```bash
job_id="$(portly temp 'npx tsx --test tests/regression/upload-batch.test.ts tests/regression/solution-upload-actions.test.ts' --path . --timeout 30m)"
portly wait "$job_id"
```

Expected: PASS, including the new stored-size assertions and all existing retry/cleanup contracts.

- [ ] **Step 5: Commit the size propagation**

```bash
git add src/lib/attachments/upload-batch.ts src/hooks/use-solution-attachments.ts tests/regression/upload-batch.test.ts
git commit -m "feat: propagate optimized attachment sizes"
```

---

### Task 4: Display original-to-stored sizes in both upload UIs

**Files:**
- Modify: `src/components/requests/file-upload-zone.tsx:9-16,85-94,168-176`
- Modify: `src/components/solutions/solution-file-upload.tsx:288-314`
- Create: `tests/regression/image-attachment-ui.test.ts`

**Interfaces:**
- Consumes `fileAttachment.fileSize` from `uploadFileAction` and `AttachmentUploadItem.storedSize` from Task 3.
- Produces a success-only label such as `2.74 MB → 327.6 KB · optimized` when the stored size is strictly smaller.
- Unchanged, non-image, uploading, pending, and error items retain the existing single-size/error/progress presentation.

- [ ] **Step 1: Write failing UI contract tests**

Create source-wiring tests consistent with the existing component contract tests:

```ts
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const requestSource = readFileSync('src/components/requests/file-upload-zone.tsx', 'utf8')
const solutionSource = readFileSync('src/components/solutions/solution-file-upload.tsx', 'utf8')

describe('image optimization size display', () => {
  it('request uploader stores and renders the server file size', () => {
    assert.match(requestSource, /storedSize\?: number/)
    assert.match(requestSource, /storedSize:\s*result\.fileAttachment\.fileSize/)
    assert.match(requestSource, /optimized/)
    assert.match(requestSource, /file\.file\.size/)
  })

  it('solution uploader renders the item stored size and optimization label', () => {
    assert.match(solutionSource, /item\.storedSize/)
    assert.match(solutionSource, /optimized/)
    assert.match(solutionSource, /file\.size/)
  })

  it('request picker exposes the already-supported WebP extension', () => {
    assert.match(requestSource, /\.webp/)
  })
})
```

- [ ] **Step 2: Run the UI contract test to verify it fails**

Run:

```bash
job_id="$(portly temp 'npx tsx --test tests/regression/image-attachment-ui.test.ts' --path . --timeout 30m)"
portly wait "$job_id"
```

Expected: FAIL because neither component stores or displays the server-reported size.

- [ ] **Step 3: Update the request uploader**

In `file-upload-zone.tsx`:

1. Add `storedSize?: number` to `UploadedFile`.
2. Add `.webp` to the existing `accept` string without changing the other accepted extensions.
3. In the successful `uploadFileAction` branch, store `result.fileAttachment.fileSize` alongside the success status:

```ts
f.id === uploadedFile.id
  ? {
      ...f,
      status: 'success',
      progress: 100,
      storedSize: result.fileAttachment.fileSize,
    }
  : f
```

4. Render the size using the original browser size until the server result exists. Once successful, show the original-to-stored label only when the stored size is smaller:

```tsx
const storedSize = file.storedSize ?? file.file.size
const isOptimized = file.status === 'success' && storedSize < file.file.size

<p className="text-xs text-gray-500">
  {isOptimized
    ? `${formatFileSize(file.file.size)} → ${formatFileSize(storedSize)} · optimized`
    : formatFileSize(storedSize)}
  {file.status === 'uploading' && ` - ${file.progress}%`}
</p>
```

Keep the existing error and remove behavior unchanged.

- [ ] **Step 4: Update the solution uploader**

In `solution-file-upload.tsx`, derive the display values inside the `items.map` callback:

```tsx
const storedSize = item.storedSize ?? file.size
const isOptimized = isSuccess && storedSize < file.size
```

Replace the current size span with:

```tsx
<span className="text-xs text-gray-500">
  {isOptimized
    ? `${formatFileSize(file.size)} → ${formatFileSize(storedSize)} · optimized`
    : formatFileSize(storedSize)}
</span>
```

Leave existing-file rows using their persisted `file.fileSize`, and leave upload progress, error, retry, remove, and success text behavior unchanged.

- [ ] **Step 5: Run the UI and upload regression tests**

Run:

```bash
job_id="$(portly temp 'npx tsx --test tests/regression/image-attachment-ui.test.ts tests/regression/upload-batch.test.ts tests/regression/attachment-policy.test.ts' --path . --timeout 30m)"
portly wait "$job_id"
```

Expected: PASS, including the WebP policy and before/after display contracts.

- [ ] **Step 6: Commit the UI reporting**

```bash
git add src/components/requests/file-upload-zone.tsx src/components/solutions/solution-file-upload.tsx tests/regression/image-attachment-ui.test.ts
git commit -m "feat: show optimized attachment sizes"
```

---

### Task 5: Run full verification and refresh the code graph

**Files:**
- No source changes expected.
- Verify: all files changed by Tasks 1–4.
- Preserve: `presentation-output/` remains untracked and untouched.

**Interfaces:**
- Consumes the completed optimizer, action wiring, coordinator propagation, UI reporting, and regression tests.
- Produces a verified working tree and an updated `graphify-out/` navigation graph.

- [ ] **Step 1: Run the complete repository check**

Run the project-required check through Portly:

```bash
job_id="$(portly temp 'npm run check' --path . --timeout 30m)"
portly wait "$job_id"
```

Expected: TypeScript compilation, management tests, and all regression tests pass.

- [ ] **Step 2: Update graphify after code changes**

Run:

```bash
graphify update .
```

Expected: the graph refreshes successfully and includes `image-optimization.ts` and its upload-action/UI relationships.

- [ ] **Step 3: Inspect the final diff and working tree**

Run:

```bash
git diff HEAD~4..HEAD --stat
git status --short
```

Confirm that the feature commits contain only the planned files, `presentation-output/` is still the pre-existing untracked directory, and no migration or generated production data was added.

- [ ] **Step 4: Record verification evidence**

Before reporting completion, capture the successful `npm run check` output, the successful `graphify update .` output, and the final changed-file summary. Do not claim completion if either required command failed.
