import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth-config'
import prisma from '@/lib/prisma'
import { INLINE_IMAGE_MIMES } from '@/lib/inline-images/policy'
import { canReadInlineImage, deleteInlineImageDraft } from '@/lib/inline-images/lifecycle'
import { readInlineImageFile } from '@/lib/inline-images/storage'

const ImageIdSchema = z.string().uuid()
const DeleteBodySchema = z.object({ uploadSessionId: z.string().uuid() })

type ImageRouteContext = { params: Promise<{ id: string }> }

async function parseImageId(params: ImageRouteContext['params']): Promise<string | null> {
  const { id } = await params
  const parsed = ImageIdSchema.safeParse(id)
  return parsed.success ? parsed.data : null
}

/** Streams one authenticated private inline image using only its database path. */
export async function GET(_request: Request, { params }: ImageRouteContext) {
  const { user } = (await auth()) ?? {}
  if (!user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const imageId = await parseImageId(params)
  if (!imageId) {
    return NextResponse.json({ error: 'Invalid image id' }, { status: 400 })
  }

  const image = await prisma.inline_description_images.findUnique({
    where: { id: imageId },
    select: {
      filePath: true,
      fileType: true,
      references: { select: { id: true } },
    },
  })
  if (!image || !INLINE_IMAGE_MIMES.has(image.fileType)) {
    return NextResponse.json({ error: 'Image not found' }, { status: 404 })
  }
  if (!(await canReadInlineImage(user.id, imageId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let bytes: Buffer
  try {
    bytes = await readInlineImageFile(image.filePath)
  } catch {
    // Do not reveal whether the path was absent or invalid outside the private root.
    return NextResponse.json({ error: 'Image not found' }, { status: 404 })
  }

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      'Content-Type': image.fileType,
      'Content-Length': String(bytes.length),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': image.references.length > 0
        ? 'private, max-age=86400, immutable'
        : 'private, no-store',
    },
  })
}

/** Deletes only an unreferenced draft owned by the authenticated upload session. */
export async function DELETE(request: Request, { params }: ImageRouteContext) {
  const { user } = (await auth()) ?? {}
  if (!user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const imageId = await parseImageId(params)
  if (!imageId) {
    return NextResponse.json({ error: 'Invalid image id' }, { status: 400 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const parsed = DeleteBodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid upload session id' }, { status: 400 })
  }

  try {
    await deleteInlineImageDraft({
      userId: user.id,
      uploadSessionId: parsed.data.uploadSessionId,
      imageId,
    })
    return new NextResponse(null, { status: 204 })
  } catch (error) {
    if (error instanceof Error && /committed, missing, or belongs to another session/i.test(error.message)) {
      return NextResponse.json({ error: 'Image cannot be deleted' }, { status: 403 })
    }
    if (error instanceof Error && /could not be deleted/i.test(error.message)) {
      return NextResponse.json({ error: 'Image could not be deleted; cleanup will retry' }, { status: 500 })
    }

    console.error('[DELETE /api/inline-images/[id]] Unable to delete inline image draft', error)
    return NextResponse.json({ error: 'Unable to delete image' }, { status: 500 })
  }
}
