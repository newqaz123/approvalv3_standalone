import { NextRequest, NextResponse } from 'next/server'
import JSZip from 'jszip'
import { requireAdmin } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { readAttachmentFile } from '@/lib/attachments/storage'
import { generateAdminBackupPdf } from '@/server-actions/reports'
import { buildRetentionBackupEntries } from '@/lib/retention-policy'

const MAX_REQUESTS = 10

export async function POST(request: NextRequest) {
  const adminId = await requireAdmin()
  if (!adminId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let requestIds: unknown
  try {
    const body = await request.json()
    requestIds = body.requestIds
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!Array.isArray(requestIds) || requestIds.length === 0) {
    return NextResponse.json({ error: 'Select at least one request' }, { status: 400 })
  }

  const ids = [...new Set(requestIds.filter((id): id is string => typeof id === 'string' && id.length > 0))]
  if (ids.length === 0 || ids.length > MAX_REQUESTS) {
    return NextResponse.json(
      { error: `Select between 1 and ${MAX_REQUESTS} requests` },
      { status: 400 }
    )
  }

  const rows = await prisma.requests.findMany({
    where: { id: { in: ids }, isDeleted: false },
    select: {
      id: true,
      title: true,
      fileAttachments: { select: { fileName: true, filePath: true } },
      solutions: {
        select: {
          fileAttachments: { select: { fileName: true, filePath: true } },
        },
      },
    },
  })

  if (rows.length === 0) {
    return NextResponse.json({ error: 'No matching requests' }, { status: 404 })
  }

  const zip = new JSZip()
  const errors: string[] = []

  for (const row of rows) {
    let reportPdf: Buffer | null = null
    let reportError: string | undefined
    try {
      reportPdf = await generateAdminBackupPdf(row.id, adminId)
    } catch (error) {
      reportError = error instanceof Error ? error.message : 'Could not generate report'
      errors.push(`${row.id}: report PDF failed — ${reportError}`)
    }

    const attachments: Array<{ fileName: string; bytes: Buffer }> = []
    const files = [
      ...row.fileAttachments,
      ...row.solutions.flatMap((solution) => solution.fileAttachments),
    ]

    for (const file of files) {
      try {
        attachments.push({
          fileName: file.fileName,
          bytes: await readAttachmentFile(file.filePath),
        })
      } catch {
        errors.push(`${row.id}: attachment ${file.fileName} could not be read`)
        attachments.push({
          fileName: `${file.fileName}.missing.txt`,
          bytes: Buffer.from(`Could not read ${file.fileName} from storage.\n`, 'utf8'),
        })
      }
    }

    for (const entry of buildRetentionBackupEntries({
      requestId: row.id,
      title: row.title,
      reportPdf,
      reportError,
      attachments,
    })) {
      zip.file(entry.path, entry.data)
    }
  }

  if (errors.length > 0) {
    zip.file(
      '_INCOMPLETE_BACKUP.txt',
      Buffer.from(
        `This backup is INCOMPLETE. ${errors.length} problem(s):\n\n${errors.join('\n')}\n`,
        'utf8'
      )
    )
  }

  const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  const date = new Date().toISOString().slice(0, 10)
  const filename = rows.length === 1
    ? `retention-backup-${rows[0].id.slice(0, 8)}-${date}.zip`
    : `retention-backup-${date}.zip`

  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(bytes.length),
    },
  })
}
