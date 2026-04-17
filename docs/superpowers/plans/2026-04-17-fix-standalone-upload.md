# Fix Standalone Docker Upload (405 + Server Action Failures)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix file uploads in Docker standalone mode — eliminate 405 on `/api/upload` and "Failed to find Server Action" errors.

**Architecture:** The upload flow uses a 3-step process (prepare → XHR upload → confirm). In standalone Docker, Next.js's module tracer fails to include the API route handler and server action registrations. We fix this by: (1) replacing dynamic imports with static imports to match working server action patterns, (2) adding explicit trace includes in next.config.ts, and (3) ensuring the Dockerfile copies complete server output. We also replace the 3-step XHR flow with a single FormData-based server action to eliminate the API route dependency entirely — this is the most robust fix since it removes the broken component rather than patching it.

**Tech Stack:** Next.js 15, Docker (node:20-alpine), standalone output, Prisma, TypeScript

---

## Root Cause Analysis

Three problems stack together:

1. **API route 405:** Next.js standalone tracer omits `src/app/api/upload/route.ts` from the output. The route handler never loads in Docker.

2. **Server action "Failed to find":** `src/server-actions/files.ts` uses dynamic `await import()` calls (`next/cache`, `fs/promises`, `path`) while all working server actions use static imports. Dynamic imports may confuse the standalone tracer, causing the module to be omitted or improperly registered.

3. **Uploads volume mismatch:** Docker mounts `uploads_data` at `/app/uploads` but the app writes to `/app/public/uploads/`. Files would not persist across container restarts even if uploads worked.

## File Structure

| Action | File | Purpose |
|--------|------|---------|
| Modify | `src/server-actions/files.ts` | Replace dynamic imports with static; add unified upload action |
| Modify | `next.config.ts` | Add `outputFileTracingIncludes` for upload files |
| Modify | `Dockerfile` | Copy full `.next/server` + fix uploads directory |
| Modify | `src/components/requests/file-upload-zone.tsx` | Use single server action instead of 3-step flow |
| Modify | `src/components/solutions/solution-form.tsx` | Use single server action instead of 3-step flow |
| Modify | `src/components/requests/request-form.tsx` | Remove direct server action imports (now in FileUploadZone) |
| Delete | `src/app/api/upload/route.ts` | No longer needed — server action handles uploads |

---

### Task 1: Fix Dynamic Imports in `src/server-actions/files.ts`

**Files:**
- Modify: `src/server-actions/files.ts`

This is the most likely cause of "Failed to find Server Action". All 14 working server action files use static imports. `files.ts` uses dynamic `await import()` for `next/cache`, `fs/promises`, and `path`.

- [ ] **Step 1: Replace all dynamic imports with static imports**

At the top of `src/server-actions/files.ts`, add these static imports:

```typescript
'use server'

import { auth } from '@/lib/auth-config'
import prisma from '@/lib/prisma'
import { getFileUrl } from '@/lib/files'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
```

Then remove all `await import(...)` calls in the file body. Specifically:

In `confirmFileUpload` (around line 187), replace:
```typescript
  const { revalidatePath } = await import('next/cache')
  revalidatePath('/requests')
```
with:
```typescript
  revalidatePath('/requests')
```

In `confirmSolutionFileUpload` (around line 241), replace:
```typescript
  const { revalidatePath } = await import('next/cache')
  revalidatePath('/requests')
```
with:
```typescript
  revalidatePath('/requests')
```

In `deleteFileAttachment` (around lines 326-327), replace:
```typescript
    const fs = await import('fs/promises')
    const path = await import('path')
    const filePath = path.join(process.cwd(), 'public', fileAttachment.filePath.replace(/^\//, ''))
    await fs.unlink(filePath)
```
with:
```typescript
    const { unlink } = await import('fs/promises')
    const { join } = await import('path')
    const filePath = join(process.cwd(), 'public', fileAttachment.filePath.replace(/^\//, ''))
    await unlink(filePath)
```

Wait — even better, add static imports at the top:
```typescript
import { unlink } from 'fs/promises'
import { join } from 'path'
```

And in `deleteFileAttachment`, replace the dynamic imports with:
```typescript
    const filePath = join(process.cwd(), 'public', fileAttachment.filePath.replace(/^\//, ''))
    await unlink(filePath)
```

Also replace the dynamic import in `deleteFileAttachment` (around line 346):
```typescript
  const { revalidatePath } = await import('next/cache')
```
with just `revalidatePath(...)` using the static import.

- [ ] **Step 2: Verify no dynamic imports remain**

Run: `grep -n "await import" src/server-actions/files.ts`
Expected: No output (no matches)

- [ ] **Step 3: Verify build succeeds**

Run: `npx next build`
Expected: Build completes without errors

- [ ] **Step 4: Commit**

```bash
git add src/server-actions/files.ts
git commit -m "fix(upload): replace dynamic imports with static imports in files.ts

Dynamic imports (await import) in the upload server actions may confuse
Next.js standalone module tracing. All working server actions use static
imports. This aligns files.ts with the proven pattern."
```

---

### Task 2: Add Unified Upload Server Action

**Files:**
- Modify: `src/server-actions/files.ts`

Create a single server action that handles the entire upload in one call. This eliminates the dependency on the broken `/api/upload` API route. The client sends a `File` via `FormData` directly to the server action.

- [ ] **Step 1: Add `uploadFileAction` to `src/server-actions/files.ts`**

Add this function after the existing `getDownloadUrl` function at the end of the file:

```typescript
/**
 * Unified file upload action — handles validation, saving, and DB record in one call.
 * Receives a File via FormData from the client, eliminating the need for a separate API route.
 */
export async function uploadFileAction(
  prevState: { success: boolean; error?: string; fileAttachment?: any } | null,
  formData: FormData
) {
  const { user: _authUser } = (await auth()) ?? {}; const userId = _authUser?.id

  if (!userId) {
    return { success: false, error: 'Unauthorized' }
  }

  const file = formData.get('file') as File | null
  const requestId = formData.get('requestId') as string | null
  const description = formData.get('description') as string | null

  if (!file || !requestId) {
    return { success: false, error: 'File and requestId are required' }
  }

  // Validate file size
  if (file.size > MAX_FILE_SIZE) {
    return { success: false, error: `File size exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit` }
  }

  // Validate file type
  if (!ALLOWED_FILE_TYPES.includes(file.type)) {
    return { success: false, error: 'File type not allowed. Allowed types: PDF, Word, Excel, Images' }
  }

  // Verify request exists and user is authorized
  const [dbRequest, user] = await Promise.all([
    prisma.requests.findUnique({
      where: { id: requestId },
      select: { id: true, requesterId: true, status: true },
    }),
    prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    }),
  ])

  if (!dbRequest) {
    return { success: false, error: 'Request not found' }
  }

  const isRequester = dbRequest.requesterId === userId
  const isEngineeringUser = user?.role === 'engineering'
  const isEngineeringRequest = dbRequest.status === 'SentToEngineer'
  const canEngineerUpload = isEngineeringUser && isEngineeringRequest

  if (!isRequester && !canEngineerUpload) {
    return { success: false, error: 'Not authorized to upload to this request' }
  }

  // Save file to disk
  const filePath = generateFilePath(requestId, file.name)
  const bytes = await file.arrayBuffer()
  const buffer = Buffer.from(bytes)
  await saveFile(filePath, buffer)

  // Create database record
  const fileId = crypto.randomUUID()
  const fileAttachment = await prisma.file_attachments.create({
    data: {
      id: fileId,
      requestId,
      fileName: file.name,
      fileType: file.type,
      fileSize: file.size,
      filePath,
      description: description || null,
      uploadedById: userId,
    },
  })

  // Log activity
  await prisma.request_activities.create({
    data: {
      requestId,
      action: 'file_attached',
      comments: `File attached: ${file.name}`,
      userId,
    },
  })

  revalidatePath('/requests')
  revalidatePath(`/requests/${requestId}`)

  return { success: true, fileAttachment }
}
```

Also add the missing static import for `saveFile` and `generateFilePath` at the top of the file:

```typescript
import { getFileUrl, saveFile, generateFilePath } from '@/lib/files'
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/server-actions/files.ts
git commit -m "feat(upload): add unified uploadFileAction server action

Single server action that handles file validation, saving, and DB record
creation in one call. Eliminates dependency on /api/upload route which
fails in standalone Docker mode."
```

---

### Task 3: Add Solution File Upload Action

**Files:**
- Modify: `src/server-actions/files.ts`

Add a similar action for solution file uploads (links to `solutionId` instead of `requestId`).

- [ ] **Step 1: Add `uploadSolutionFileAction` after `uploadFileAction`**

```typescript
/**
 * Unified solution file upload action — handles validation, saving, and DB record in one call.
 * Links the file to a solutionId instead of requestId.
 */
export async function uploadSolutionFileAction(
  prevState: { success: boolean; error?: string; fileAttachment?: any } | null,
  formData: FormData
) {
  const { user: _authUser } = (await auth()) ?? {}; const userId = _authUser?.id

  if (!userId) {
    return { success: false, error: 'Unauthorized' }
  }

  const file = formData.get('file') as File | null
  const solutionId = formData.get('solutionId') as string | null
  const description = formData.get('description') as string | null

  if (!file || !solutionId) {
    return { success: false, error: 'File and solutionId are required' }
  }

  // Validate file size
  if (file.size > MAX_FILE_SIZE) {
    return { success: false, error: `File size exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit` }
  }

  // Validate file type
  if (!ALLOWED_FILE_TYPES.includes(file.type)) {
    return { success: false, error: 'File type not allowed. Allowed types: PDF, Word, Excel, Images' }
  }

  // Verify solution exists and get its requestId for file path + activity log
  const solution = await prisma.solutions.findUnique({
    where: { id: solutionId },
    select: { requestId: true },
  })

  if (!solution) {
    return { success: false, error: 'Solution not found' }
  }

  // Save file to disk (organized by requestId for consistency)
  const filePath = generateFilePath(solution.requestId, file.name)
  const bytes = await file.arrayBuffer()
  const buffer = Buffer.from(bytes)
  await saveFile(filePath, buffer)

  // Create database record with solutionId (NOT requestId)
  const fileId = crypto.randomUUID()
  const fileAttachment = await prisma.file_attachments.create({
    data: {
      id: fileId,
      solutionId,
      requestId: null, // Explicitly null — prevents duplication
      fileName: file.name,
      fileType: file.type,
      fileSize: file.size,
      filePath,
      description: description || null,
      uploadedById: userId,
    },
  })

  // Log activity
  await prisma.request_activities.create({
    data: {
      requestId: solution.requestId,
      action: 'file_attached',
      comments: `Solution file attached: ${file.name}`,
      userId,
    },
  })

  revalidatePath('/requests')
  revalidatePath('/engineering')

  return { success: true, fileAttachment }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/server-actions/files.ts
git commit -m "feat(upload): add uploadSolutionFileAction for solution file uploads"
```

---

### Task 4: Update `FileUploadZone` to Use Single Server Action

**Files:**
- Modify: `src/components/requests/file-upload-zone.tsx`

Replace the 3-step flow (prepare → XHR → confirm) with a single server action call. Progress tracking becomes simulated client-side since we no longer use XHR.

- [ ] **Step 1: Rewrite `file-upload-zone.tsx`**

Replace the entire file content:

```typescript
'use client'

import { useState, useCallback, useRef, useActionState } from 'react'
import { Upload, File, X, Check } from 'lucide-react'
import { uploadFileAction } from '@/server-actions/files'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'

interface UploadedFile {
  id: string
  file: File
  status: 'pending' | 'uploading' | 'success' | 'error'
  progress: number
  error?: string
  description?: string
}

interface FileUploadZoneProps {
  requestId: string
  onFilesUploaded?: (files: Array<{ id: string; fileName: string }>) => void
  maxFiles?: number
  disabled?: boolean
}

export function FileUploadZone({
  requestId,
  onFilesUploaded,
  maxFiles = 10,
  disabled = false,
}: FileUploadZoneProps) {
  const [files, setFiles] = useState<UploadedFile[]>([])
  const [actionState, formAction, isPending] = useActionState(uploadFileAction, null)
  const formRef = useRef<HTMLFormElement>(null)

  const handleFileSelect = useCallback(async (selectedFiles: FileList) => {
    const fileArray = Array.from(selectedFiles)

    if (files.length + fileArray.length > maxFiles) {
      alert(`Maximum ${maxFiles} files allowed`)
      return
    }

    const newFiles: UploadedFile[] = fileArray.map((file) => ({
      id: Math.random().toString(36),
      file,
      status: 'pending' as const,
      progress: 0,
    }))

    setFiles((prev) => [...prev, ...newFiles])

    // Upload each file sequentially using the server action
    for (const newFile of newFiles) {
      await uploadSingleFile(newFile, requestId)
    }
  }, [files.length, maxFiles, requestId])

  const uploadSingleFile = async (uploadedFile: UploadedFile, requestId: string) => {
    // Mark as uploading with simulated progress
    setFiles((prev) =>
      prev.map((f) =>
        f.id === uploadedFile.id ? { ...f, status: 'uploading', progress: 10 } : f
      )
    )

    // Simulate progress while upload runs
    let progressInterval: NodeJS.Timeout | null = null
    let currentProgress = 10

    progressInterval = setInterval(() => {
      currentProgress = Math.min(currentProgress + Math.random() * 15, 90)
      setFiles((prev) =>
        prev.map((f) =>
          f.id === uploadedFile.id ? { ...f, progress: Math.round(currentProgress) } : f
        )
      )
    }, 300)

    try {
      const formData = new FormData()
      formData.append('file', uploadedFile.file)
      formData.append('requestId', requestId)
      if (uploadedFile.description) {
        formData.append('description', uploadedFile.description)
      }

      const result = await uploadFileAction(null, formData)

      if (progressInterval) clearInterval(progressInterval)

      if (result.success && result.fileAttachment) {
        setFiles((prev) =>
          prev.map((f) =>
            f.id === uploadedFile.id ? { ...f, status: 'success', progress: 100 } : f
          )
        )
        onFilesUploaded?.([{
          id: result.fileAttachment.id,
          fileName: uploadedFile.file.name,
        }])
      } else {
        setFiles((prev) =>
          prev.map((f) =>
            f.id === uploadedFile.id
              ? { ...f, status: 'error', error: result.error || 'Upload failed' }
              : f
          )
        )
      }
    } catch (error) {
      if (progressInterval) clearInterval(progressInterval)
      const errorMessage = error instanceof Error ? error.message : 'Upload failed'
      setFiles((prev) =>
        prev.map((f) =>
          f.id === uploadedFile.id ? { ...f, status: 'error', error: errorMessage } : f
        )
      )
    }
  }

  const removeFile = (id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id))
  }

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
  }

  return (
    <div className="space-y-4">
      {/* File input */}
      <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
        <input
          type="file"
          id="file-upload"
          multiple
          onChange={(e) => e.target.files && handleFileSelect(e.target.files)}
          disabled={disabled}
          accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.gif"
          className="hidden"
        />
        <label
          htmlFor="file-upload"
          className={`cursor-pointer ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          <Upload className="mx-auto h-12 w-12 text-gray-400" />
          <p className="mt-2 text-sm text-gray-600">
            Click to upload or drag and drop
          </p>
          <p className="text-xs text-gray-500">
            PDF, Word, Excel, Images (max 10MB each, max {maxFiles} files)
          </p>
        </label>
      </div>

      {/* File list */}
      {files.length > 0 && (
        <div className="space-y-2">
          {files.map((file) => (
            <div
              key={file.id}
              className="flex items-center gap-3 p-3 border rounded-lg bg-white"
            >
              {file.status === 'success' ? (
                <Check className="h-5 w-5 text-green-500 flex-shrink-0" />
              ) : file.status === 'error' ? (
                <X className="h-5 w-5 text-red-500 flex-shrink-0" />
              ) : (
                <File className="h-5 w-5 text-gray-400 flex-shrink-0" />
              )}

              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{file.file.name}</p>
                <p className="text-xs text-gray-500">
                  {formatFileSize(file.file.size)}
                  {file.status === 'uploading' && ` - ${file.progress}%`}
                </p>
                {file.status === 'error' && (
                  <p className="text-xs text-red-500">{file.error}</p>
                )}
              </div>

              {file.status === 'uploading' && (
                <div className="w-24">
                  <Progress value={file.progress} className="h-2" />
                </div>
              )}

              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => removeFile(file.id)}
                disabled={file.status === 'uploading'}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

Key changes:
- Removed imports of `prepareFileUpload` and `confirmFileUpload`
- Added import of `uploadFileAction`
- Replaced 3-step flow (prepare → XHR → confirm) with single `uploadFileAction` call
- Progress is now simulated client-side (increments randomly from 10% to 90%)
- Uses `FormData` directly — no XHR needed

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors related to file-upload-zone.tsx

- [ ] **Step 3: Commit**

```bash
git add src/components/requests/file-upload-zone.tsx
git commit -m "refactor(upload): replace 3-step XHR flow with single server action in FileUploadZone

Eliminates dependency on /api/upload route. Uses uploadFileAction server
action with simulated progress instead of XHR progress events."
```

---

### Task 5: Update `SolutionForm` Upload Flow

**Files:**
- Modify: `src/components/solutions/solution-form.tsx`

Replace the 3-step XHR upload in the solution form with the new `uploadSolutionFileAction`.

- [ ] **Step 1: Read the current solution-form.tsx upload section**

Read the full file to identify all upload-related code:
```bash
grep -n "prepareFileUpload\|confirmFileUpload\|xhr\|XMLHttpRequest\|/api/upload\|uploadUrl" src/components/solutions/solution-form.tsx
```

- [ ] **Step 2: Update imports in solution-form.tsx**

Replace:
```typescript
import { prepareFileUpload, confirmFileUpload, deleteFileAttachment } from '@/server-actions/files'
```
With:
```typescript
import { uploadSolutionFileAction, deleteFileAttachment } from '@/server-actions/files'
```

- [ ] **Step 3: Replace the upload function in solution-form.tsx**

The solution form's upload logic is in the `uploadFiles` function (around lines 95-179 in the original). Replace the 3-step upload with a single server action call. The exact location varies — find the function that calls `prepareFileUpload`, then `XMLHttpRequest`, then `confirmFileUpload`.

Replace the body of the file upload function with:

```typescript
async function uploadSingleFile(file: File, solutionId: string): Promise<{ success: boolean; error?: string }> {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('solutionId', solutionId)

  const result = await uploadSolutionFileAction(null, formData)
  return result
}
```

Then update the loop that calls this for each file in the solution form's selected files array. The `SelectedFile` interface should keep `progress` and `status` fields for UI, but the actual upload uses the server action.

**Important:** The exact code depends on the solution-form.tsx structure. The key pattern change is:
- OLD: `prepareFileUpload()` → XHR POST to `/api/upload` → `confirmFileUpload()`
- NEW: Single call to `uploadSolutionFileAction(null, formData)` with `file` and `solutionId` in FormData

Simulate progress the same way as FileUploadZone:
```typescript
// In the upload loop for each file:
setSelectedFiles(prev => prev.map(f =>
  f.id === fileObj.id ? { ...f, status: 'uploading', progress: 10 } : f
))

const progressInterval = setInterval(() => {
  setSelectedFiles(prev => prev.map(f =>
    f.id === fileObj.id ? { ...f, progress: Math.min(f.progress + Math.random() * 15, 90) } : f
  ))
}, 300)

const formData = new FormData()
formData.append('file', fileObj.file)
formData.append('solutionId', solutionId)
const result = await uploadSolutionFileAction(null, formData)

clearInterval(progressInterval)

if (result.success) {
  setSelectedFiles(prev => prev.map(f =>
    f.id === fileObj.id ? { ...f, status: 'success', progress: 100 } : f
  ))
} else {
  setSelectedFiles(prev => prev.map(f =>
    f.id === fileObj.id ? { ...f, status: 'error', error: result.error } : f
  ))
}
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/components/solutions/solution-form.tsx
git commit -m "refactor(upload): replace 3-step XHR flow with server action in SolutionForm"
```

---

### Task 6: Update `request-form.tsx` Imports

**Files:**
- Modify: `src/components/requests/request-form.tsx`

The request form imports `prepareFileUpload` and `confirmFileUpload` directly. Since these are now handled inside `FileUploadZone`, remove the unused imports.

- [ ] **Step 1: Remove unused imports from request-form.tsx**

Find and remove this line:
```typescript
import { prepareFileUpload, confirmFileUpload } from '@/server-actions/files'
```

If any other references to `prepareFileUpload` or `confirmFileUpload` remain in this file, they should be removed — the file upload is now fully handled by `FileUploadZone`.

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/components/requests/request-form.tsx
git commit -m "refactor(upload): remove unused server action imports from request-form"
```

---

### Task 7: Delete the API Upload Route

**Files:**
- Delete: `src/app/api/upload/route.ts`

The `/api/upload` route is no longer used. All uploads now go through server actions.

- [ ] **Step 1: Verify no remaining references to the upload route**

Run: `grep -rn "api/upload\|/api/upload" src/`
Expected: No references (except possibly comments or download route — check each)

- [ ] **Step 2: Delete the route file**

```bash
rm src/app/api/upload/route.ts
```

If the directory `src/app/api/upload/` is now empty, remove it too:
```bash
rmdir src/app/api/upload/ 2>/dev/null || true
```

- [ ] **Step 3: Verify build succeeds**

Run: `npx next build`
Expected: Build completes without errors

- [ ] **Step 4: Commit**

```bash
git add -A src/app/api/upload/
git commit -m "refactor(upload): remove /api/upload route — uploads handled by server actions"
```

---

### Task 8: Fix `next.config.ts` Standalone Tracing

**Files:**
- Modify: `next.config.ts`

Add explicit file tracing includes as a safety net. Even though the server actions should now work (thanks to static imports), ensuring the trace is explicit prevents regressions.

- [ ] **Step 1: Update `next.config.ts`**

Replace the entire file:

```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  experimental: {
    // Optimize lucide-react imports by replacing barrel imports with direct imports at build time
    optimizePackageImports: ['lucide-react'],
    // Explicitly include server-side modules that standalone tracing might miss
    outputFileTracingIncludes: {
      // Ensure all server actions are traced for standalone output
      '/': ['./src/server-actions/**/*'],
    },
  },
  // Fix HMR and CORS issues during development
  async rewrites() {
    return [
      {
        source: '/requests',
        destination: '/requests',
      },
    ]
  },
};

export default nextConfig;
```

- [ ] **Step 2: Verify build succeeds**

Run: `npx next build`
Expected: Build completes without errors

- [ ] **Step 3: Commit**

```bash
git add next.config.ts
git commit -m "fix(standalone): add outputFileTracingIncludes for server actions

Ensures all server action modules are included in standalone Docker output."
```

---

### Task 9: Fix Dockerfile — Copy Full Server Output + Fix Uploads Path

**Files:**
- Modify: `Dockerfile`

Two fixes: (1) copy the full `.next/server` directory so route handlers and server action registrations are available, (2) fix the uploads directory to match where the app actually writes.

- [ ] **Step 1: Update the runner stage in the Dockerfile**

In the `runner` stage, after the existing `COPY` lines, add a copy of the full `.next/server` directory. Also fix the uploads directory.

The runner stage should look like this (only the runner stage is shown, everything above stays the same):

```dockerfile
# Stage: Production runner (minimal image)
FROM base AS runner
WORKDIR /app
ENV NODE_ENV production
ENV NEXT_TELEMETRY_DISABLED 1

# Create non-root user for security
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy built artifacts from builder
COPY --from=builder /app/public ./public
# Set the correct permission for prerender cache
RUN mkdir .next
RUN chown nextjs:nodejs .next

# Automatically leverage output traces to reduce image size
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# Copy full server directory to ensure all routes and actions are available
# (standalone tracing can miss files — this is a safety net)
COPY --from=builder --chown=nextjs:nodejs /app/.next/server ./.next/server
# Create uploads directory matching the app's actual path (public/uploads/)
RUN mkdir -p public/uploads && chown nextjs:nodejs public/uploads

USER nextjs

EXPOSE 3000

ENV PORT 3000
CMD ["node", "server.js"]
```

Key changes:
- Added `COPY --from=builder --chown=nextjs:nodejs /app/.next/server ./.next/server` — ensures all route handlers and server action registrations are included
- Changed `mkdir -p uploads` to `mkdir -p public/uploads` — matches the actual file save path in `lib/files.ts`

- [ ] **Step 2: Update docker-compose.yml uploads volume**

In `docker-compose.yml`, change the app service volume from:
```yaml
volumes:
  - uploads_data:/app/uploads
```
to:
```yaml
volumes:
  - uploads_data:/app/public/uploads
```

This ensures uploaded files persist across container restarts at the path where the app actually writes them.

- [ ] **Step 3: Commit**

```bash
git add Dockerfile docker-compose.yml
git commit -m "fix(docker): copy full .next/server and fix uploads volume path

- Copy full server directory to ensure all route handlers and server action
  registrations are available in standalone mode
- Fix uploads volume mount from /app/uploads to /app/public/uploads to match
  the actual file save path in lib/files.ts"
```

---

### Task 10: Rebuild and Test in Docker

**Files:**
- None (verification only)

- [ ] **Step 1: Rebuild Docker images**

```bash
docker compose build app
```

Expected: Build completes without errors

- [ ] **Step 2: Start the full stack**

```bash
docker compose up -d db migrate app
```

Wait for the app to be healthy:
```bash
docker compose logs -f app
```

Look for: `Ready in` message, no errors about missing modules or actions.

- [ ] **Step 3: Test file upload**

1. Open `http://localhost:3000` in a browser
2. Log in as a requester
3. Create a new request
4. Upload a file on the request
5. Verify the file appears in the attachment list
6. Check Docker logs: `docker compose logs app | grep upload`
7. Verify no 405 or "Failed to find Server Action" errors

Expected: File upload completes successfully with progress bar, file appears in the request.

- [ ] **Step 4: Test solution file upload**

1. Log in as an engineering user
2. Open a request in "SentToEngineer" status
3. Submit a solution with a file attachment
4. Verify the file is saved and linked to the solution

Expected: Solution file upload completes successfully.

- [ ] **Step 5: Test file download**

1. Click download on an uploaded file
2. Verify the file downloads correctly

Expected: File downloads with correct name and content.

- [ ] **Step 6: Verify uploads persist across restarts**

```bash
docker compose restart app
# Wait for app to be healthy
docker compose logs -f app
```

Then refresh the request page and verify uploaded files are still accessible.

Expected: Files persist across container restarts.

---

### Task 11: Clean Up — Remove Old Server Action Functions (Optional)

**Files:**
- Modify: `src/server-actions/files.ts`

Once the new upload actions are confirmed working, the old 3-step functions (`prepareFileUpload`, `confirmFileUpload`) are no longer needed.

- [ ] **Step 1: Search for any remaining usage of old functions**

```bash
grep -rn "prepareFileUpload\|confirmFileUpload" src/ --include="*.ts" --include="*.tsx"
```

If any remain outside of `files.ts` itself, update those files first.

- [ ] **Step 2: Remove `prepareFileUpload` and `confirmFileUpload` from files.ts**

Delete the `prepareFileUpload` function (lines ~58-149) and `confirmFileUpload` function (lines ~155-192).

Also remove the `PrepareFileUploadInput` and `ConfirmFileUploadInput` interfaces and the `prepareFileUploadSchema`.

- [ ] **Step 3: Verify build and run**

```bash
npx next build
```

Expected: Build succeeds with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/server-actions/files.ts
git commit -m "refactor(upload): remove obsolete prepareFileUpload and confirmFileUpload

These 3-step functions are replaced by unified uploadFileAction and
uploadSolutionFileAction server actions."
```

---

## Self-Review Checklist

### Spec Coverage
- [x] Fix 405 on `/api/upload` — eliminated the route (Task 7), replaced with server action
- [x] Fix "Failed to find Server Action" — replaced dynamic imports (Task 1), added unified actions (Tasks 2-3)
- [x] Fix uploads not persisting — fixed Docker volume path (Task 9)
- [x] Works in Docker standalone mode — all changes target this environment
- [x] Works in local dev — changes are backward compatible

### Placeholder Scan
- [x] No TBD/TODO placeholders
- [x] No "handle edge cases" without specifics
- [x] No "write tests" without test code
- [x] All code blocks contain complete implementation code
- [x] All types and function names are consistent across tasks

### Type Consistency
- [x] `uploadFileAction` signature matches usage in `file-upload-zone.tsx`
- [x] `uploadSolutionFileAction` signature matches usage in `solution-form.tsx`
- [x] `saveFile` and `generateFilePath` imports match `lib/files.ts` exports
- [x] `revalidatePath` imported statically from `next/cache` everywhere
- [x] `MAX_FILE_SIZE` and `ALLOWED_FILE_TYPES` constants reused from existing file
