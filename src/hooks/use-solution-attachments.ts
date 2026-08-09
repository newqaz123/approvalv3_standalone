'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
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
  /**
   * Clears local item state **without** invoking server cleanup.
   *
   * Use this only after a successful `submitSolution`/`resubmitSolution` has
   * linked the draft rows to a committed solution (`solutionId` set). At that
   * point the drafts are no longer deletable via `cleanupSolutionDraftAttachments`
   * (which scopes to `solutionId: null`), so `reset()`/`cleanupDrafts()` would
   * throw a count-mismatch error. `clear()` drops the local references safely.
   *
   * `itemsRef.current` is nulled synchronously **before** `setItems([])` so any
   * same-tick callback reading the ref cannot observe the now-linked IDs.
   */
  clear: () => void
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
 *   reset to `[]`. Use `reset` on cancel/close, when drafts are still unlinked.
 *
 * - **`clear` drops local state without server cleanup.** Use `clear` only
 *   after a successful submit/resubmit has linked the drafts to a committed
 *   solution. At that point the rows are `solutionId`-scoped, so
 *   `reset`/`cleanupDrafts` would throw a count-mismatch; `clear` avoids that
 *   by nulling both the ref and state synchronously.
 *
 * - **Unmount safety net.** A `useEffect` cleanup snapshots `itemsRef.current`
 *   on unmount and fires best-effort owner-scoped cleanup for any remaining
 *   staged (unlinked) drafts — e.g. when the user navigates away via browser
 *   back. After a successful submit `clear()` has already nulled the ref, so
 *   the safety net is a no-op and cleanup never runs on linked attachments.
 *   Hard-unload (tab close, refresh) may not fire this cleanup; the
 *   deterministic Cancel button (which awaits `reset()`) is the primary
 *   guarantee.
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

  // Unmount safety net: if the component unmounts while staged (unlinked)
  // drafts remain in the ref — e.g. the user navigated away via browser back
  // rather than the deterministic Cancel button — fire owner-scoped cleanup
  // as best-effort. After a successful submit, clear() has already nulled
  // itemsRef.current, so this is a no-op and cleanup never runs on linked
  // attachments. This is a best-effort safety net; hard-unload (tab close,
  // refresh) may not fire this cleanup — the deterministic Cancel button is
  // the primary guarantee.
  useEffect(() => {
    return () => {
      const stagedIds = itemsRef.current
        .filter((entry) => entry.status === 'success' && entry.attachmentId)
        .map((entry) => entry.attachmentId as string)
      if (stagedIds.length === 0) return
      void cleanupSolutionDraftAttachments({
        requestId,
        attachmentIds: stagedIds,
      }).catch((error) => {
        console.error('useSolutionAttachments unmount cleanup failed:', error)
      })
    }
  }, [requestId])

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
    // Null the ref synchronously so the unmount safety net (which reads
    // itemsRef.current) does not double-clean drafts that reset just deleted.
    itemsRef.current = []
    setItems([])
  }, [requestId])

  const clear = useCallback(() => {
    // Drop local references to drafts that are now linked to a committed
    // solution WITHOUT invoking server cleanup (which would fail on
    // solutionId-scoped rows). The ref is nulled synchronously before the
    // state update so no same-tick callback can observe the linked IDs.
    itemsRef.current = []
    setItems([])
  }, [])

  return { items, addFiles, removeItem, ensureUploaded, cleanupDrafts, reset, clear }
}
