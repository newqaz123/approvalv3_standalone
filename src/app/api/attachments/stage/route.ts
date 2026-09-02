import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { auth } from '@/lib/auth-config'
import {
  createStagedAttachmentPath,
  isStagedAttachmentPath,
  resolveStoredAttachmentPath,
  writeAttachmentFile,
  deleteAttachmentFile,
} from '@/lib/attachments/storage'
import { validateAttachmentMetadata } from '@/lib/attachments/policy'

function isEnoent(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: unknown }).code === 'ENOENT'
}

/**
 * POST /api/attachments/stage — upload ONE not-yet-submitted attachment into
 * the staging subtree (`stage/<uuid>/<name>`). The XHR client uses real
 * byte-level progress for this upload; the file only becomes a request
 * attachment when createRequest atomically adopts it. Nothing here touches
 * the database, so abandoned stages are just files under stage/.
 *
 * FormData fields:
 *   file — the attachment (required)
 */
export async function POST(request: Request) {
  const { user } = (await auth()) ?? {}
  if (!user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 })
  }

  const file = formData.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Missing file' }, { status: 400 })
  }

  const validationError = validateAttachmentMetadata({
    name: file.name,
    type: file.type,
    size: file.size,
  })
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 })
  }

  // validateAttachmentMetadata already enforces extension whitelist + MIME
  // consistency, so no separate extension check is needed here.
  const stagedId = randomUUID()
  const stagedPath = createStagedAttachmentPath(stagedId, file.name)

  try {
    const bytes = Buffer.from(await file.arrayBuffer())
    await writeAttachmentFile(stagedPath, bytes)
    const info = await stat(resolveStoredAttachmentPath(stagedPath))
    return NextResponse.json({
      stagedPath,
      fileName: file.name,
      fileType: file.type,
      fileSize: info.size,
    })
  } catch (error) {
    console.error('Failed to stage attachment:', error)
    return NextResponse.json({ error: 'Failed to store file' }, { status: 500 })
  }
}

/**
 * DELETE /api/attachments/stage — remove an abandoned staged file (user
 * removed the row, or cancelled the form). Only paths inside the staging
 * subtree are accepted: regular request attachments are untouchable here.
 *
 * JSON body: { stagedPath: string }
 */
export async function DELETE(request: Request) {
  const { user } = (await auth()) ?? {}
  if (!user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { stagedPath?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const stagedPath = typeof body.stagedPath === 'string' ? body.stagedPath : ''
  if (!stagedPath || !isStagedAttachmentPath(stagedPath)) {
    return NextResponse.json(
      { error: 'Not a staged attachment path' },
      { status: 400 },
    )
  }

  try {
    await deleteAttachmentFile(stagedPath)
  } catch (error) {
    if (isEnoent(error)) {
      return NextResponse.json({ error: 'Staged attachment not found' }, { status: 404 })
    }
    console.error('Failed to delete staged attachment:', error)
    return NextResponse.json({ error: 'Failed to delete staged file' }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}
