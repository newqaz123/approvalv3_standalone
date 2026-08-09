import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth-config'
import prisma from '@/lib/prisma'
import { z } from 'zod'
import { readAttachmentFile } from '@/lib/attachments/storage'
import { buildContentDisposition } from '@/lib/attachments/content-disposition'
import { canUserViewRequest } from '@/lib/request-access'

// ID-based access only: the caller may never supply a filesystem path. The `id`
// selects a row from file_attachments; the physical path comes solely from the
// DB column and is resolved inside the private storage layer.
const DownloadParams = z.object({
  id: z.string().uuid(),
  disposition: z.enum(['inline', 'attachment']).default('attachment'),
})

export async function GET(request: NextRequest) {
  const { user } = (await auth()) ?? {}
  if (!user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const parsed = DownloadParams.safeParse({
    id: searchParams.get('id') ?? undefined,
    disposition: searchParams.get('disposition') ?? undefined,
  })
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid file id' }, { status: 400 })
  }
  const { id, disposition } = parsed.data

  const attachment = await prisma.file_attachments.findUnique({
    where: { id },
    select: {
      fileName: true,
      fileType: true,
      filePath: true,
      requestId: true,
      solution: { select: { requestId: true } },
    },
  })

  if (!attachment) {
    return NextResponse.json({ error: 'File not found' }, { status: 404 })
  }

  // A request attachment links via requestId; a solution attachment links via
  // solution.requestId. Either way authorize against the owning request.
  const requestId = attachment.requestId ?? attachment.solution?.requestId
  if (!requestId || !(await canUserViewRequest(user.id, requestId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let bytes: Buffer
  try {
    bytes = await readAttachmentFile(attachment.filePath)
  } catch {
    // Missing physical file or a path that fails containment resolution: do not
    // leak which — report as not found.
    return NextResponse.json(
      { error: 'File not found. It may have been uploaded in a previous environment and is no longer available.' },
      { status: 404 }
    )
  }

  const contentType = attachment.fileType || 'application/octet-stream'
  const contentDisposition = buildContentDisposition(disposition, attachment.fileName)

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': contentDisposition,
      'Content-Length': bytes.length.toString(),
    },
  })
}
