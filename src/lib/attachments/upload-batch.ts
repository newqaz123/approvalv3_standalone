import { validateAttachmentMetadata } from './policy'

export interface AttachmentUploadItem {
  id: string
  file: File
  status: 'pending' | 'uploading' | 'success' | 'error'
  attachmentId?: string
  storedSize?: number
  error?: string
}

export type UploadOneAttachment = (item: AttachmentUploadItem) => Promise<
  | { success: true; attachmentId: string; storedSize?: number }
  | { success: false; error: string }
>

export interface AttachmentUploadBatchResult {
  success: boolean
  items: AttachmentUploadItem[]
  attachmentIds: string[]
}

/**
 * Pure, immutable upload batch coordinator.
 *
 * - Produces an explicit final result instead of relying on stale UI state, so
 *   callers can branch on `success`/`attachmentIds` directly.
 * - Reuses previous successes and retries only failures/errors: an item already
 *   in `success` with an `attachmentId` is skipped, so it is never re-uploaded.
 * - Validates each candidate against the shared attachment policy (per-file size
 *   maximum + metadata) before delegating to `uploadOne`; invalid items are
 *   marked `error` without ever invoking the uploader.
 * - Emits immutable snapshots through `onItemChange` for every transition
 *   (`uploading`, terminal `success`/`error`), letting the UI render progress.
 *
 * Has no React or server dependencies and performs no I/O of its own: all
 * network/DB work is isolated behind the injected `uploadOne` callback.
 */
export async function uploadAttachmentBatch(
  input: AttachmentUploadItem[],
  uploadOne: UploadOneAttachment,
  onItemChange?: (item: AttachmentUploadItem) => void
): Promise<AttachmentUploadBatchResult> {
  const items = [...input]
  for (let index = 0; index < items.length; index += 1) {
    const current = items[index]
    // Reuse a previously-confirmed success: skip it so it is never re-uploaded.
    if (current.status === 'success' && current.attachmentId) continue

    // Enforce the shared per-file policy (size maximum + metadata) up front so a
    // guaranteed-failure is caught without a round-trip through `uploadOne`.
    const policyError = validateAttachmentMetadata({
      name: current.file.name,
      type: current.file.type,
      size: current.file.size,
    })
    if (policyError) {
      const errored: AttachmentUploadItem = { ...current, status: 'error', error: policyError }
      items[index] = errored
      onItemChange?.(errored)
      continue
    }

    // `error: undefined` clears any prior failure message when retrying an item
    // that was previously in the `error` state.
    const uploading: AttachmentUploadItem = { ...current, status: 'uploading', error: undefined }
    items[index] = uploading
    onItemChange?.(uploading)

    // A transport-level failure (e.g. HTTP 500) rejects `uploadOne` instead of
    // returning an explicit `{ success:false }`. Catch it so the item reaches a
    // terminal `error` state (and emits its snapshot), the rest of the batch
    // keeps running, and the caller can retry just this item later. The message
    // is normalized to a stable fallback when the rejection carries nothing
    // usable, so the UI always has something to render.
    let result
    try {
      result = await uploadOne(uploading)
    } catch (thrown) {
      const message =
        thrown instanceof Error && thrown.message
          ? thrown.message
          : 'Upload failed'
      const errored: AttachmentUploadItem = { ...uploading, status: 'error', error: message }
      items[index] = errored
      onItemChange?.(errored)
      continue
    }
    items[index] = result.success
      ? {
          ...uploading,
          status: 'success',
          attachmentId: result.attachmentId,
          storedSize: result.storedSize,
        }
      : { ...uploading, status: 'error', error: result.error }
    onItemChange?.(items[index])
  }

  const attachmentIds = items.flatMap((entry) =>
    entry.status === 'success' && entry.attachmentId ? [entry.attachmentId] : []
  )
  return {
    success: items.every((entry) => entry.status === 'success'),
    items,
    attachmentIds,
  }
}
