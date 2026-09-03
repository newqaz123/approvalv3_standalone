'use client'

import { useEffect, useRef, useState } from 'react'
import {
  createStagedRequestAttachmentsController,
  isStagedReservationResult,
  isStagedUploadResult,
  type StagedAttachmentTransports,
  type StagedRequestAttachmentsController,
  type StagedReservationResult,
  type StagedUploadHandlers,
  type StagedUploadResult,
  type UseStagedRequestAttachmentsResult,
} from '@/hooks/use-staged-request-attachments'

const STAGE_URL = '/api/attachments/stage'

/**
 * Solution-scope drafts (plan: XHR Solution/Resubmit Staged Attachments, Task 3).
 * The reviewed request controller is scope-agnostic — every scope decision
 * lives in the transports — so it is reused unchanged here instead of
 * duplicating the lifecycle. `use-staged-request-attachments.ts` stays
 * byte-for-byte untouched: its request-scope transports remain the module
 * defaults there, and this module supplies the `scope: 'solution'` wire
 * variants bound to the target request.
 */

export interface UseStagedSolutionAttachmentsArgs {
  /** Target request the solution answers; drafts are owner-scoped rows with this requestId. */
  requestId: string
}

/** Identical reviewed result shape as the request hook; only the scope differs. */
export type UseStagedSolutionAttachmentsResult = UseStagedRequestAttachmentsResult

function errorMessage(body: unknown, fallback: string): string {
  if (typeof body === 'object' && body !== null && 'error' in body) {
    const message = (body as { error?: unknown }).error
    if (typeof message === 'string' && message.length > 0) return message
  }
  return fallback
}

/** PUT reservation for a solution draft bound to the target request. */
export async function reserveSolutionStagedAttachment(
  file: File,
  attachmentId: string,
  requestId: string,
): Promise<StagedReservationResult> {
  const response = await fetch(STAGE_URL, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      attachmentId,
      fileName: file.name,
      fileType: file.type,
      fileSize: file.size,
      scope: 'solution',
      requestId,
    }),
  })
  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    // Fall through to the stable client-side message.
  }
  if (!response.ok) {
    throw new Error(errorMessage(body, 'Attachment reservation failed'))
  }
  if (!isStagedReservationResult(body)) {
    throw new Error('Attachment reservation failed')
  }
  return body
}

/**
 * POST one file to the solution staging scope with real `upload.onprogress`
 * bytes. Mirrors the reviewed request XHR transport with the scope fields the
 * route requires to CAS against the caller's solution scope.
 */
export function uploadSolutionStagedAttachment(
  file: File,
  attachmentId: string,
  uploadToken: string,
  requestId: string,
  handlers: StagedUploadHandlers = {},
): Promise<StagedUploadResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    handlers.xhrRef?.(xhr)
    xhr.open('POST', STAGE_URL)
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || event.total <= 0) return
      const percent = Math.round((event.loaded / event.total) * 100)
      handlers.onProgress?.(Math.max(0, Math.min(100, percent)))
    }
    xhr.onerror = () => reject(new Error('Attachment upload failed'))
    xhr.onabort = () => reject(new Error('Attachment upload aborted'))
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const body: unknown = JSON.parse(xhr.responseText || '{}')
          if (isStagedUploadResult(body)) {
            resolve(body)
            return
          }
          reject(new Error('Attachment upload failed'))
        } catch {
          reject(new Error('Attachment upload failed'))
        }
        return
      }

      let body: unknown = null
      try {
        body = JSON.parse(xhr.responseText || '{}')
      } catch {
        // Fall through to the stable client-side message.
      }
      reject(new Error(errorMessage(body, 'Attachment upload failed')))
    }
    const data = new FormData()
    data.append('file', file)
    data.append('attachmentId', attachmentId)
    data.append('uploadToken', uploadToken)
    data.append('scope', 'solution')
    data.append('requestId', requestId)
    xhr.send(data)
  })
}

/** DELETE one solution-scope draft by attachmentId. Non-2xx is a cleanup failure. */
export async function deleteSolutionStagedAttachment(
  attachmentId: string,
  requestId: string,
): Promise<void> {
  const response = await fetch(STAGE_URL, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ attachmentId, scope: 'solution', requestId }),
  })
  if (response.ok) return

  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    // Fall through to the stable client-side message.
  }
  throw new Error(errorMessage(body, 'Failed to delete staged file'))
}

/** Reviewed transport seam bound to one solution target request. */
export function createSolutionStagedAttachmentTransports(
  requestId: string,
): StagedAttachmentTransports {
  return {
    reserve: (file, attachmentId) => reserveSolutionStagedAttachment(file, attachmentId, requestId),
    upload: (file, attachmentId, uploadToken, handlers) =>
      uploadSolutionStagedAttachment(file, attachmentId, uploadToken, requestId, handlers),
    remove: (attachmentId) => deleteSolutionStagedAttachment(attachmentId, requestId),
  }
}

/**
 * Owns solution-mode draft uploads with the identical reviewed request
 * lifecycle. The controller is recreated if the target `requestId` changes:
 * its drafts are rows bound to that exact request, so a stale scope is
 * disposed best-effort (a no-op after `clear()`) and staging starts fresh.
 */
export function useStagedSolutionAttachments(
  { requestId }: UseStagedSolutionAttachmentsArgs,
): UseStagedSolutionAttachmentsResult {
  const scopeRef = useRef<{ requestId: string; controller: StagedRequestAttachmentsController } | null>(null)
  if (!scopeRef.current || scopeRef.current.requestId !== requestId) {
    scopeRef.current = {
      requestId,
      controller: createStagedRequestAttachmentsController(
        createSolutionStagedAttachmentTransports(requestId),
      ),
    }
  }
  const controller = scopeRef.current.controller
  const [snapshot, setSnapshot] = useState(controller.snapshot)
  const [snapshotRequestId, setSnapshotRequestId] = useState(requestId)
  if (snapshotRequestId !== requestId) {
    // Reset state during render so a changed target never renders the stale
    // scope's items (React-sanctioned prop-change reset).
    setSnapshotRequestId(requestId)
    setSnapshot(controller.snapshot())
  }

  useEffect(() => controller.subscribe(() => setSnapshot(controller.snapshot())), [controller])
  useEffect(() => () => controller.unmount(), [controller])

  return {
    items: snapshot.items,
    addFiles: controller.addFiles,
    retryItem: controller.retryItem,
    removeItem: controller.removeItem,
    reset: controller.reset,
    clear: controller.clear,
    hasBlockingOperations: snapshot.hasBlockingOperations,
    readyAttachmentIds: snapshot.readyAttachmentIds,
  }
}
