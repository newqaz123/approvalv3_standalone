# Release Stabilization Design

**Date:** 2026-08-09  
**Status:** Approved design  
**Scope:** Local repository only; no VPS access or deployment

## Purpose

Prepare the repository for a safe test deployment by fixing the confirmed attachment-upload failures, Thai filename handling, private file access, stale New Request form state, and incorrect logout origin. This is Phase 1 of a staged improvement program.

Later phases are intentionally separate:

1. Phase 2 increases configurable department approval levels from five to ten.
2. Phase 3 adds safe Markdown-style bold text and preserved line breaks to request and solution descriptions.

## Goals

- Support individual attachment uploads up to 10 MB through Nginx and Next.js Server Actions.
- Prevent solution submission when any selected attachment fails.
- Make initial submission and resubmission use the same reliable attachment workflow.
- Preserve existing Docker upload-volume data while moving files outside Next.js public static storage.
- Ensure only users who can view a request can access its attachments.
- Preserve original Thai and Unicode filenames during preview and download.
- Reject malicious filenames and guarantee writes remain inside the configured upload root.
- Open the New Request dialog with a fresh form every time.
- Redirect logout to the configured application DNS rather than localhost.
- Add automated release gates for each changed behavior.

## Non-Goals

- No VPS commands, Nginx reloads, Docker deployment, or production data changes.
- No object-storage provider or cloud-storage migration.
- No general redesign of the approval workflow or modal system.
- No department level-10 implementation in this phase.
- No rich-text editor implementation in this phase.
- No production database migration.

## Approach

Use targeted hardening rather than a minimal patch or complete upload rewrite. Existing Prisma attachment records and approval workflows remain authoritative. File storage, access, validation, and client orchestration are consolidated behind small shared modules.

## Attachment Policy

Create a shared attachment policy module containing:

- Maximum file size: 10 MB per file.
- Maximum attachment count: 10 per form submission.
- Allowed MIME types and extensions.
- User-facing allowed-type labels.
- Filename sanitization.
- Canonical relative-path validation.

Client components may use the shared constants for early feedback, but every size, count, type, ownership, role, and workflow-state rule must also be enforced by server code.

A 15 MB transport limit is deliberately larger than the 10 MB application limit to allow multipart and Server Action protocol overhead. It is not permission to accept 15 MB files.

## Private File Storage

### Storage root

`UPLOAD_DIR` becomes the private filesystem root. Defaults:

- Local development: `<project>/uploads`
- Docker: `/app/uploads`

No new attachment is written under `public/`.

### Stored paths

The database continues to store relative paths, never absolute paths. New paths use:

```text
<request-id>/<uuid>-<sanitized-filename>
```

The original user-visible filename remains in `file_attachments.fileName`; it is not inferred from the storage path.

### Existing files

Existing records commonly contain paths such as:

```text
uploads/<request-id>/<uuid>-<filename>
```

A central path resolver accepts this legacy prefix and maps it into the private upload root. All consumers—including download, preview, PDF export, deletion, and package export—must use this resolver rather than joining paths independently.

The existing Docker named volume is preserved and remounted from `/app/public/uploads` to `/app/uploads`. Because the volume contents already begin with request directories, changing the mount target preserves its data without copying the volume.

Add a local migration command that moves files from `public/uploads` to `uploads`, preserving request subdirectories. It must be idempotent, refuse path escapes, report conflicts, and never delete a source file unless the destination was written successfully.

Backup and restore scripts must read and write the configured private upload root and continue supporting the legacy mount during the transition.

## Filesystem Safety

Before writing a file:

1. Reduce the submitted filename to its basename.
2. Remove path separators, control characters, NUL bytes, and unsafe header characters.
3. Preserve a safe Unicode display name in the database.
4. Generate the disk name with a server UUID and sanitized basename.
5. Resolve the destination against `UPLOAD_DIR`.
6. Verify the resolved destination remains inside the resolved upload root.
7. Refuse the operation if containment fails.

The containment check is required even after filename sanitization.

## Attachment Access

Replace path-based public access with attachment-ID access:

```text
GET /api/files/download?id=<attachment-id>&disposition=inline|attachment
```

The route performs these steps:

1. Require an authenticated user.
2. Validate the attachment UUID.
3. Load the attachment, associated request or solution, and request visibility data.
4. Apply the same authorization policy used when deciding whether that user can view the request.
5. Resolve the stored path through the central private-path resolver.
6. Return 403 for unauthorized access, 404 for missing records/files, and 400 for invalid input.

A temporary legacy `path` parameter may only be accepted by first resolving it to an attachment record and applying the same authorization. It must never read an arbitrary caller-provided path.

All UI, preview, PDF, email, and export callers must use attachment IDs or resolved attachment records. Direct `/uploads/...` links are removed.

## Unicode Download Headers

Build `Content-Disposition` from `file_attachments.fileName`, not the UUID-prefixed disk name.

Each response includes:

- A sanitized ASCII fallback in `filename="..."`.
- The UTF-8 original encoded according to RFC 5987 in `filename*=UTF-8''...`.

Quotes, CR/LF, control characters, and percent-encoding edge cases are covered by unit tests. Both `inline` preview and `attachment` download use the same helper.

## Upload and Solution Submission Flow

### Shared client coordinator

The dedicated solution page and modal submission use one upload coordinator. It returns explicit per-file results rather than relying on asynchronously updated React state.

For each file it records:

- Local file key.
- Upload state.
- Attachment ID after success.
- Controlled error after failure.

Submission is blocked if any selected file lacks a successful attachment ID. Upload errors are visible and are never silently ignored.

Successful uploads remain reusable while the same open form retries solution submission. Closing or cancelling the form cleans up unlinked attachments created by that form.

### Initial solution submission

Files are uploaded individually. `submitSolution` receives attachment IDs only.

Inside the solution transaction, every attachment ID must:

- Belong to the target request.
- Have no existing solution.
- Have been uploaded by the current user.
- Still exist.

The number of transferred attachments must equal the number requested. Any mismatch aborts the transaction with a controlled error.

Attachments from a previous solution are not silently transferred to a new solution. Resubmission edits the existing solution and preserves its retained attachments explicitly.

### Resubmission

`resubmitSolution` no longer accepts raw `File[]`. New files are pre-uploaded individually and resubmission receives attachment IDs plus explicit deleted attachment IDs.

Server code validates:

- Current user is authorized to resubmit.
- New attachment IDs belong to the current user and request.
- Deleted IDs belong to the solution being resubmitted.
- Size, count, and type policies were enforced by the upload action.

Physical deletion happens only after the database mutation succeeds, or through a compensating cleanup path that records any failure. Transaction failure must not silently orphan newly written files.

### Exported upload actions

Every exported upload or confirmation action enforces role, request visibility, ownership, and allowed workflow state. Unused legacy prepare/confirm actions are either brought under the same policy with tests or removed after proving they have no callers.

## Next.js and Docker Runtime Configuration

Convert `next.config.ts` to `next.config.mjs` to avoid runtime TypeScript transpilation in the production runner.

Configure:

```js
experimental: {
  optimizePackageImports: ['lucide-react'],
  serverActions: {
    bodySizeLimit: '15mb',
  },
}
```

The Docker runner explicitly copies `next.config.mjs` before running `next start`.

Pin Next.js to an exact version and regenerate the lockfile so all `@next/swc-*` optional packages match it. A production build must complete without a Next/SWC mismatch warning.

Document the matching reverse-proxy requirement:

```nginx
client_max_body_size 15m;
```

The documentation must state that Nginx, Next.js, and application limits form one contract: 15 MB transport, 10 MB file.

## New Request Form Reset

`SubmitterModal` currently initializes request state only when mounted. Because the modal remains mounted, later opens reuse title, description, template, files, file descriptions, errors, and approval selections.

For request mode, every transition from closed to open resets:

- Title and description.
- Selected template and loaded template-derived values.
- New files and file descriptions.
- Upload errors.
- Custom hierarchy selection and approvers.
- Submission errors and loading state.

Cancellation and successful submission both lead to a fresh next open. Solution and resubmission modes retain their existing initialization rules and receive separate reset tests.

## Logout Origin

The application uses one documented canonical origin in production. Deployment configuration must set compatible Auth.js variables:

```text
AUTH_URL=https://<configured-dns>
NEXTAUTH_URL=https://<configured-dns>
NEXT_PUBLIC_APP_URL=https://<configured-dns>
AUTH_TRUST_HOST=true
```

`AUTH_URL` is the primary Auth.js v5 origin; `NEXTAUTH_URL` remains for backward compatibility. Environment validation reports missing values and conflicting origins without printing secrets.

The navbar continues to use a relative `/sign-in` callback so the browser remains on the current trusted origin. Tests verify no application logout path hard-codes localhost and deployment documentation explains reverse-proxy forwarded-host/protocol requirements.

## Error Handling and Cleanup

- Expected validation errors return structured results rather than uncaught exceptions.
- Upload errors identify the affected filename without exposing physical paths.
- Database failures trigger best-effort cleanup of newly written, uncommitted files.
- Filesystem cleanup failures are logged with attachment IDs and remain recoverable by an audit script.
- Client forms keep successful upload IDs during an in-place retry but clean unlinked files on cancellation.
- A solution is never reported successful when selected files failed or were not transferred.

## Testing Strategy

### Unit and regression tests

- File-size boundaries: under 1 MB, approximately 2.1 MB, 10 MB, and 10 MB plus one byte.
- Shared allowed-type and count policy.
- Filename sanitization and path containment, including traversal payloads.
- Legacy and new stored-path resolution.
- RFC 5987 Thai/Unicode headers, quotes, and CR/LF rejection.
- Attachment authorization and route status codes.
- Transfer-count verification and attachment ownership.
- Modal upload failure blocks solution submission.
- Retry retains successful attachment IDs.
- Resubmission accepts IDs, not raw files.
- New Request modal resets on every open.
- Logout configuration contains no hard-coded localhost callback.
- Dockerfile copies runtime config and Compose mounts private storage.

### Browser verification

Run both the dedicated solution page and modal flow with:

1. An ASCII PDF below 1 MB.
2. A PDF around 2.1 MB.
3. A PDF around 9.5 MB.
4. A file over 10 MB, expecting controlled rejection.
5. A Thai filename, expecting successful preview and original-name download.
6. One valid and one rejected file, expecting submission to remain blocked.
7. A retry after one upload failure.
8. A resubmission with retained, deleted, and newly uploaded attachments.
9. A cancelled form, verifying unlinked-upload cleanup.
10. A reopened New Request dialog, verifying all fields are fresh.
11. Logout behind a configured non-localhost origin.

### Security verification

- Signed-out direct file access is denied.
- An authenticated user without request visibility receives 403.
- Traversal filenames cannot write outside `UPLOAD_DIR`.
- Arbitrary path queries cannot read files.
- Spoofed MIME metadata is rejected according to the agreed policy.

## Release Gates

The phase is complete only when:

- Focused tests pass.
- The full regression suite passes with zero failures.
- TypeScript diagnostics pass.
- `npm run build` completes without Next/SWC mismatch warnings.
- Docker and Compose configuration checks pass where Docker is available.
- The logged-in browser matrix passes against a disposable local or staging database.
- No production migration or VPS operation was run from the development environment.

## Future Phase Boundaries

### Phase 2: Department levels 1–10

Use a shared `MAX_APPROVAL_LEVEL = 10`, validate server inputs, allow ten configured level names, and make hierarchy views include configured empty levels. This phase requires no Prisma schema change unless implementation discovery proves a separate maximum-level field is necessary.

### Phase 3: Safe formatted descriptions

Introduce a lightweight textarea-style editor with a Bold button and preserved line breaks. Store safe Markdown rather than arbitrary HTML. Render the same supported subset in request/solution forms, modals, notifications, email, PDF, and exports with context-appropriate escaping. Existing plain-text descriptions remain valid Markdown and require no data migration.
