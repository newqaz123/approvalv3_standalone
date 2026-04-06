import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth-config'
import { existsSync } from 'fs'
import { readFile } from 'fs/promises'
import { join, extname } from 'path'

const MIME_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.dwg': 'application/octet-stream',
  '.dxf': 'application/octet-stream',
  '.step': 'application/octet-stream',
  '.stp': 'application/octet-stream',
}

export async function GET(request: NextRequest) {
  const { user } = (await auth()) ?? {}
  if (!user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const filePath = searchParams.get('path')

  if (!filePath) {
    return NextResponse.json({ error: 'File path is required' }, { status: 400 })
  }

  // Sanitize: strip leading slash, ensure path stays within public/
  const normalizedPath = filePath.replace(/^\/+/, '')

  // Prevent directory traversal
  if (normalizedPath.includes('..')) {
    return NextResponse.json({ error: 'Invalid file path' }, { status: 400 })
  }

  const fullPath = join(process.cwd(), 'public', normalizedPath)

  if (!existsSync(fullPath)) {
    return NextResponse.json(
      { error: 'File not found. It may have been uploaded in a previous environment and is no longer available.' },
      { status: 404 }
    )
  }

  const buffer = await readFile(fullPath)
  const fileName = normalizedPath.split('/').pop() || 'download'
  const ext = extname(fileName).toLowerCase()
  const mimeType = MIME_TYPES[ext] ?? 'application/octet-stream'

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': mimeType,
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Content-Length': buffer.length.toString(),
    },
  })
}
