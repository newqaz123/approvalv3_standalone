# Phase 02: Core Request Workflow - Research

**Researched:** 2026-01-31
**Domain:** Request creation, file attachments with S3, status tracking with audit trail foundation
**Confidence:** HIGH

## Summary

This phase implements the core request workflow enabling users to create improvement requests with validated forms, upload multiple files securely via AWS S3 presigned URLs, and track request status through a defined workflow. The system establishes the foundation for the approval workflow with timestamped status changes, department associations, and an audit trail pattern that supports future phases.

**Primary recommendations:**
1. Use AWS S3 with presigned URLs for secure file uploads (never route files through Next.js server)
2. Store file metadata in Prisma (key, filename, size, type, description, S3 path) for audit trail
3. Implement RequestStatus enum with all five states (ImprovementRequest, SentToEngineer, DesignCostEstimationApproval, SendBackToRequester, Completed)
4. Use RequestActivity model for audit trail foundation (tracks who changed what, when, with comments)
5. Leverage React Hook Form + Zod with `z.preprocess` for file validation (handle FileList conversion)
6. Build request list with shadcn/ui DataTable and detail modal overlay for status tracking

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| **AWS SDK v3** | Latest | S3 file storage with presigned URLs | Industry standard for cloud storage; presigned URLs enable secure direct uploads without proxying through your server; reduces server load and scales better; excellent TypeScript support |
| **@aws-sdk/client-s3** | Latest | S3 operations (PutObject, GetObject) | Provides S3 client for generating presigned URLs; modular architecture (only import what you use) |
| **@aws-sdk/s3-request-presigner** | Latest | Generate presigned URLs for uploads | Secure URL generation with configurable expiration (default 900s); enforces file type and size via signed headers |
| **Next.js** | 15.1+ | App Router with Server Actions | Server Actions handle presigned URL generation and request creation; form validation with FormData; automatic type safety |
| **Prisma** | 6.19+ | ORM with enum status tracking | Type-safe enums for RequestStatus; relations between Request, FileAttachment, User, Department; timestamp fields (createdAt, updatedAt) for audit trail |
| **shadcn/ui** | Latest | UI components (DataTable, Form, Dialog, Badge) | Pre-built accessible components; DataTable for request list with filtering/sorting; Form components with React Hook Form integration; Dialog for detail modal overlay |
| **React Hook Form** | 7.71+ | Form state management | Handles file inputs with FileList; integrates with Zod for validation; minimal re-renders for better performance |
| **Zod** | 4.3+ | Schema validation | Use `z.preprocess` to convert FileList to File[] before validation; type-safe schema inference for form fields |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| **@hookform/resolvers** | Latest | Zod integration with React Hook Form | Bridges React Hook Form and Zod for type-safe validation |
| **Tailwind CSS** | 3.4+ | Styling | Already in project; use for status badge colors, progress bars, responsive layouts |
| **lucide-react** | Latest | Icons | Status icons, upload icons, action buttons |
| **react-dropzone** | (Optional) | Drag-and-drop file upload | If enhanced drag-drop UX needed beyond basic HTML5 file input |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| AWS S3 presigned URLs | Upload via Server Actions (file to server, then to S3) | Server upload is simpler but worse: server becomes bottleneck, timeout issues with large files, higher server costs, single point of failure. Presigned URLs are production-standard for file uploads. |
| AWS S3 presigned URLs | Cloudflare R2 or Google Cloud Storage | R2 has zero egress fees (cost advantage for high-volume apps), but S3 is more mature with better ecosystem/integration examples. For 30 users, S3 cost difference is negligible. |
| File metadata in Prisma | Store full file content as base64 in database | Base64 encoding increases size by 33%; bloats database; degrades query performance; cannot leverage CDN; not production-viable for document storage. |
| RequestActivity model for audit trail | Single JSONB column for history on Request model | JSONB is simpler initially but harder to query (e.g., "show all actions by user X"); cannot add foreign key constraints; difficult to audit; activity table is queryable and extensible. |

**Installation:**

```bash
# AWS SDK for S3
npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner

# File upload enhancements (optional)
npm install react-dropzone

# Note: Next.js, Prisma, React Hook Form, Zod, shadcn/ui already installed
```

## Architecture Patterns

### Recommended Project Structure

```
src/
├── app/
│   ├── (dashboard)/
│   │   ├── requests/
│   │   │   ├── page.tsx                 # Request list with DataTable
│   │   │   └── new/
│   │   │       └── page.tsx             # Request creation form
│   │   └── dashboard/page.tsx           # Dashboard (created in Phase 1)
├── components/
│   ├── requests/
│   │   ├── request-form.tsx             # Request creation form with file upload
│   │   ├── file-upload-zone.tsx         # Drag-drop file upload component
│   │   ├── file-list.tsx                # Display uploaded files with progress
│   │   ├── request-table.tsx            # DataTable for request list
│   │   ├── request-detail-modal.tsx     # Modal overlay for request details
│   │   └── status-badge.tsx             # Status badge component with colors
│   └── ui/                              # shadcn/ui components
├── lib/
│   ├── s3.ts                            # S3 client and presigned URL utilities
│   ├── prisma.ts                        # Prisma client (already exists)
│   └── utils.ts                         # Helper functions (already exists)
└── server-actions/
    ├── requests.ts                      # Request CRUD Server Actions
    ├── files.ts                         # File upload S3 actions
    └── status.ts                        # Status change actions with audit trail
```

### Pattern 1: S3 Presigned URL for Secure File Uploads

**What:** Generate presigned URLs on the server using AWS SDK, then upload files directly from the browser to S3. Files never touch your Next.js server.

**When to use:** All file uploads in this application (request attachments, solution files).

**Why:** Presigned URLs are temporary, authenticated URLs that grant permission to upload a specific file to a specific S3 location for a limited time. The signature ensures only authorized uploads, expiration limits abuse, and direct browser-to-S3 transfer eliminates server bottleneck.

**Example:**

```typescript
// lib/s3.ts - S3 client setup
import { S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { PutObjectCommand } from '@aws-sdk/client-s3'

// Initialize S3 client with environment credentials
const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
})

// Generate presigned URL for file upload
export async function generateUploadUrl({
  key,
  contentType,
  contentLength,
}: {
  key: string
  contentType: string
  contentLength: number
}) {
  const command = new PutObjectCommand({
    Bucket: process.env.AWS_S3_BUCKET!,
    Key: key,
    ContentType: contentType,
    ContentLength: contentLength,
    // Optional: Add server-side encryption
    // ServerSideEncryption: 'AES256',
  })

  // URL expires in 15 minutes (900 seconds)
  const signedUrl = await getSignedUrl(s3Client, command, {
    expiresIn: 900,
  })

  return signedUrl
}

// Generate presigned URL for file download
export async function generateDownloadUrl(key: string) {
  const command = new GetObjectCommand({
    Bucket: process.env.AWS_S3_BUCKET!,
    Key: key,
  })

  const signedUrl = await getSignedUrl(s3Client, command, {
    expiresIn: 3600, // 1 hour for downloads
  })

  return signedUrl
}
```

**Source:** [AWS SDK for JavaScript v3 Documentation](https://github.com/aws/aws-sdk-js-v3/blob/main/packages/s3-request-presigner/README.md) (HIGH confidence - official AWS documentation)

### Pattern 2: Server Action for Request Creation with File Uploads

**What:** Use Next.js Server Actions to handle request creation. First generate presigned URL, then client uploads directly to S3, then save file metadata to Prisma.

**When to use:** All request creation flows with file attachments.

**Why:** Server Actions maintain auth context via Clerk, eliminate API route boilerplate, and enable type-safe form validation with Zod. Presigned URLs are generated server-side but used client-side for uploads.

**Example:**

```typescript
// server-actions/requests.ts
'use server'

import { auth } from '@clerk/nextjs/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { generateUploadUrl } from '@/lib/s3'

// Zod schema for request validation
const createRequestSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200, 'Title too long'),
  description: z.string().min(1, 'Description is required').max(5000, 'Description too long'),
  // Files are handled separately - see file upload pattern
})

export async function createRequest(formData: FormData) {
  const { userId } = await auth()

  if (!userId) {
    throw new Error('Unauthorized')
  }

  // Get user with department
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { department: true },
  })

  if (!user || !user.departmentId) {
    throw new Error('User must belong to a department')
  }

  // Validate form fields
  const validatedFields = createRequestSchema.safeParse({
    title: formData.get('title'),
    description: formData.get('description'),
  })

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
    }
  }

  // Create request in database
  const request = await prisma.request.create({
    data: {
      title: validatedFields.data.title,
      description: validatedFields.data.description,
      requesterId: userId,
      departmentId: user.departmentId,
      status: 'ImprovementRequest', // Initial status
    },
  })

  // Revalidate cache to refresh request list
  revalidatePath('/requests')

  return { success: true, requestId: request.id }
}
```

**Source:** [Next.js Server Actions Documentation](https://github.com/vercel/next.js/blob/v15.1.8/docs/01-app/02-building-your-application/02-data-fetching/03-server-actions-and-mutations.mdx) (HIGH confidence - official Next.js documentation v15.1.8)

### Pattern 3: File Upload Flow with Presigned URLs

**What:** Multi-step file upload: (1) Client calls Server Action to get presigned URL, (2) Client uploads directly to S3 using fetch/XHR, (3) Client calls Server Action to save file metadata to Prisma.

**When to use:** All file uploads for request attachments.

**Why:** This pattern separates authentication (Server Action) from data transfer (direct to S3). Progress tracking works because upload happens client-side with XHR/fetch progress events.

**Example:**

```typescript
// server-actions/files.ts
'use server'

import { auth } from '@clerk/nextjs/server'
import { prisma } from '@/lib/prisma'
import { generateUploadUrl } from '@/lib/s3'
import { randomUUID } from 'crypto'

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB
const ALLOWED_FILE_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png',
]

interface UploadFileInput {
  fileName: string
  fileType: string
  fileSize: number
  requestId: string
  description?: string
}

export async function prepareFileUpload(input: UploadFileInput) {
  const { userId } = await auth()

  if (!userId) {
    throw new Error('Unauthorized')
  }

  // Validate file size
  if (input.fileSize > MAX_FILE_SIZE) {
    throw new Error(`File size exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit`)
  }

  // Validate file type
  if (!ALLOWED_FILE_TYPES.includes(input.fileType)) {
    throw new Error('File type not allowed')
  }

  // Verify request exists and user owns it
  const request = await prisma.request.findUnique({
    where: { id: input.requestId },
  })

  if (!request || request.requesterId !== userId) {
    throw new Error('Request not found or unauthorized')
  }

  // Generate unique S3 key
  const fileId = randomUUID()
  const key = `requests/${input.requestId}/${fileId}-${input.fileName}`

  // Generate presigned URL
  const uploadUrl = await generateUploadUrl({
    key,
    contentType: input.fileType,
    contentLength: input.fileSize,
  })

  return {
    uploadUrl,
    key,
    fileId,
  }
}

export async function confirmFileUpload(input: {
  requestId: string
  fileId: string
  fileName: string
  fileType: string
  fileSize: number
  key: string
  description?: string
}) {
  const { userId } = await auth()

  if (!userId) {
    throw new Error('Unauthorized')
  }

  // Save file metadata to database
  const fileAttachment = await prisma.fileAttachment.create({
    data: {
      id: input.fileId,
      requestId: input.requestId,
      fileName: input.fileName,
      fileType: input.fileType,
      fileSize: input.fileSize,
      s3Key: input.key,
      description: input.description,
      uploadedById: userId,
    },
  })

  return { success: true, fileAttachment }
}
```

```typescript
// components/requests/file-upload-zone.tsx
'use client'

import { useState } from 'react'
import { prepareFileUpload, confirmFileUpload } from '@/server-actions/files'

export function FileUploadZone({ requestId }: { requestId: string }) {
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)

  async function handleFileSelect(files: FileList) {
    for (const file of Array.from(files)) {
      setUploading(true)
      setProgress(0)

      try {
        // Step 1: Get presigned URL from server
        const { uploadUrl, key, fileId } = await prepareFileUpload({
          fileName: file.name,
          fileType: file.type,
          fileSize: file.size,
          requestId,
        })

        // Step 2: Upload directly to S3 with progress tracking
        await new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest()

          xhr.upload.addEventListener('progress', (e) => {
            if (e.lengthComputable) {
              setProgress(Math.round((e.loaded / e.total) * 100))
            }
          })

          xhr.addEventListener('load', () => {
            if (xhr.status === 200) {
              resolve(xhr.response)
            } else {
              reject(new Error('Upload failed'))
            }
          })

          xhr.addEventListener('error', () => reject(new Error('Upload failed')))
          xhr.open('PUT', uploadUrl)
          xhr.setRequestHeader('Content-Type', file.type)
          xhr.send(file)
        })

        // Step 3: Confirm upload and save metadata
        await confirmFileUpload({
          requestId,
          fileId,
          fileName: file.name,
          fileType: file.type,
          fileSize: file.size,
          key,
        })

        // Refresh file list
        // ...
      } catch (error) {
        console.error('Upload error:', error)
      } finally {
        setUploading(false)
        setProgress(0)
      }
    }
  }

  return (
    <div>
      <input
        type="file"
        multiple
        onChange={(e) => e.target.files && handleFileSelect(e.target.files)}
        disabled={uploading}
      />
      {uploading && <div>Uploading... {progress}%</div>}
    </div>
  )
}
```

**Source:** [Complete Guide to File Uploads in Next.js 15](https://javascript.plainenglish.io/complete-guide-to-file-uploads-in-next-js-aws-s3-presigned-urls-dropzone-adb7a60d318c) (MEDIUM confidence - community guide, September 2025, verified against official AWS SDK docs)

### Pattern 4: Prisma Schema for Request Workflow with Status Tracking

**What:** Use Prisma enums for request status, relations for user/department associations, and timestamp fields for audit trail foundation.

**When to use:** All database models for requests, file attachments, status tracking, and activity logs.

**Why:** Enums provide type safety for status values, relations enable efficient queries (e.g., "all requests for a department"), and timestamps support the audit trail requirement.

**Example:**

```prisma
// prisma/schema.prisma

// Request model
model Request {
  id             String            @id @default(cuid())
  title          String
  description    String            @db.Text
  status         RequestStatus     @default(ImprovementRequest)

  // Relations
  requesterId    String
  requester      User              @relation(fields: [requesterId], references: [id])
  departmentId   String
  department     Department        @relation(fields: [departmentId], references: [id])

  // Files attached to request
  fileAttachments FileAttachment[]

  // Activity log for audit trail
  activities     RequestActivity[]

  // Timestamps
  createdAt      DateTime          @default(now())
  updatedAt      DateTime          @updatedAt

  @@index([requesterId])
  @@index([departmentId])
  @@index([status])
  @@index([createdAt])
  @@map("requests")
}

// File attachment model (metadata only, actual file in S3)
model FileAttachment {
  id           String   @id @default(cuid())
  requestId    String
  request      Request  @relation(fields: [requestId], references: [id], onDelete: Cascade)

  fileName     String
  fileType     String
  fileSize     Int      // Size in bytes
  s3Key        String   // S3 object key (path)
  description   String?  @db.Text

  uploadedById String
  uploadedBy   User     @relation(fields: [uploadedById], references: [id])

  createdAt    DateTime @default(now())

  @@index([requestId])
  @@index([uploadedById])
  @@map("file_attachments")
}

// Request status enum
enum RequestStatus {
  ImprovementRequest              // Initial status
  SentToEngineer                  // Sent to engineering
  DesignCostEstimationApproval    // Awaiting design/cost approval
  SendBackToRequester             // Returned to requester
  Completed                       // Final status
}

// Activity log for audit trail
model RequestActivity {
  id          String        @id @default(cuid())
  requestId   String
  request     Request       @relation(fields: [requestId], references: [id], onDelete: Cascade)

  action      String        // e.g., "created", "status_changed", "file_attached"
  fromStatus  RequestStatus? // Previous status (for status changes)
  toStatus    RequestStatus? // New status (for status changes)
  comments    String?       @db.Text

  userId      String
  user        User          @relation(fields: [userId], references: [id])

  createdAt   DateTime      @default(now())

  @@index([requestId])
  @@index([userId])
  @@index([createdAt])
  @@map("request_activities")
}

// Update User model to include relations
model User {
  id                String              @id // Clerk user ID
  email             String              @unique
  name              String
  departmentId      String?
  department        Department?         @relation(fields: [departmentId], references: [id])
  role              UserRole            @default(general_dept)
  level             Int?                // User level/rank for approval hierarchy
  isActive          Boolean             @default(true)

  // Relations added
  createdRequests   Request[]           @relation("Requester")
  uploadedFiles     FileAttachment[]    @relation("FileUploader")
  activities        RequestActivity[]

  createdAt         DateTime            @default(now())
  updatedAt         DateTime            @updatedAt

  @@index([departmentId])
  @@index([isActive])
  @@map("users")
}
```

**Source:** [Prisma Schema Documentation](https://github.com/prisma/docs/blob/main/content/200-orm/100-prisma-schema/20-data-model/10-models.mdx) (HIGH confidence - official Prisma documentation)

### Pattern 5: React Hook Form with Zod for File Validation

**What:** Use React Hook Form for form state management combined with Zod schema validation. Use `z.preprocess` to handle FileList conversion because Next.js Server Actions pass FormData with File objects that Zod doesn't recognize.

**When to use:** All forms with file uploads (request creation form, solution submission form in Phase 4).

**Why:** React Hook Form provides performant form handling with minimal re-renders. Zod provides type-safe validation. The `preprocess` step is critical because file inputs in HTML return a FileList object, not a plain array.

**Example:**

```typescript
// components/requests/request-form.tsx
'use client'

import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as z from 'zod'
import { Form, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { FileUploadZone } from './file-upload-zone'

// Zod schema with preprocess for files
const requestFormSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200, 'Title too long'),
  description: z.string().min(1, 'Description is required').max(5000, 'Description too long'),
  // Use preprocess to convert FileList to File[] before validation
  files: z.preprocess(
    (value) => {
      // Handle both FileList and undefined/null
      if (!value || value instanceof FileList) {
        return value
      }
      return Array.from(value as FileList)
    },
    z.array(z.instanceof(File)).optional()
  ),
})

type RequestFormValues = z.infer<typeof requestFormSchema>

export function RequestForm({ requestId }: { requestId?: string }) {
  const form = useForm<RequestFormValues>({
    resolver: zodResolver(requestFormSchema),
    defaultValues: {
      title: '',
      description: '',
      files: [],
    },
  })

  async function onSubmit(data: RequestFormValues) {
    // Create request first
    const result = await createRequest(new FormData())

    if (!result.success) {
      // Handle validation errors
      return
    }

    // Then upload files if any
    if (data.files && data.files.length > 0) {
      for (const file of data.files) {
        await handleFileUpload(result.requestId, file)
      }
    }

    // Redirect or show success
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
        <FormField
          control={form.control}
          name="title"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Title</FormLabel>
              <Input {...field} placeholder="Request title" />
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Description</FormLabel>
              <Input {...field} placeholder="Detailed description" />
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="files"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Attachments (optional)</FormLabel>
              <FileUploadZone
                onFilesChange={(files) => field.onChange(files)}
                requestId={requestId}
              />
              <FormMessage />
            </FormItem>
          )}
        />

        <Button type="submit">Submit Request</Button>
      </form>
    </Form>
  )
}
```

**Source:** [React Hook Form with Zod: Complete Guide for 2026](https://dev.to/md_marufrah_3552855e/react-hook-form-with-zod-complete-guide-for-2026-1em1) (HIGH confidence - January 2026 guide, verified against official React Hook Form docs)

### Pattern 6: Status Badge with Color Coding

**What:** Create reusable status badge component that displays request status with color coding (blue=pending, green=approved, red=rejected).

**When to use:** Request list table, detail modal, dashboard widgets.

**Why:** Visual status indicators improve UX. Users can quickly scan request list and understand status at a glance.

**Example:**

```typescript
// components/requests/status-badge.tsx
import { Badge } from '@/components/ui/badge'
import { RequestStatus } from '@prisma/client'

interface StatusBadgeProps {
  status: RequestStatus
}

const statusConfig = {
  [RequestStatus.ImprovementRequest]: {
    label: 'Improvement Request',
    variant: 'default' as const,
    className: 'bg-blue-100 text-blue-800 hover:bg-blue-100',
  },
  [RequestStatus.SentToEngineer]: {
    label: 'Sent to Engineer',
    variant: 'default' as const,
    className: 'bg-yellow-100 text-yellow-800 hover:bg-yellow-100',
  },
  [RequestStatus.DesignCostEstimationApproval]: {
    label: 'Design/Cost Approval',
    variant: 'default' as const,
    className: 'bg-purple-100 text-purple-800 hover:bg-purple-100',
  },
  [RequestStatus.SendBackToRequester]: {
    label: 'Sent Back to Requester',
    variant: 'destructive' as const,
    className: 'bg-red-100 text-red-800 hover:bg-red-100',
  },
  [RequestStatus.Completed]: {
    label: 'Completed',
    variant: 'default' as const,
    className: 'bg-green-100 text-green-800 hover:bg-green-100',
  },
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const config = statusConfig[status]

  return (
    <Badge variant={config.variant} className={config.className}>
      {config.label}
    </Badge>
  )
}
```

**Source:** [shadcn/ui Badge Documentation](https://ui.shadcn.com/docs/components/badge) (HIGH confidence - official shadcn/ui documentation)

### Anti-Patterns to Avoid

- **Uploading files through Next.js server:** Never pass file contents through Server Actions. This causes timeouts, memory issues, and server scaling problems. Always use presigned URLs for direct client-to-S3 uploads.
- **Storing file contents in database:** Base64 encoding bloats database (33% size increase), degrades query performance, prevents CDN usage. Store only metadata in Prisma, actual files in S3.
- **Hard-coding status values in components:** Don't use `if (status === 'ImprovementRequest')` checks. Use the Prisma enum for type safety and autocomplete.
- **Forgetting to validate file types on server:** Client-side validation can be bypassed. Always validate file type and size in Server Action before generating presigned URL.
- **Using `z.any()` for file validation:** This bypasses type safety. Use `z.preprocess` with `z.instanceof(File)` for proper validation.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| File upload progress tracking | Custom XHR progress event handling | Use fetch/XHR with upload progress events (built into browser API) | Progress events are browser standard; custom implementations re-invent wheel and often buggy |
| File type validation | Custom file extension checking | Use MIME type validation in Server Action + browser `accept` attribute | File extensions can be spoofed; MIME type validation more secure; browser `accept` provides user-friendly file picker |
| S3 bucket CORS configuration | Manual CORS rule setup | AWS SDK handles presigned URLs which work cross-origin | Presigned URLs include signature that bypasses CORS restrictions for uploads |
| Form validation | Custom validation logic, error state management | Zod + React Hook Form | Type-safe validation, consistent error handling, real-time feedback, less boilerplate |
| Status badge color coding | Conditional className logic in every component | Reusable StatusBadge component with config object | Single source of truth for status styling, easier to update, consistent across app |
| Request list filtering | Custom filter implementation with state | TanStack Table column filtering (built into shadcn/ui DataTable) | Handles sorting, filtering, pagination out of box; performant with large datasets |

**Key insight:** File uploads are one of the most over-engineered features in web apps. S3 presigned URLs are production-standard for 10+ years. Don't invent new upload protocols. Leverage browser APIs (FormData, XHR progress) and AWS SDK. Focus validation energy on security (file type, size) not on re-implementing upload mechanics.

## Common Pitfalls

### Pitfall 1: File Upload Timeout on Slow Connections

**What goes wrong:**
User uploads large file on slow connection, Next.js Server Action times out after default timeout, upload fails partway through. User sees generic error and has to restart.

**Why it happens:**
Server Actions have default timeout (usually 30-60 seconds). Large files on slow connections exceed this timeout. If routing files through server (anti-pattern), this is catastrophic. With presigned URLs, this shouldn't happen but can if presigned URL expires during upload.

**How to avoid:**
- Use presigned URLs (files never touch server, so server timeout doesn't apply)
- Set presigned URL expiration to 15-30 minutes (sufficient for large files on slow connections)
- Implement client-side retry logic for failed uploads
- Show progress bar so user knows upload is active
- Consider adding file size limit (10MB) to prevent abuse

**Example:**

```typescript
// lib/s3.ts - Set appropriate expiration
const signedUrl = await getSignedUrl(s3Client, command, {
  expiresIn: 1800, // 30 minutes (sufficient for slow connections)
})
```

**Warning signs:**
- Users report intermittent upload failures
- Server timeout errors in logs during uploads
- Uploads work on fast connections but fail on slow networks

### Pitfall 2: File Type Validation Only on Client

**What goes wrong:**
User renames `malicious.exe` to `document.pdf` and bypasses client-side validation. Server accepts file and stores in S3. Security vulnerability if files are later served/executed.

**Why it happens:**
Client-side file type validation only checks file extension or MIME type declaration. Browser doesn't validate actual file content. Malicious files can spoof extensions.

**How to avoid:**
- Validate file MIME type on server in Server Action (before generating presigned URL)
- Use whitelist approach (only allow specific types, not blacklist)
- Consider using file-type detection library like `file-type` for additional validation (reads magic bytes)
- Never execute uploaded files, only serve them for download

**Example:**

```typescript
// server-actions/files.ts - Server-side validation
const ALLOWED_FILE_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png',
]

if (!ALLOWED_FILE_TYPES.includes(input.fileType)) {
  throw new Error(`File type not allowed. Allowed types: ${ALLOWED_FILE_TYPES.join(', ')}`)
}
```

**Warning signs:**
- Unexpected file types appearing in S3 bucket
- Security scan flags uploaded files
- Users report being able to upload executables

### Pitfall 3: Presigned URL Generated but File Never Uploaded

**What goes wrong:**
Server generates presigned URL and saves file metadata to database, but client upload to S3 fails (network error, user closes browser). Database has orphaned file record that points to non-existent S3 object.

**Why it happens:**
Two-step process (generate URL, then upload) has no atomic commit. If step 2 fails, step 1's database record is orphaned. No cleanup mechanism for failed uploads.

**How to avoid:**
- Only save file metadata to database AFTER successful S3 upload (not before)
- Implement retry logic for failed uploads (exponential backoff)
- Consider cleanup job to remove orphaned file records older than X hours
- Use two-phase commit: generate presigned URL, upload to S3, confirm metadata

**Example:**

```typescript
// Correct order: Upload first, then save metadata
// Step 1: Generate presigned URL (no database write)
const { uploadUrl, key, fileId } = await prepareFileUpload(...)

// Step 2: Upload to S3 (client-side)
await uploadToS3(uploadUrl, file)

// Step 3: Save metadata only after successful upload
await confirmFileUpload({ fileId, key, ... })
```

**Warning signs:**
- File list shows files that return 404 when downloaded
- Database has more file records than S3 bucket has objects
- Users report "file disappeared" after upload

### Pitfall 4: Request Status Change Without Audit Trail

**What goes wrong:**
Request status changes from "ImprovementRequest" to "SentToEngineer" but no record of who changed it, when, or why. Audit trail is incomplete. Cannot answer "who approved this request?" or "when was it sent to engineering?"

**Why it happens:**
Developer focuses on functional requirement (status changes) but forgets audit requirement. No RequestActivity records created on status update. Status enum changes directly without logging.

**How to avoid:**
- Create RequestActivity record for every status change (use Prisma hooks or transaction)
- Always log: who (userId), when (createdAt), what (action), from/to (fromStatus/toStatus), why (comments)
- Use database transaction to ensure status change and activity log are atomic
- Consider Prisma middleware to automatically log all model changes

**Example:**

```typescript
// server-actions/status.ts - Status change with audit trail
export async function updateRequestStatus(input: {
  requestId: string
  newStatus: RequestStatus
  comments?: string
}) {
  const { userId } = await auth()

  if (!userId) {
    throw new Error('Unauthorized')
  }

  // Use transaction to ensure atomicity
  await prisma.$transaction(async (tx) => {
    // Get current request
    const request = await tx.request.findUnique({
      where: { id: input.requestId },
    })

    if (!request) {
      throw new Error('Request not found')
    }

    // Update status
    await tx.request.update({
      where: { id: input.requestId },
      data: { status: input.newStatus },
    })

    // Create activity log
    await tx.requestActivity.create({
      data: {
        requestId: input.requestId,
        action: 'status_changed',
        fromStatus: request.status,
        toStatus: input.newStatus,
        comments: input.comments,
        userId,
      },
    })
  })

  revalidatePath('/requests')
}
```

**Warning signs:**
- Cannot answer "who changed this status?"
- No history visible in request detail view
- Compliance audit fails

### Pitfall 5: File Description Not Captured or Lost

**What goes wrong:**
User uploads file and adds description ("Site survey photo from 2025-01-15"), but description is not saved to database or lost after upload. Context for file attachment is missing.

**Why it happens:**
File upload flow separates metadata from file. Description field not included in upload confirmation call. Or description captured but not displayed in file list.

**How to avoid:**
- Add description field to file upload UI (textarea next to file)
- Pass description to `confirmFileUpload` Server Action and save to FileAttachment
- Display description in request detail view's file list
- Make description optional but encourage users to provide context

**Example:**

```typescript
// FileAttachment model includes description field
model FileAttachment {
  // ...
  description   String?  @db.Text
  // ...
}

// File upload component captures description
<input
  type="text"
  placeholder="Optional description"
  onChange={(e) => setFileDescription(file.id, e.target.value)}
/>
```

**Warning signs:**
- Users ask "which file is this?"
- Files uploaded but no context
- Users re-uploading same file with different names to add context

### Pitfall 6: Request List Performance Degradation with Many Requests

**What goes wrong:**
Request list page loads slowly as number of requests grows. Each request fetches nested relations (user, department, files, activities) causing N+1 query problem. Page takes 5+ seconds to load with 1000+ requests.

**Why it happens:**
Naive Prisma query uses `include` for all relations without select optimization. TanStack Table re-renders on every data change. No pagination implemented.

**How to avoid:**
- Use Prisma `select` to fetch only fields needed for list view
- Implement pagination (show 20-50 requests per page)
- Use server-side filtering/sorting (not client-side)
- Consider caching frequently accessed data with Redis
- Use `react-query` or SWR for data fetching with cache invalidation

**Example:**

```typescript
// Optimize list query - fetch only what's needed for table
const requests = await prisma.request.findMany({
  take: 20,
  skip: page * 20,
  select: {
    id: true,
    title: true,
    status: true,
    createdAt: true,
    requester: {
      select: {
        id: true,
        name: true,
      },
    },
    department: {
      select: {
        id: true,
        name: true,
      },
    },
    // Don't fetch files or activities for list view
  },
  orderBy: {
    createdAt: 'desc',
  },
})
```

**Warning signs:**
- Page load time increases with request count
- Database slow query logs
- Users complain about sluggish list view

## Code Examples

Verified patterns from official sources:

### S3 Presigned URL Generation

```typescript
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"

const s3Client = new S3Client({ region: "us-east-1" })
const command = new PutObjectCommand({
  Bucket: bucket,
  Key: key,
  ContentType: contentType,
})

const presigned = getSignedUrl(s3Client, command, {
  expiresIn: 900, // 15 minutes
})
```

**Source:** [AWS SDK v3 Documentation](https://github.com/aws/aws-sdk-js-v3/blob/main/packages/s3-request-presigner/README.md) (HIGH confidence)

### Next.js Server Action Form Validation

```typescript
'use server'

import { z } from 'zod'

const schema = z.object({
  email: z.string({
    invalid_type_error: 'Invalid Email',
  }),
})

export default async function createUser(formData: FormData) {
  const validatedFields = schema.safeParse({
    email: formData.get('email'),
  })

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
    }
  }

  // Mutate data
}
```

**Source:** [Next.js Server Actions Documentation](https://github.com/vercel/next.js/blob/v15.1.8/docs/01-app/02-building-your-application/02-data-fetching/03-server-actions-and-mutations.mdx) (HIGH confidence)

### Prisma Enum Definition

```prisma
model User {
  id    Int     @id @default(autoincrement())
  email String  @unique
  name  String?
  role  Role    @default(USER)
}

enum Role {
  USER
  ADMIN
}
```

**Source:** [Prisma Enums Documentation](https://github.com/prisma/docs/blob/main/content/200-orm/100-prisma-schema/20-data-model/10-models.mdx) (HIGH confidence)

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| File upload through server (multipart/form-data to API route) | S3 presigned URLs (direct client-to-S3) | 2020-2021 | Presigned URLs became best practice; eliminates server bottleneck, scales infinitely, reduces server costs |
| Hard-coded status strings (`"pending"`, `"approved"`) | Prisma enums for type-safe status values | 2021-2022 | Enums provide compile-time safety, autocomplete, prevent typos, enable refactoring |
| Manual form validation with if/else | Zod schema validation | 2022-2023 | Type-safe validation, consistent error messages, client/server reuse, better DX |
| Client-side only file type checking | Server-side MIME type validation with whitelist | 2019-2020 | Security best practice; client checks can be bypassed |
| Simple timestamp (`createdAt`) | Full audit trail (RequestActivity with from/to status, user, comments) | Ongoing | Compliance requirements drive audit trail patterns; GDPR, SOC 2 require activity logs |

**Deprecated/outdated:**
- **Server-side file streaming (multer, busboy):** Replaced by S3 presigned URLs for most use cases. Server streaming still viable for edge cases (virus scanning, transformation) but adds complexity.
- **Hard-coded status strings:** Prisma enums or TypeScript `const assertions` are safer. String literals cause runtime errors from typos.
- **File input with `accept` attribute only:** Client-side validation is bypassable. Must validate on server.
- **Manual progress tracking with `setInterval`:** Use XHR `upload.progress` event or fetch with ReadableStream for accurate progress tracking.

## Open Questions

1. **S3 bucket configuration and CORS**
   - What we know: S3 bucket needs CORS configuration for presigned URL PUT requests from browser
   - What's unclear: Exact CORS rules needed, whether to use public bucket or private with presigned URLs only
   - Recommendation: Use private S3 bucket with presigned URLs (most secure). Configure CORS to allow PUT from your domain. AWS provides CORS configuration examples in S3 console.

2. **File size limit for presigned URLs**
   - What we know: Need per-file size limit to prevent abuse
   - What's unclear: Optimal limit for this use case (document attachments for improvement requests)
   - Recommendation: 10MB per file is reasonable for documents (PDF, Office docs, images). This allows large PDFs but prevents abuse with 1GB+ files. Make configurable via environment variable so admin can adjust.

3. **RequestActivity retention policy**
   - What we know: Need audit trail for compliance
   - What's unclear: How long to keep activity logs, whether to archive old activities
   - Recommendation: Keep all RequestActivity records indefinitely (compliance requirement). If performance becomes issue, archive activities older than 1 year to separate table or cold storage. For 30 users and estimated 1000 requests/year, this won't be an issue for years.

4. **Status transition validation**
   - What we know: RequestStatus enum defines 5 states
   - What's unclear: Which transitions are valid (can RequestStatus go from Completed back to SentToEngineer?)
   - Recommendation: Phase 2 only allows forward transitions (ImprovementRequest → SentToEngineer → DesignCostEstimationApproval → SendBackToRequester → Completed). Phase 3 (approvals) will add proper state machine validation. For now, allow admin to override any status (for manual corrections).

## Sources

### Primary (HIGH confidence)

- **/aws/aws-sdk-js-v3** - S3 client, presigned URL generation with getSignedUrl, PutObjectCommand, GetObjectCommand, upload progress tracking
- **/vercel/next.js/v15.1.8** - Server Actions with form validation, FormData handling, revalidatePath for cache invalidation
- **/prisma/docs** - Schema design with enums, relations, timestamp fields, audit trail patterns, transactions for atomic updates
- **/shadcn-ui/ui** - DataTable component for request list, Form components with React Hook Form, Badge component for status indicators, Dialog for detail modal

### Secondary (MEDIUM confidence)

- [Complete Guide to File Uploads in Next.js 15— AWS S3, Presigned URLs, Dropzone](https://javascript.plainenglish.io/complete-guide-to-file-uploads-in-next-js-aws-s3-presigned-urls-dropzone-adb7a60d318c) - September 2025 guide for Next.js 15 file uploads (verified against official AWS SDK docs)
- [AWS S3 Upload with Next.js Server Actions and Zod Validation](https://medium.com/@christopher_28348/aws-s3-upload-with-next-js-server-actions-and-zod-validation-dd3a2410bba4) - Integration pattern for S3 uploads with Zod
- [How to upload files to AWS S3 using pre-signed URLs in Next.js](https://medium.com/@kundanmbhosale/how-to-upload-files-to-aws-s3-using-pre-signed-urls-in-next-js-92af067a4e7f) - File uploads with progress bar using XHR
- [React Hook Form with Zod: Complete Guide for 2026](https://dev.to/md_marufrah_3552855e/react-hook-form-with-zod-complete-guide-for-2026-1em1) - January 2026 guide covering file upload validation with `z.preprocess` for FileList
- [Handling Image Uploads in React-hook-form with Zod](https://www.bacancytechnology.com/qanda/react/handling-image-uploads-in-react-hook-form-with-zod) - September 2024 guide for file upload handling patterns

### Tertiary (LOW confidence)

- [Using Presigned URLs in a Next.js App Router Project to Upload Files to S3](https://conermurphy.com/blog/presigned-urls-nextjs-s3-upload/) - October 2023 blog post (older but pattern still valid)
- [Uploading Images to AWS S3 with Next.js and React Dropzone](https://dev.to/franciscolunadev82/uploading-images-to-aws-s3-with-next-js-and-react-dropzone-a-complete-guide-4a0h) - Dropzone integration examples (use for UX patterns, not security)
- [How to track table changes in Prisma? - StackOverflow](https://stackoverflow.com/questions/76376399/how-to-track-table-changes-in-prisma) - Community discussion on audit trail patterns (use for ideas, not copy-paste)
- [BemiHQ/bemi-prisma - Automatic data change tracking for Prisma](https://github.com/BemiHQ/bemi-prisma) - Third-party tool for audit trails (interesting but unnecessary for Phase 2 scope)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All sources are official documentation (AWS SDK, Next.js, Prisma, shadcn/ui) or recent community guides verified against official docs
- Architecture: HIGH - Patterns verified against official documentation and current best practices (presigned URLs, Server Actions, enum status tracking)
- Pitfalls: MEDIUM - Pitfalls based on common file upload issues documented in web search results and general S3/Next.js best practices; some pitfalls specific to this app's workflow are theoretical and should be validated during implementation

**Research date:** 2026-01-31
**Valid until:** 2026-02-28 (30 days - file upload patterns and S3 presigned URLs are stable, but AWS SDK and Next.js release updates frequently)
