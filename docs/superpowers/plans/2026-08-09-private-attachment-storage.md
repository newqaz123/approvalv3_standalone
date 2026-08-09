# Private Attachment Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move attachments out of public static storage, enforce safe paths and request-view authorization, preserve existing volume data, support Thai filenames, and make the 10 MB upload contract survive Next.js and Docker runtime layers.

**Architecture:** Introduce focused attachment policy, storage, header, and request-access modules. Store only relative attachment paths, resolve legacy `uploads/...` records through one containment-checked resolver, and serve files by attachment ID through an authorized route. Remount the existing named volume at `/app/uploads`, convert runtime configuration to `next.config.mjs`, and document the matching 15 MB proxy transport limit.

**Tech Stack:** Next.js 15.5.23 App Router, TypeScript, Node filesystem APIs, Prisma 6, Auth.js v5, Docker Compose, Node test runner via `tsx`.

## Global Constraints

- Application file limit is exactly 10 MB per file and 10 attachments per form submission.
- Next.js and Nginx transport limits are exactly 15 MB per request.
- Local upload root defaults to `<project>/uploads`; Docker upload root is `/app/uploads`.
- No new attachment may be written under `public/`.
- Stored database paths are relative and never absolute.
- Existing `uploads/<request-id>/<filename>` database paths and Docker volume contents must remain readable.
- Attachment access uses the existing request-view rules: admins and engineering users may view all non-deleted requests; general users may view their department requests or requests where they are required approvers.
- No VPS command, production migration, or live deployment is part of this plan.

---

## File Structure

**Create**

- `src/lib/attachments/policy.ts` — shared size, count, extension/MIME, and filename rules.
- `src/lib/attachments/storage.ts` — upload-root selection, canonical relative paths, containment, reads/writes/deletes.
- `src/lib/attachments/content-disposition.ts` — safe ASCII fallback and RFC 5987 filename encoding.
- `src/lib/request-access.ts` — server-only request visibility query shared by file access.
- `scripts/migrate-uploads.ts` — idempotent local legacy-directory migration.
- `tests/regression/attachment-policy.test.ts` — policy and filename cases.
- `tests/regression/attachment-storage.test.ts` — path containment and legacy normalization.
- `tests/regression/content-disposition.test.ts` — Thai/Unicode and header-injection cases.
- `tests/regression/private-file-access.test.ts` — request access and route wiring assertions.
- `tests/regression/upload-runtime-config.test.ts` — Next/Docker/Compose upload-limit wiring.

**Modify**

- `src/lib/files.ts` — compatibility façade delegating to private storage.
- `src/lib/file-preview.ts` — build URLs from attachment IDs.
- `src/lib/pdf-package.ts` — read attachment content through storage resolver.
- `src/server-actions/files.ts` — shared validation/storage and safe deletion.
- `src/server-actions/requests.ts` — safe attachment cleanup.
- `src/app/api/files/download/route.ts` — authorized ID-based downloads.
- All request/solution modal download and preview callers — pass IDs instead of paths.
- `Dockerfile`, `docker-compose.yml`, `docker-compose.dev.yml`, `docker-compose.prod.yml` — private volume mount.
- `scripts/backup.sh`, `scripts/restore.sh` — private mount plus legacy fallback.
- `.env.example`, `package.json`, `package-lock.json`, `DEPLOY.md`, `docs/DEPLOY.md` — runtime contract and commands.
- Delete `next.config.ts`; create `next.config.mjs`.

---

### Task 1: Restore the Green Regression Baseline

**Files:**

- Modify: `tests/regression/engineering-sub-tasks.test.ts:618`

**Interfaces:**

- Consumes: current JSX in `src/components/requests/sub-task-form-dialog.tsx`.
- Produces: a green pre-existing regression baseline for every later task gate.

- [ ] **Step 1: Reproduce the existing failure**

Run: `npx tsx --test tests/regression/engineering-sub-tasks.test.ts`
Expected: FAIL because the test expects raw quotes while JSX contains `&quot;`.

- [ ] **Step 2: Correct the exact source assertion**

Replace the raw-quote expression with:

```ts
assert.match(component, /Add &quot;\{subContractorSearch\.trim\(\)\}&quot;/)
```

Do not change production markup.

- [ ] **Step 3: Verify the baseline**

Run:

```bash
npx tsx --test tests/regression/engineering-sub-tasks.test.ts
npx tsx --test tests/regression/*.test.ts
```

Expected: all 93 current regression tests pass.

- [ ] **Step 4: Commit**

```bash
git add tests/regression/engineering-sub-tasks.test.ts
git commit -m "test: align subcontractor quote assertion"
```

---

### Task 2: Shared Attachment Policy and Filename Safety

**Files:**

- Create: `src/lib/attachments/policy.ts`
- Create: `tests/regression/attachment-policy.test.ts`
- Modify: `src/components/solutions/solution-file-upload.tsx`
- Modify: `src/components/requests/submitter-modal.tsx`
- Modify: `src/server-actions/files.ts`

**Interfaces:**

- Produces: `MAX_ATTACHMENT_BYTES`, `MAX_ATTACHMENTS_PER_FORM`, `AttachmentMetadata`, `sanitizeAttachmentFileName(name)`, and `validateAttachmentMetadata(metadata)`.
- Consumes: no earlier task interfaces.

- [ ] **Step 1: Write failing policy tests**

```ts
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_FORM,
  sanitizeAttachmentFileName,
  validateAttachmentMetadata,
} from '../../src/lib/attachments/policy'

describe('attachment policy', () => {
  it('enforces the 10 MB and 10-file contract', () => {
    assert.equal(MAX_ATTACHMENT_BYTES, 10 * 1024 * 1024)
    assert.equal(MAX_ATTACHMENTS_PER_FORM, 10)
    assert.equal(validateAttachmentMetadata({ name: 'ok.pdf', type: 'application/pdf', size: MAX_ATTACHMENT_BYTES }), null)
    assert.match(validateAttachmentMetadata({ name: 'large.pdf', type: 'application/pdf', size: MAX_ATTACHMENT_BYTES + 1 })!, /10MB/)
  })

  it('keeps supported Office, image, WebP, and CAD names aligned', () => {
    assert.equal(validateAttachmentMetadata({ name: 'drawing.dwg', type: 'application/octet-stream', size: 100 }), null)
    assert.equal(validateAttachmentMetadata({ name: 'model.step', type: '', size: 100 }), null)
    assert.equal(validateAttachmentMetadata({ name: 'photo.webp', type: 'image/webp', size: 100 }), null)
    assert.match(validateAttachmentMetadata({ name: 'script.html', type: 'text/html', size: 100 })!, /not supported/)
  })

  it('sanitizes separators and control characters while preserving Thai text', () => {
    assert.equal(sanitizeAttachmentFileName('../../ต่อ Line 4%NaOH.pdf'), 'ต่อ Line 4%NaOH.pdf')
    assert.equal(sanitizeAttachmentFileName('bad\r\nname.pdf'), 'badname.pdf')
    assert.equal(sanitizeAttachmentFileName('..'), 'attachment')
  })
})
```

- [ ] **Step 2: Run tests and confirm the module is missing**

Run: `npx tsx --test tests/regression/attachment-policy.test.ts`
Expected: FAIL with `Cannot find module '../../src/lib/attachments/policy'`.

- [ ] **Step 3: Implement the policy module**

Use one extension-to-MIME policy. CAD files may have empty or `application/octet-stream` MIME values; all other types require a matching allowed MIME.

```ts
import { basename } from 'node:path'

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
export const MAX_ATTACHMENTS_PER_FORM = 10

export interface AttachmentMetadata {
  name: string
  type: string
  size: number
}

const MIME_BY_EXTENSION: Record<string, Set<string>> = {
  pdf: new Set(['application/pdf']),
  doc: new Set(['application/msword']),
  docx: new Set(['application/vnd.openxmlformats-officedocument.wordprocessingml.document']),
  xls: new Set(['application/vnd.ms-excel']),
  xlsx: new Set(['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']),
  ppt: new Set(['application/vnd.ms-powerpoint']),
  pptx: new Set(['application/vnd.openxmlformats-officedocument.presentationml.presentation']),
  jpg: new Set(['image/jpeg']),
  jpeg: new Set(['image/jpeg']),
  png: new Set(['image/png']),
  gif: new Set(['image/gif']),
  webp: new Set(['image/webp']),
  dwg: new Set(['', 'application/octet-stream', 'application/acad', 'image/vnd.dwg']),
  dxf: new Set(['', 'application/octet-stream', 'image/vnd.dxf']),
  step: new Set(['', 'application/octet-stream', 'model/step']),
  stp: new Set(['', 'application/octet-stream', 'model/step']),
  iges: new Set(['', 'application/octet-stream', 'model/iges']),
  igs: new Set(['', 'application/octet-stream', 'model/iges']),
}

export function sanitizeAttachmentFileName(input: string): string {
  const safe = basename(input.replaceAll('\\', '/'))
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\/]/g, '-')
    .trim()
  return !safe || safe === '.' || safe === '..' ? 'attachment' : safe.slice(0, 180)
}

export function validateAttachmentMetadata(file: AttachmentMetadata): string | null {
  if (file.size <= 0) return `${file.name}: File is empty`
  if (file.size > MAX_ATTACHMENT_BYTES) return `${file.name}: File size exceeds 10MB limit`
  const extension = sanitizeAttachmentFileName(file.name).split('.').pop()?.toLowerCase() ?? ''
  const allowedMimes = MIME_BY_EXTENSION[extension]
  if (!allowedMimes || !allowedMimes.has(file.type.toLowerCase())) return `${file.name}: File type not supported`
  return null
}
```

- [ ] **Step 4: Replace duplicated client and server constants**

Import the shared constants and validator into `solution-file-upload.tsx`, `submitter-modal.tsx`, and `server-actions/files.ts`. Remove local arrays and `MAX_FILE_SIZE`. The UI `accept` string must be derived from the shared extensions rather than maintained separately.

- [ ] **Step 5: Run focused tests and typecheck**

Run: `npx tsx --test tests/regression/attachment-policy.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/attachments/policy.ts src/components/solutions/solution-file-upload.tsx src/components/requests/submitter-modal.tsx src/server-actions/files.ts tests/regression/attachment-policy.test.ts
git commit -m "feat: centralize attachment policy"
```

---

### Task 3: Private Storage Resolver and Legacy Migration

**Files:**

- Create: `src/lib/attachments/storage.ts`
- Create: `scripts/migrate-uploads.ts`
- Create: `tests/regression/attachment-storage.test.ts`
- Modify: `src/lib/files.ts`
- Modify: `package.json`

**Interfaces:**

- Consumes: `sanitizeAttachmentFileName` from Task 1.
- Produces: `getUploadRoot()`, `normalizeStoredAttachmentPath()`, `resolveStoredAttachmentPath()`, `createStoredAttachmentPath()`, `writeAttachmentFile()`, `readAttachmentFile()`, and `deleteAttachmentFile()`.

- [ ] **Step 1: Write failing containment and legacy tests**

```ts
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import {
  createStoredAttachmentPath,
  normalizeStoredAttachmentPath,
  resolveStoredAttachmentPath,
} from '../../src/lib/attachments/storage'

describe('private attachment storage', () => {
  const root = join(process.cwd(), '.tmp-upload-root')

  it('normalizes legacy public upload paths', () => {
    assert.equal(normalizeStoredAttachmentPath('/public/uploads/request-1/a.pdf'), 'request-1/a.pdf')
    assert.equal(normalizeStoredAttachmentPath('uploads/request-1/a.pdf'), 'request-1/a.pdf')
  })

  it('rejects paths escaping the private root', () => {
    assert.throws(() => resolveStoredAttachmentPath('../../outside.pdf', root), /outside upload root/)
  })

  it('generates a safe relative path independent of display name', () => {
    assert.equal(
      createStoredAttachmentPath('11111111-1111-1111-1111-111111111111', '../../รายงาน.pdf', 'file-id'),
      '11111111-1111-1111-1111-111111111111/file-id-รายงาน.pdf'
    )
  })
})
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `npx tsx --test tests/regression/attachment-storage.test.ts`
Expected: FAIL because `storage.ts` does not exist.

- [ ] **Step 3: Implement containment-checked storage**

```ts
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { sanitizeAttachmentFileName } from './policy'

export function getUploadRoot(): string {
  return resolve(process.env.UPLOAD_DIR || resolve(process.cwd(), 'uploads'))
}

export function normalizeStoredAttachmentPath(storedPath: string): string {
  return storedPath.trim().replace(/^\/+/, '').replace(/^public\/+/, '').replace(/^uploads\/+/, '')
}

export function resolveStoredAttachmentPath(storedPath: string, root = getUploadRoot()): string {
  const resolvedRoot = resolve(root)
  const resolvedPath = resolve(resolvedRoot, normalizeStoredAttachmentPath(storedPath))
  if (resolvedPath === resolvedRoot || !resolvedPath.startsWith(`${resolvedRoot}${sep}`)) {
    throw new Error('Attachment path resolves outside upload root')
  }
  return resolvedPath
}

export function createStoredAttachmentPath(requestId: string, originalName: string, id = randomUUID()): string {
  return `${requestId}/${id}-${sanitizeAttachmentFileName(originalName)}`
}

export async function writeAttachmentFile(storedPath: string, bytes: Buffer): Promise<void> {
  const destination = resolveStoredAttachmentPath(storedPath)
  await mkdir(dirname(destination), { recursive: true })
  await writeFile(destination, bytes, { flag: 'wx' })
}

export async function readAttachmentFile(storedPath: string): Promise<Buffer> {
  return readFile(resolveStoredAttachmentPath(storedPath))
}

export async function deleteAttachmentFile(storedPath: string): Promise<void> {
  await unlink(resolveStoredAttachmentPath(storedPath))
}
```

- [ ] **Step 4: Convert `src/lib/files.ts` into a compatibility façade**

Keep existing exported names temporarily and delegate filesystem operations to Task 2 functions. Mark `getFileUrl()` deprecated but leave it unchanged until Task 3 removes its unused server-action wrapper in the same commit, preventing an intermediate compile failure.

- [ ] **Step 5: Add the idempotent local migration command**

`scripts/migrate-uploads.ts` must accept `--source` and `--destination`, defaulting to `public/uploads` and `UPLOAD_DIR || uploads`. For each regular file, compute its relative path, reject escapes, create the destination directory, copy with exclusive creation, verify byte size, then remove the source. Existing equal-size destinations are reported and skipped; conflicting destinations cause a non-zero exit without deleting the source.

Add:

```json
{
  "scripts": {
    "migrate:uploads": "tsx scripts/migrate-uploads.ts"
  }
}
```

- [ ] **Step 6: Add migration behavior tests using temporary directories**

Extend `attachment-storage.test.ts` to invoke the exported `migrateUploads({ sourceRoot, destinationRoot })`, assert nested files move, reruns are harmless, and destination conflicts preserve the source.

- [ ] **Step 7: Run focused tests and typecheck**

Run: `npx tsx --test tests/regression/attachment-storage.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/attachments/storage.ts src/lib/files.ts scripts/migrate-uploads.ts tests/regression/attachment-storage.test.ts package.json
git commit -m "feat: add private attachment storage"
```

---

### Task 4: Migrate Every Server-Side File Consumer

**Files:**

- Modify: `src/server-actions/files.ts`
- Modify: `src/server-actions/requests.ts`
- Modify: `src/lib/pdf-package.ts`
- Delete: `src/lib/local-storage.ts`
- Create: `tests/regression/private-storage-wiring.test.ts`

**Interfaces:**

- Consumes: `writeAttachmentFile`, `readAttachmentFile`, `deleteAttachmentFile`, and `createStoredAttachmentPath` from Task 2.
- Produces: no new public interface.

- [ ] **Step 1: Write failing wiring assertions**

```ts
import { it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

it('routes every attachment filesystem operation through private storage', () => {
  const filesAction = readFileSync('src/server-actions/files.ts', 'utf8')
  const requestsAction = readFileSync('src/server-actions/requests.ts', 'utf8')
  const pdfPackage = readFileSync('src/lib/pdf-package.ts', 'utf8')
  for (const source of [filesAction, requestsAction, pdfPackage]) {
    assert.doesNotMatch(source, /join\(process\.cwd\(\), ['"]public/)
  }
  assert.match(filesAction, /writeAttachmentFile/)
  assert.match(filesAction, /deleteAttachmentFile/)
  assert.match(requestsAction, /deleteAttachmentFile/)
  assert.match(pdfPackage, /readAttachmentFile/)
})
```

- [ ] **Step 2: Run the test and confirm legacy joins fail it**

Run: `npx tsx --test tests/regression/private-storage-wiring.test.ts`
Expected: FAIL on `public` path joins.

- [ ] **Step 3: Replace upload and deletion calls**

In `server-actions/files.ts`, construct paths with `createStoredAttachmentPath(requestId, file.name)`, write with `writeAttachmentFile`, and preserve `sanitizeAttachmentFileName(file.name)` in `fileName`. On DB creation failure, call `deleteAttachmentFile(storedPath)` in a best-effort compensation block.

Replace attachment deletion joins in `server-actions/files.ts` and `server-actions/requests.ts` with `deleteAttachmentFile`.

- [ ] **Step 4: Replace PDF package reads**

`convertAttachmentToPdf()` and related helpers must call `readAttachmentFile(attachment.filePath)`. Remove the local `publicRoot` path resolver while preserving caller-order behavior and existing PDF tests.

- [ ] **Step 5: Remove confirmed-unused legacy file helpers**

Run:

```bash
grep -R "@/lib/local-storage\|lib/local-storage" src tests
grep -R "getDownloadUrl\|getFileUrl" src tests --exclude=files.ts
```

Expected: no callers outside their defining files. Delete `src/lib/local-storage.ts`, remove `getDownloadUrl` from `src/server-actions/files.ts`, remove `getFileUrl` from `src/lib/files.ts`, and remove their imports.

- [ ] **Step 6: Run storage and PDF tests**

Run: `npx tsx --test tests/regression/private-storage-wiring.test.ts tests/regression/attachment-storage.test.ts tests/regression/pdf-package.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/server-actions/files.ts src/server-actions/requests.ts src/lib/pdf-package.ts src/lib/local-storage.ts tests/regression/private-storage-wiring.test.ts
git commit -m "refactor: route attachments through private storage"
```

---

### Task 5: Request-Visibility Authorization and Thai Download Headers

**Files:**

- Create: `src/lib/request-access.ts`
- Create: `src/lib/attachments/content-disposition.ts`
- Modify: `src/app/api/files/download/route.ts`
- Create: `tests/regression/content-disposition.test.ts`
- Create: `tests/regression/private-file-access.test.ts`

**Interfaces:**

- Consumes: `readAttachmentFile` from Task 2.
- Produces: `canUserViewRequest(userId, requestId)`, `buildContentDisposition(disposition, fileName)`, and `GET /api/files/download?id=...`.

- [ ] **Step 1: Write failing header tests**

```ts
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildContentDisposition } from '../../src/lib/attachments/content-disposition'

describe('Content-Disposition', () => {
  it('uses ASCII fallback plus RFC 5987 for Thai filenames', () => {
    const value = buildContentDisposition('inline', 'ต่อ Line 4%NaOH TO GH Tank.pdf')
    assert.match(value, /^inline; filename="attachment\.pdf";/)
    assert.match(value, /filename\*=UTF-8''%E0%B8%95/)
    assert.doesNotThrow(() => new Headers({ 'Content-Disposition': value }))
  })

  it('removes header injection characters', () => {
    const value = buildContentDisposition('attachment', 'bad"\r\nX-Test: yes.pdf')
    assert.doesNotMatch(value, /[\r\n]/)
    assert.doesNotThrow(() => new Headers({ 'Content-Disposition': value }))
  })
})
```

- [ ] **Step 2: Run tests and confirm missing module**

Run: `npx tsx --test tests/regression/content-disposition.test.ts`
Expected: FAIL because the helper does not exist.

- [ ] **Step 3: Implement the header helper**

```ts
export function buildContentDisposition(
  disposition: 'inline' | 'attachment',
  originalName: string
): string {
  const cleaned = originalName.replace(/[\r\n\u0000-\u001f\u007f"]/g, '').trim() || 'attachment'
  const extension = cleaned.match(/\.[A-Za-z0-9]{1,10}$/)?.[0] ?? ''
  const asciiBase = cleaned.replace(/[^\x20-\x7E]/g, '').replace(extension, '').trim() || 'attachment'
  const ascii = `${asciiBase.slice(0, 120)}${extension}`.replace(/["\\]/g, '_')
  const encoded = encodeURIComponent(cleaned).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encoded}`
}
```

- [ ] **Step 4: Implement request visibility**

`canUserViewRequest(userId, requestId)` must load the active user with department type. Admin and engineering users may view any non-deleted request. General users require a request matching one of: same department, direct request approver, or direct solution approver. Return `false` for missing users, missing requests, deleted requests, and archived requests unless existing request listings explicitly include archived data.

- [ ] **Step 5: Write route wiring assertions**

`private-file-access.test.ts` reads the route source and asserts it requires `id`, queries `file_attachments`, calls `canUserViewRequest`, calls `readAttachmentFile`, uses `attachment.fileName`, and no longer accepts a raw `path` query or joins `public`.

- [ ] **Step 6: Rewrite the route**

Validate `id` with Zod UUID. Load attachment fields plus `requestId` and `solution.requestId`. Return 404 when absent, 403 when `canUserViewRequest` is false, and 404 when the physical file is absent. Return the original DB filename through `buildContentDisposition`.

- [ ] **Step 7: Run focused tests**

Run: `npx tsx --test tests/regression/content-disposition.test.ts tests/regression/private-file-access.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/request-access.ts src/lib/attachments/content-disposition.ts src/app/api/files/download/route.ts tests/regression/content-disposition.test.ts tests/regression/private-file-access.test.ts
git commit -m "fix: authorize private attachment downloads"
```

---

### Task 6: Convert Preview and Download Callers to Attachment IDs

**Files:**

- Modify: `src/lib/file-preview.ts`
- Modify: `src/components/requests/request-detail-modal.tsx`
- Modify: `src/components/requests/request-modal-router.tsx`
- Modify: `src/components/requests/request-detail-modal.tsx`
- Modify: `src/components/requests/request-modal-router.tsx`
- Modify: `tests/regression/file-preview.test.ts`

**Interfaces:**

- Consumes: ID-based route from Task 4.
- Produces: `getFileAccessUrl(fileId, disposition)`, `getFilePreviewUrl(fileId)`, and `getFileDownloadUrl(fileId)`.

- [ ] **Step 1: Change preview URL tests to the ID contract**

```ts
it('builds API preview URLs from attachment IDs', () => {
  const id = '11111111-1111-1111-1111-111111111111'
  assert.equal(getFilePreviewUrl(id), `/api/files/download?id=${id}&disposition=inline`)
  assert.equal(getFileDownloadUrl(id), `/api/files/download?id=${id}&disposition=attachment`)
  assert.equal(getFilePreviewUrl(null), null)
})
```

Remove the old path-normalization expectation.

- [ ] **Step 2: Run the preview test and confirm failure**

Run: `npx tsx --test tests/regression/file-preview.test.ts`
Expected: FAIL because helpers still accept paths.

- [ ] **Step 3: Implement ID-based helpers**

Validate non-empty IDs and build only the authorized API URL. Remove `normalizeStoredFilePath` from the public interface.

- [ ] **Step 4: Update all callers**

Pass `file.id`, never `file.filePath`, into preview/download helpers. Replace direct fetches to `?path=`. Preserve modal callback signatures `(fileId: string) => void`.

- [ ] **Step 5: Prove no public or path-based links remain**

Run:

```bash
grep -R "api/files/download?path\|getFileUrl\|href=.*uploads/" src
```

Expected: no matches.

- [ ] **Step 6: Run preview and export tests**

Run: `npx tsx --test tests/regression/file-preview.test.ts tests/regression/export-package.test.ts tests/regression/pdf-package.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/file-preview.ts src/components/requests tests/regression/file-preview.test.ts
git commit -m "refactor: use attachment ids for file access"
```

---

### Task 7: Preserve the Docker Volume and Operational Backups

**Files:**

- Modify: `Dockerfile`
- Modify: `docker-compose.yml`
- Modify: `docker-compose.dev.yml`
- Modify: `docker-compose.prod.yml`
- Modify: `scripts/backup.sh`
- Modify: `scripts/restore.sh`
- Modify: `.env.example`
- Create: `tests/regression/upload-runtime-config.test.ts`

**Interfaces:**

- Consumes: `UPLOAD_DIR` contract from Task 2.
- Produces: Docker mount `/app/uploads` backed by the existing `uploads_data` volume.

- [ ] **Step 1: Write failing configuration assertions**

The test must assert:

```ts
assert.match(dockerfile, /RUN mkdir -p \/app\/uploads && chown nextjs:nodejs \/app\/uploads/)
for (const compose of [baseCompose, devCompose, prodCompose]) {
  assert.match(compose, /uploads_data:\/app\/uploads/)
  assert.doesNotMatch(compose, /uploads_data:\/app\/public\/uploads/)
}
assert.match(envExample, /UPLOAD_DIR="?\/app\/uploads"?/)
assert.match(backup, /\/app\/uploads/)
assert.match(restore, /\/app\/uploads/)
```

- [ ] **Step 2: Run the test and confirm public mounts fail it**

Run: `npx tsx --test tests/regression/upload-runtime-config.test.ts`
Expected: FAIL on Dockerfile and Compose paths.

- [ ] **Step 3: Change the image and Compose mounts**

Create/chown `/app/uploads` in the runner. Mount the existing `uploads_data` volume there in all Compose files. Set `UPLOAD_DIR=/app/uploads` in app service environment where `.env.production` is not guaranteed.

- [ ] **Step 4: Update backup and restore scripts**

When `approval-app` exists, use `--volumes-from` and archive `/app/uploads`. During transition, detect `/app/public/uploads` only when `/app/uploads` is absent. When the app container is absent, resolve the actual Compose volume name with `docker compose config --volumes` plus `docker volume ls`, rather than mounting literal `uploads_data` blindly.

- [ ] **Step 5: Run shell and configuration tests**

Run: `bash -n scripts/backup.sh scripts/restore.sh && npx tsx --test tests/regression/upload-runtime-config.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add Dockerfile docker-compose.yml docker-compose.dev.yml docker-compose.prod.yml scripts/backup.sh scripts/restore.sh .env.example tests/regression/upload-runtime-config.test.ts
git commit -m "fix: persist attachments in private volume"
```

---

### Task 8: Align Next.js, Runtime Config, and Proxy Documentation

**Files:**

- Delete: `next.config.ts`
- Create: `next.config.mjs`
- Modify: `Dockerfile`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `DEPLOY.md`
- Modify: `docs/DEPLOY.md`
- Modify: `tests/regression/upload-runtime-config.test.ts`

**Interfaces:**

- Consumes: 10 MB policy from Task 1.
- Produces: 15 MB Server Action transport limit available to `next start` in the runner.

- [ ] **Step 1: Extend the failing runtime configuration test**

Assert `next.config.mjs` contains nested `experimental.serverActions.bodySizeLimit: '15mb'`, Dockerfile copies it to the runner, `next.config.ts` is absent, package.json pins `next` to `15.5.23`, and docs contain `client_max_body_size 15m;` plus the 10 MB/15 MB explanation.

- [ ] **Step 2: Run the test and confirm failure**

Run: `npx tsx --test tests/regression/upload-runtime-config.test.ts`
Expected: FAIL because the MJS config and Docker copy are absent.

- [ ] **Step 3: Replace the runtime config**

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    optimizePackageImports: ['lucide-react'],
    serverActions: { bodySizeLimit: '15mb' },
  },
  async rewrites() {
    return [{ source: '/requests', destination: '/requests' }]
  },
}

export default nextConfig
```

Delete `next.config.ts`. Add `COPY --from=builder /app/next.config.mjs ./` in the runner.

- [ ] **Step 4: Align Next and SWC**

Run: `npm install --save-exact next@15.5.23`
Expected: package.json pins `15.5.23`, lockfile Next and all `@next/swc-*` entries use `15.5.23`.

Add the canonical repository check required after code changes:

```json
{
  "scripts": {
    "check": "npx tsc --noEmit && npm run test:manage && npx tsx --test tests/regression/*.test.ts"
  }
}
```

- [ ] **Step 5: Document reverse-proxy configuration**

Add an Nginx production example with `client_max_body_size 15m;`, forwarded host/protocol headers, and a note that the application rejects files over 10 MB. State that direct `/uploads/` serving is obsolete and should be denied.

- [ ] **Step 6: Run runtime test and production build**

Run: `npx tsx --test tests/regression/upload-runtime-config.test.ts && npm run build`
Expected: PASS and no `Mismatching @next/swc version` warning.

- [ ] **Step 7: Commit**

```bash
git add next.config.ts next.config.mjs Dockerfile package.json package-lock.json DEPLOY.md docs/DEPLOY.md tests/regression/upload-runtime-config.test.ts
git commit -m "fix: align upload transport limits"
```

---

### Task 9: Full Storage Verification and Graph Refresh

**Files:**

- Verify all files changed by Tasks 1–7.
- Update generated graph: `graphify-out/`.

**Interfaces:**

- Consumes: all previous task interfaces.
- Produces: verified private-storage foundation for the solution-upload reliability plan.

- [ ] **Step 1: Run focused attachment tests**

Run:

```bash
npx tsx --test \
  tests/regression/attachment-policy.test.ts \
  tests/regression/attachment-storage.test.ts \
  tests/regression/content-disposition.test.ts \
  tests/regression/private-storage-wiring.test.ts \
  tests/regression/private-file-access.test.ts \
  tests/regression/file-preview.test.ts \
  tests/regression/upload-runtime-config.test.ts \
  tests/regression/pdf-package.test.ts
```

Expected: all pass.

- [ ] **Step 2: Run repository checks**

Run:

```bash
npm run check
npm run build
git diff --check
```

Expected: zero failures and no Next/SWC mismatch warning. Database-unavailable logging during local static generation must be recorded separately and must not be confused with attachment failures.

- [ ] **Step 3: Validate Compose when Docker is available**

Run:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml config --quiet
docker build --target runner -t approval-app:attachment-storage-test .
docker run --rm approval-app:attachment-storage-test test -f /app/next.config.mjs
UPLOAD_TEST_VOLUME="approval_upload_test_$$"
docker volume create "$UPLOAD_TEST_VOLUME"
docker run --rm -v "$UPLOAD_TEST_VOLUME:/app/uploads" approval-app:attachment-storage-test sh -c 'printf persisted > /app/uploads/probe.txt'
docker run --rm -v "$UPLOAD_TEST_VOLUME:/app/uploads" approval-app:attachment-storage-test test -s /app/uploads/probe.txt
docker volume rm "$UPLOAD_TEST_VOLUME"
```

Expected: all commands exit 0, proving the non-root app user can write and a recreated container reads the same volume data. If Docker is unavailable, record this release gate as pending rather than claiming it passed.

- [ ] **Step 4: Refresh Graphify**

Run: `graphify update .`
Expected: graph updated without shrinking/corruption warnings.

- [ ] **Step 5: Commit generated graph updates if tracked**

```bash
git add graphify-out
git commit -m "chore: refresh repository graph"
```

Skip the commit only if Graphify produces no tracked changes.
