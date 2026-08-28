import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth-config'
import {
  InlineImageForbiddenError,
  InlineImagePayloadTooLargeError,
  InlineImageValidationError,
  createInlineImageDraft,
} from '@/lib/inline-images/lifecycle'

const UploadSessionSchema = z.string().uuid()

function isInlineImageFile(value: FormDataEntryValue | null): value is File {
  return value !== null
    && typeof value !== 'string'
    && typeof value.name === 'string'
    && typeof value.type === 'string'
    && typeof value.size === 'number'
    && typeof value.arrayBuffer === 'function'
}

/** Creates a private, owner/session-scoped inline image draft from multipart data. */
export async function POST(request: Request) {
  const { user } = (await auth()) ?? {}
  if (!user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid multipart form data' }, { status: 400 })
  }

  const file = formData.get('file')
  const uploadSessionId = formData.get('uploadSessionId')
  if (!isInlineImageFile(file) || typeof uploadSessionId !== 'string') {
    return NextResponse.json({ error: 'Image file and upload session are required' }, { status: 400 })
  }
  if (!UploadSessionSchema.safeParse(uploadSessionId).success) {
    return NextResponse.json({ error: 'Invalid upload session id' }, { status: 400 })
  }

  try {
    const upload = await createInlineImageDraft({
      userId: user.id,
      uploadSessionId,
      file,
    })
    return NextResponse.json(upload, { status: 201 })
  } catch (error) {
    if (error instanceof InlineImagePayloadTooLargeError) {
      return NextResponse.json({ error: error.message }, { status: 413 })
    }
    if (error instanceof InlineImageForbiddenError) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (error instanceof InlineImageValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    console.error('[POST /api/inline-images] Unable to create inline image draft', error)
    return NextResponse.json({ error: 'Unable to upload image' }, { status: 500 })
  }
}
