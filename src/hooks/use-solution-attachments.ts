'use client'

import { useCallback, useRef, useState } from 'react'
import {
  uploadAttachmentBatch,
  type AttachmentUploadItem,
  type AttachmentUploadBatchResult,
  type UploadOneAttachment,
} from '@/lib/attachments/upload-batch'
import {
  uploadSolutionDraftAttachmentAction,
  cleanupSolutionDraftAttachments,
} from '@/server-actions/files'

export interface UseSolutionAttachmentsResult {
  items: AttachmentUploadItem[]
  addFiles: (files: File[]) => void
  removeItem: (id: string) => Promise<void>
  ensureUploaded: () => Promise<AttachmentUploadBatchResult>
  cleanupDrafts: () => Promise<void>
  reset: () => Promise<void>
}

/**
 * React hook that owns the immutable `AttachmentUploadItem[]` state for a
 * solution's draft attachments and coordinates upload / retry / cleanup.
 *
 * Design rules enforced here (per the solution-upload-reliability plan):
 *
 * - **Stable IDs.** Each item gets a `crypto.randomUUID()` at selection time
 *   and keeps that id for its entire lifecycle (pending → uploading →
 *   success/error). State updates are always functional (`setItems((prev) => …)`
 *   and keyed by the stable id, so React reconciliation is deterministic.
 *
 * - **No stale closures.** A `useRef` mirrors the latest `items` on every
 *   render. Every async callback (`ensureUploaded`, `removeItem`,
 *   `cleanupDrafts`, `reset`) reads from the ref — never from the captured
 *   render-scope `items` — so it never acts on stale state.
 *
 * - **`ensureUploaded` returns the coordinator result directly.** It snapshots
 *   the current items from the ref, calls `uploadAttachmentBatch`, replaces
 *   state with `result.items`, and returns that result. The caller branches on
 *   `result.success` / `result.attachmentIds` — never on pre-call UI state.
 *
 * - **`removeItem` cleans the server first and never swallows a cleanup
 *   failure.** If the item has a staged `attachmentId`,
 *   `cleanupSolutionDraftAttachments` runs before the item leaves local state.
 *   A failed cleanup (or a thrown error) propagates so the caller can surface
 *   it; the item is only removed once cleanup succeeds.
 *
 * - **`cleanupDrafts` batches all successful staged ids** into a single
 *   `cleanupSolutionDraftAttachments` call.
 *
 * - **`reset` clears local state only after cleanup returns.** Any remaining
 *   staged drafts are removed server-side first; only then does local state
 *   reset to `[]`.
 *
 * - **Live progress.** While `uploadAttachmentBatch` runs, `onItemChange`
 *   updates each item's status (`uploading` → terminal) so the UI renders
 *   progress incrementally; the final `setItems(result.items)` reconciles the
 *   authoritative terminal state.
 */
export function useSolutionAttachments({
  requestId,
}: {
  requestId: string
}): UseSolutionAttachmentsResult {
  const [items, setItems] = useState<AttachmentUploadItem[]>([])

  // Mirror the latest items so async callbacks never read a stale React closure.
  const itemsRef = useRef(items)
  itemsRef.current = items

  const addFiles = useCallback((files: File[]) => {
    const newItems: AttachmentUploadItem[] = files.map((file) => ({
      id: crypto.randomUUID(),
      file,
      status: 'pending' as const,
    }))
    setItems((prev) => [...prev, ...newItems])
  }, [])

  const removeItem = useCallback(
    async (id: string) => {
      const current = itemsRef.current.find((entry) => entry.id === id)
      // If the item has been staged on the server, clean it up there first.
      // A cleanup failure must never be silently lost — propagate it so the
      // caller can surface it and the user can retry.
      if (current?.status === 'success' && current.attachmentId) {
        const result = await cleanupSolutionDraftAttachments({
          requestId,
          attachmentIds: [current.attachmentId],
        })
        if (!result.success) {
          throw new Error(result.error)
        }
      }
      setItems((prev) => prev.filter((entry) => entry.id !== id))
    },
    [requestId]
  )

  const ensureUploaded = useCallback(async (): Promise<AttachmentUploadBatchResult> => {
    // Snapshot from the ref — never from the render-scope closure — so the
    // batch always operates on the authoritative current items.
    const snapshot = itemsRef.current
    const uploadOne: UploadOneAttachment = async (entry) => {
      const formData = new FormData()
      formData.append('file', entry.file)
      formData.append('requestId', requestId)
      const actionResult = await uploadSolutionDraftAttachmentAction(null, formData)
      return actionResult.success
        ? { success: true, attachmentId: actionResult.attachmentId }
        : { success: false, error: actionResult.error }
    }
    // `onItemChange` mirrors each transition into React state for live progress;
    // the final `setItems(result.items)` replaces state with the authoritative
    // terminal array returned by the coordinator.
    const result = await uploadAttachmentBatch(snapshot, uploadOne, (changed) => {
      setItems((prev) => prev.map((entry) => (entry.id === changed.id ? changed : entry)))
    })
    setItems(result.items)
    return result
  }, [requestId])

  const cleanupDrafts = useCallback(async () => {
    // Batch every successful staged id into a single cleanup call.
    const stagedIds = itemsRef.current
      .filter((entry) => entry.status === 'success' && entry.attachmentId)
      .map((entry) => entry.attachmentId as string)
    if (stagedIds.length === 0) return
    const result = await cleanupSolutionDraftAttachments({
      requestId,
      attachmentIds: stagedIds,
    })
    if (!result.success) {
      throw new Error(result.error)
    }
  }, [requestId])

  const reset = useCallback(async () => {
    // Clear local state only after cleanup returns. Any remaining staged drafts
    // are removed server-side first so nothing is orphaned.
    const stagedIds = itemsRef.current
      .filter((entry) => entry.status === 'success' && entry.attachmentId)
      .map((entry) => entry.attachmentId as string)
    if (stagedIds.length > 0) {
      const result = await cleanupSolutionDraftAttachments({
        requestId,
        attachmentIds: stagedIds,
      })
      if (!result.success) {
        throw new Error(result.error)
      }
    }
    setItems([])
  }, [requestId])

  return { items, addFiles, removeItem, ensureUploaded, cleanupDrafts, reset }
}
