'use client'

import { useEffect, useRef, useState } from 'react'
import { MAX_ATTACHMENTS_PER_FORM } from '@/lib/attachments/policy'

const STAGE_URL = '/api/attachments/stage'

export type StagedItemStatus = 'pending' | 'uploading' | 'success' | 'error'

export interface StagedItem {
  /** Canonical client-generated attachmentId UUID. Stable across retry. */
  id: string
  file: File
  status: StagedItemStatus
  /** Real byte progress 0–100. Updated only from `xhr.upload.onprogress`. */
  progress: number
  /** Server-echoed attachmentId, stored only after a successful finalize. */
  attachmentId?: string
  /** Stable server uploadToken from PUT; reused for every XHR of this item. */
  uploadToken?: string
  fileName?: string
  fileType?: string
  fileSize?: number
  error?: string
  /** Set synchronously on remove/reset; item stays until DELETE succeeds. */
  cleanupRequested?: boolean
}

export interface UseStagedRequestAttachmentsResult {
  items: StagedItem[]
  addFiles: (files: File[]) => void
  retryItem: (id: string) => void
  removeItem: (id: string) => void
  /** Cancel/close: abort in-flight uploads and DELETE every draft, then drop local state. */
  reset: () => Promise<void>
  /**
   * Post-commit local clear: drop local state without DELETE.
   * Draft rows have already been adopted by `createRequest`; deleting them
   * would race the commit and could unlink adopted files.
   */
  clear: () => void
  hasBlockingOperations: boolean
  readyAttachmentIds: string[]
}

export type StagedUploadResult = {
  attachmentId: string
  fileName: string
  fileType: string
  fileSize: number
}

export type StagedReservationResult = {
  attachmentId: string
  uploadToken: string
  alreadyReady: boolean
  fileName?: string
  fileType?: string
  fileSize?: number
}

export type StagedUploadHandlers = {
  onProgress?: (percent: number) => void
  xhrRef?: (xhr: XMLHttpRequest) => void
}

export type StagedAttachmentTransports = {
  reserve: (file: File, attachmentId: string) => Promise<StagedReservationResult>
  upload: (
    file: File,
    attachmentId: string,
    uploadToken: string,
    handlers?: StagedUploadHandlers,
  ) => Promise<StagedUploadResult>
  remove: (attachmentId: string) => Promise<void>
}

export type StagedRequestAttachmentsSnapshot = {
  items: StagedItem[]
  hasBlockingOperations: boolean
  readyAttachmentIds: string[]
}

export type StagedRequestAttachmentsController = {
  snapshot: () => StagedRequestAttachmentsSnapshot
  subscribe: (listener: () => void) => () => void
  addFiles: (files: File[]) => void
  retryItem: (id: string) => void
  removeItem: (id: string) => void
  reset: () => Promise<void>
  clear: () => void
  unmount: () => void
}

type UploadAttempt = {
  xhr: XMLHttpRequest | null
  cancelled: boolean
  /** True only while PUT is in flight. Terminal PUT rejection clears the attempt. */
  reservePending: boolean
  reserved: boolean
  finished: Promise<void>
  resolveFinished: () => void
}

type ItemsRef = { current: StagedItem[] }

function errorMessage(body: unknown, fallback: string): string {
  if (typeof body === 'object' && body !== null && 'error' in body) {
    const message = (body as { error?: unknown }).error
    if (typeof message === 'string' && message.length > 0) return message
  }
  return fallback
}

export function isStagedUploadResult(body: unknown): body is StagedUploadResult {
  if (typeof body !== 'object' || body === null) return false
  const value = body as Partial<StagedUploadResult>
  return (
    typeof value.attachmentId === 'string'
    && value.attachmentId.length > 0
    && typeof value.fileName === 'string'
    && value.fileName.length > 0
    && typeof value.fileType === 'string'
    && typeof value.fileSize === 'number'
    && Number.isFinite(value.fileSize)
  )
}

export function isStagedReservationResult(body: unknown): body is StagedReservationResult {
  if (typeof body !== 'object' || body === null) return false
  const value = body as Partial<StagedReservationResult>
  if (typeof value.attachmentId !== 'string' || value.attachmentId.length === 0) return false
  if (typeof value.uploadToken !== 'string' || value.uploadToken.length === 0) return false
  if (value.alreadyReady === true) {
    return (
      typeof value.fileName === 'string'
      && value.fileName.length > 0
      && typeof value.fileType === 'string'
      && typeof value.fileSize === 'number'
      && Number.isFinite(value.fileSize)
    )
  }
  return value.alreadyReady === false
}

export function isCancelledReservationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /cancelled/i.test(message)
}

function createAttempt(): UploadAttempt {
  let resolveFinished!: () => void
  const finished = new Promise<void>((resolve) => {
    resolveFinished = resolve
  })
  return { xhr: null, cancelled: false, reservePending: true, reserved: false, finished, resolveFinished }
}

/**
 * Append pending items to the ref synchronously so `startUpload` can run
 * before React flushes the matching `setState`. Each item's `id` is the
 * canonical attachmentId posted with the file. Extra files beyond
 * `MAX_ATTACHMENTS_PER_FORM` are dropped.
 */
export function enqueueStagedFiles(
  itemsRef: ItemsRef,
  files: File[],
  maxAttachments = MAX_ATTACHMENTS_PER_FORM,
): StagedItem[] {
  const room = Math.max(0, maxAttachments - itemsRef.current.length)
  const accepted = files.slice(0, room)
  const newItems: StagedItem[] = accepted.map((file) => ({
    id: crypto.randomUUID(),
    file,
    status: 'pending',
    progress: 0,
  }))
  itemsRef.current = [...itemsRef.current, ...newItems]
  return newItems
}

export async function deleteOrKeepStagedItem(
  item: StagedItem,
  remove: (attachmentId: string) => Promise<void> = deleteStagedAttachment,
): Promise<{ drop: true } | { drop: false; item: StagedItem }> {
  try {
    await remove(item.id)
    return { drop: true }
  } catch (error) {
    const message = error instanceof Error && error.message
      ? error.message
      : 'Failed to delete staged file'
    return {
      drop: false,
      item: {
        ...item,
        cleanupRequested: true,
        status: item.status === 'success' ? 'success' : 'error',
        attachmentId: item.attachmentId ?? item.id,
        error: message,
      },
    }
  }
}

/** PUT reservation JSON before the XHR file POST so DELETE always has a row. */
export async function reserveStagedAttachment(
  file: File,
  attachmentId: string,
): Promise<StagedReservationResult> {
  const response = await fetch(STAGE_URL, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      attachmentId,
      fileName: file.name,
      fileType: file.type,
      fileSize: file.size,
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

/** POST one file to the staging route with real `upload.onprogress` bytes. */
export function uploadStagedAttachment(
  file: File,
  attachmentId: string,
  uploadToken: string,
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
    xhr.send(data)
  })
}

/** DELETE one owner-scoped draft by attachmentId. Non-2xx is a cleanup failure. */
export async function deleteStagedAttachment(attachmentId: string): Promise<void> {
  const response = await fetch(STAGE_URL, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ attachmentId }),
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

export function isReadyAttachment(item: StagedItem): item is StagedItem & { attachmentId: string } {
  return (
    item.cleanupRequested !== true
    && item.status === 'success'
    && typeof item.attachmentId === 'string'
    && item.attachmentId.length > 0
    && item.attachmentId === item.id
  )
}

export function isBlockingStagedItem(
  item: Pick<StagedItem, 'status' | 'cleanupRequested'>,
): boolean {
  return (
    item.status === 'pending'
    || item.status === 'uploading'
    || item.status === 'error'
    || item.cleanupRequested === true
  )
}

export function canRetryStagedUpload(
  item: Pick<StagedItem, 'status' | 'cleanupRequested'>,
): boolean {
  return item.status === 'error' && item.cleanupRequested !== true
}

function toSnapshot(items: StagedItem[]): StagedRequestAttachmentsSnapshot {
  return {
    items,
    hasBlockingOperations: items.some(isBlockingStagedItem),
    readyAttachmentIds: items.filter(isReadyAttachment).map((item) => item.attachmentId),
  }
}

/**
 * Non-React controller for request-draft staging. The hook is a thin
 * subscriber; lifecycle tests drive this object directly.
 */
export function createStagedRequestAttachmentsController(
  transports: StagedAttachmentTransports = {
    reserve: reserveStagedAttachment,
    upload: uploadStagedAttachment,
    remove: deleteStagedAttachment,
  },
  options: { maxAttachments?: number } = {},
): StagedRequestAttachmentsController {
  const maxAttachments = options.maxAttachments ?? MAX_ATTACHMENTS_PER_FORM
  const itemsRef: ItemsRef = { current: [] }
  const attempts = new Map<string, UploadAttempt>()
  const listeners = new Set<() => void>()
  let skipCleanup = false

  function emit() {
    for (const listener of listeners) listener()
  }

  function setItems(next: StagedItem[]) {
    itemsRef.current = next
    emit()
  }

  function patchItem(id: string, patch: Partial<StagedItem>) {
    setItems(itemsRef.current.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  }

  function isCurrentAttempt(id: string, attempt: UploadAttempt) {
    return !attempt.cancelled && attempts.get(id) === attempt
  }

  async function applyCleanupResult(
    id: string,
    result: Awaited<ReturnType<typeof deleteOrKeepStagedItem>>,
  ) {
    if (!result.drop) {
      patchItem(id, {
        cleanupRequested: true,
        status: result.item.status,
        attachmentId: result.item.attachmentId,
        fileName: result.item.fileName,
        fileType: result.item.fileType,
        fileSize: result.item.fileSize,
        error: result.item.error,
      })
      return
    }
    if (!itemsRef.current.some((item) => item.id === id)) return
    setItems(itemsRef.current.filter((item) => item.id !== id))
  }

  function startUpload(id: string, file: File) {
    const current = itemsRef.current.find((item) => item.id === id)
    if (current?.cleanupRequested) return
    const previous = attempts.get(id)
    if (previous) {
      previous.cancelled = true
      previous.xhr?.abort()
    }

    const attempt = createAttempt()
    attempts.set(id, attempt)
    patchItem(id, {
      status: 'uploading',
      progress: 0,
      error: undefined,
      attachmentId: undefined,
      fileName: undefined,
      fileType: undefined,
      fileSize: undefined,
    })

    void (async () => {
      let reservation: StagedReservationResult | undefined
      try {
        reservation = await transports.reserve(file, id)
        attempt.reserved = true
        attempt.reservePending = false
        patchItem(id, { uploadToken: reservation.uploadToken })
      } catch (error: unknown) {
        attempt.reservePending = false
        attempts.delete(id)
        const latest = itemsRef.current.find((item) => item.id === id)
        const cancelled = isCancelledReservationError(error)
        if (cancelled || latest?.cleanupRequested) {
          const target = latest ?? { id, file, status: 'error' as const, progress: 0, cleanupRequested: true }
          await applyCleanupResult(id, await deleteOrKeepStagedItem({
            ...target,
            cleanupRequested: true,
          }, transports.remove))
          return
        }
        if (attempt.cancelled) return
        const message = error instanceof Error && error.message
          ? error.message
          : 'Attachment reservation failed'
        patchItem(id, { status: 'error', error: message })
        return
      }

      if (skipCleanup) return
      const afterReserve = itemsRef.current.find((item) => item.id === id)
      if (!isCurrentAttempt(id, attempt) || afterReserve?.cleanupRequested) {
        const target = afterReserve ?? { id, file, status: 'error' as const, progress: 0, cleanupRequested: true }
        await applyCleanupResult(id, await deleteOrKeepStagedItem(target, transports.remove))
        return
      }

      if (reservation.alreadyReady) {
        attempts.delete(id)
        patchItem(id, {
          status: 'success',
          attachmentId: reservation.attachmentId,
          uploadToken: reservation.uploadToken,
          fileName: reservation.fileName,
          fileType: reservation.fileType,
          fileSize: reservation.fileSize,
        })
        return
      }

      try {
        const result = await transports.upload(file, id, reservation.uploadToken, {
          xhrRef(xhr) {
            attempt.xhr = xhr
          },
          onProgress(percent) {
            if (!isCurrentAttempt(id, attempt)) return
            patchItem(id, { progress: percent })
          },
        })
        if (skipCleanup) return
        const latest = itemsRef.current.find((item) => item.id === id)
        if (!isCurrentAttempt(id, attempt) || latest?.cleanupRequested) {
          void transports.remove(result.attachmentId).catch((cleanupError) => {
            console.error('Stale staged upload cleanup failed:', cleanupError)
          })
          return
        }
        attempts.delete(id)
        patchItem(id, {
          status: 'success',
          attachmentId: result.attachmentId,
          fileName: result.fileName,
          fileType: result.fileType,
          fileSize: result.fileSize,
        })
      } catch (error: unknown) {
        if (!isCurrentAttempt(id, attempt)) return
        attempts.delete(id)
        const message = error instanceof Error && error.message
          ? error.message
          : 'Attachment upload failed'
        if (message === 'Attachment upload aborted') return
        patchItem(id, { status: 'error', error: message })
      }
    })().finally(() => {
      attempt.resolveFinished()
    })
  }

  function addFiles(files: File[]) {
    if (files.length === 0) return
    skipCleanup = false
    const newItems = enqueueStagedFiles(itemsRef, files, maxAttachments)
    emit()
    for (const item of newItems) {
      startUpload(item.id, item.file)
    }
  }

  function retryItem(id: string) {
    const current = itemsRef.current.find((item) => item.id === id)
    if (!current) return
    if (current.cleanupRequested) {
      void deleteOrKeepStagedItem(current, transports.remove).then((result) => applyCleanupResult(id, result))
      return
    }
    if (current.status !== 'error') return
    startUpload(id, current.file)
  }

  function removeItem(id: string) {
    const current = itemsRef.current.find((item) => item.id === id)
    if (!current) return
    const attempt = attempts.get(id)
    if (attempt) {
      attempt.cancelled = true
      attempt.xhr?.abort()
    }
    const marked: StagedItem = { ...current, cleanupRequested: true, error: undefined }
    setItems(itemsRef.current.map((item) => (item.id === id ? marked : item)))
    if (attempt?.reservePending) return
    void deleteOrKeepStagedItem(marked, transports.remove).then((result) => applyCleanupResult(id, result))
  }

  function abortAllAttempts() {
    const running = [...attempts.values()]
    for (const attempt of running) {
      attempt.cancelled = true
      attempt.xhr?.abort()
    }
    return running
  }

  async function reset() {
    const running = abortAllAttempts()
    const marked = itemsRef.current.map((item) => ({
      ...item,
      cleanupRequested: true,
      error: undefined,
    }))
    setItems(marked)
    await Promise.all(running.map((attempt) => attempt.finished))
    const snapshot = itemsRef.current
    const results = await Promise.all(
      snapshot.map(async (item) => ({
        result: await deleteOrKeepStagedItem(item, transports.remove),
      })),
    )
    const kept: StagedItem[] = []
    let firstError: Error | undefined
    for (const { result } of results) {
      if (result.drop) continue
      kept.push(result.item)
      if (!firstError) {
        firstError = new Error(result.item.error ?? 'Failed to delete staged file')
      }
    }
    attempts.clear()
    setItems(kept)
    if (firstError) throw firstError
  }

  function clear() {
    skipCleanup = true
    abortAllAttempts()
    attempts.clear()
    setItems([])
  }

  function unmount() {
    if (skipCleanup) return
    abortAllAttempts()
    const attachmentIds = itemsRef.current.map((item) => item.id)
    itemsRef.current = []
    for (const attachmentId of attachmentIds) {
      void transports.remove(attachmentId).catch((error) => {
        console.error('useStagedRequestAttachments unmount cleanup failed:', error)
      })
    }
  }

  return {
    snapshot: () => toSnapshot(itemsRef.current),
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    addFiles,
    retryItem,
    removeItem,
    reset,
    clear,
    unmount,
  }
}

/**
 * Owns request-mode draft uploads. Progress is exclusively
 * `xhr.upload.onprogress` (`loaded / total`). `reset()` is the cancel/close
 * DELETE path; `clear()` is the post-commit local drop that must not DELETE
 * adopted files or race unmount cleanup.
 */
export function useStagedRequestAttachments(): UseStagedRequestAttachmentsResult {
  const controllerRef = useRef<StagedRequestAttachmentsController | null>(null)
  if (!controllerRef.current) {
    controllerRef.current = createStagedRequestAttachmentsController()
  }
  const controller = controllerRef.current
  const [snapshot, setSnapshot] = useState(controller.snapshot)

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
