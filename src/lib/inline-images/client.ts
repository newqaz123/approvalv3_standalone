import type { InlineImageUpload } from '@/lib/inline-images/policy'

export type InlineImageUploadTransport = (
  file: File,
  uploadSessionId: string,
  onProgress: (percent: number) => void,
) => Promise<InlineImageUpload>

export type InlineImageDeleteTransport = (
  imageId: string,
  uploadSessionId: string,
) => Promise<void>

function responseError(body: unknown, fallback: string): Error {
  if (typeof body === 'object' && body !== null && 'error' in body) {
    const message = (body as { error?: unknown }).error
    if (typeof message === 'string' && message.length > 0) return new Error(message)
  }
  return new Error(fallback)
}

/** Uploads one inline image with browser-visible multipart upload progress. */
export function uploadInlineImage(
  file: File,
  uploadSessionId: string,
  onProgress: (percent: number) => void,
): Promise<InlineImageUpload> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/inline-images')
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100))
      }
    }
    xhr.onerror = () => reject(new Error('Image upload failed'))
    xhr.onabort = () => reject(new Error('Image upload failed'))
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText || '{}') as InlineImageUpload)
        } catch {
          reject(new Error('Image upload failed'))
        }
        return
      }

      let body: unknown = null
      try {
        body = JSON.parse(xhr.responseText || '{}')
      } catch {
        // Use the stable fallback below when the server did not return JSON.
      }
      reject(responseError(body, 'Image upload failed'))
    }
    const data = new FormData()
    data.append('file', file)
    data.append('uploadSessionId', uploadSessionId)
    xhr.send(data)
  })
}

/** Deletes one owner/session-scoped draft; a missing draft is already cleaned. */
export async function deleteInlineImage(
  imageId: string,
  uploadSessionId: string,
): Promise<void> {
  const response = await fetch(`/api/inline-images/${encodeURIComponent(imageId)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uploadSessionId }),
  })

  if (response.status === 404 || response.ok) return

  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    // Use a stable fallback when the server did not return JSON.
  }
  throw responseError(body, 'Image deletion failed')
}
