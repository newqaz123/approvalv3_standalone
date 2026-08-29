'use client'

import { useEffect, useRef, useState } from 'react'
import {
  deleteInlineImage,
  uploadInlineImage,
  type InlineImageDeleteTransport,
  type InlineImageUploadTransport,
} from '@/lib/inline-images/client'
import {
  MAX_CONCURRENT_INLINE_UPLOADS,
  type InlineImageUpload,
} from '@/lib/inline-images/policy'

export type { InlineImageDeleteTransport, InlineImageUploadTransport } from '@/lib/inline-images/client'

export type InlineImageUploadStatus = 'queued' | 'uploading' | 'failed' | 'success'
export type InlineImageBlockingReason = 'upload' | 'image-edit' | null

export function inlineImageBlockingMessage(reason: InlineImageBlockingReason): string | null {
  if (reason === 'upload') return 'Wait for image uploads, or retry/remove failed images.'
  if (reason === 'image-edit') return 'Apply or cancel the image edit before saving.'
  return null
}

export type InlineImageRecord = {
  uploadId: string
  file: File
  status: InlineImageUploadStatus
  progress: number
  imageId?: string
  upload?: InlineImageUpload
  error?: string
}

export type InlineImageReducerAction =
  | { type: 'queued'; uploadId: string; file: File }
  | { type: 'uploading'; uploadId: string }
  | { type: 'progress'; uploadId: string; percent: number }
  | { type: 'failed'; uploadId: string; error: string }
  | { type: 'succeeded'; uploadId: string; upload: InlineImageUpload }
  | { type: 'removed'; uploadId: string }
  | { type: 'cleared' }

function updateRecord(
  state: InlineImageRecord[],
  uploadId: string,
  update: (record: InlineImageRecord) => InlineImageRecord,
): InlineImageRecord[] {
  return state.map((record) => record.uploadId === uploadId ? update(record) : record)
}

/** Pure state transitions used by the upload queue and its focused tests. */
export function inlineImageReducer(
  state: InlineImageRecord[],
  action: InlineImageReducerAction,
): InlineImageRecord[] {
  switch (action.type) {
    case 'queued': {
      const existing = state.some((record) => record.uploadId === action.uploadId)
      if (existing) {
        return updateRecord(state, action.uploadId, (record) => ({
          uploadId: record.uploadId,
          file: action.file,
          status: 'queued',
          progress: 0,
        }))
      }
      return [
        ...state,
        {
          uploadId: action.uploadId,
          file: action.file,
          status: 'queued',
          progress: 0,
        },
      ]
    }
    case 'uploading':
      return updateRecord(state, action.uploadId, (record) => ({
        uploadId: record.uploadId,
        file: record.file,
        status: 'uploading',
        progress: record.progress,
      }))
    case 'progress':
      return updateRecord(state, action.uploadId, (record) => ({
        ...record,
        progress: Math.max(0, Math.min(100, Math.round(action.percent))),
      }))
    case 'failed':
      return updateRecord(state, action.uploadId, (record) => ({
        uploadId: record.uploadId,
        file: record.file,
        status: 'failed',
        progress: record.progress,
        error: action.error,
      }))
    case 'succeeded':
      return updateRecord(state, action.uploadId, (record) => ({
        uploadId: record.uploadId,
        file: record.file,
        status: 'success',
        progress: 100,
        imageId: action.upload.id,
        upload: action.upload,
      }))
    case 'removed':
      return state.filter((record) => record.uploadId !== action.uploadId)
    case 'cleared':
      return []
  }
}

export function hasBlockingInlineImageUploads(records: InlineImageRecord[]): boolean {
  return records.some((record) => (
    record.status === 'queued'
    || record.status === 'uploading'
    || record.status === 'failed'
  ))
}

export type InlineImageCoordinator = {
  uploadSessionId: string
  upload(uploadId: string, file: File, onProgress: (percent: number) => void): Promise<InlineImageUpload>
  remove(uploadId: string, imageId?: string): Promise<void>
  beginImageEdit(editId: string): void
  endImageEdit(editId: string): void
  hasBlockingUploads: boolean
  hasActiveImageEdits: boolean
  hasBlockingOperations: boolean
  blockingReason: InlineImageBlockingReason
  reset(): Promise<void>
  clear(): void
}

export type InlineImageCoordinatorOptions = {
  upload?: InlineImageUploadTransport
  remove?: InlineImageDeleteTransport
  uploadSessionId?: string
  createUploadSessionId?: () => string
  onStateChange?: (records: InlineImageRecord[]) => void
}

export type InlineImageCoordinatorRuntime = InlineImageCoordinator & {
  getState(): InlineImageRecord[]
  dispose(): void
}

type DeferredUpload = {
  promise: Promise<InlineImageUpload>
  resolve: (upload: InlineImageUpload) => void
  reject: (reason?: unknown) => void
}

type UploadAttempt = {
  file: File
  sessionId: string
  callbacks: Array<(percent: number) => void>
  deferred: DeferredUpload
  completion: Promise<void>
  resolveCompletion: () => void
  settled: boolean
  cancelled: boolean
  cleanupOnCompletion: boolean
}

function createAttemptCompletion(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function createDeferredUpload(): DeferredUpload {
  let resolve!: (upload: InlineImageUpload) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<InlineImageUpload>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function createSessionId(): string {
  if (typeof crypto === 'undefined' || typeof crypto.randomUUID !== 'function') {
    throw new Error('Browser crypto.randomUUID is required for inline image uploads')
  }
  return crypto.randomUUID()
}

function errorFromUnknown(error: unknown): Error {
  return error instanceof Error && error.message
    ? error
    : new Error('Image upload failed')
}

/**
 * Creates a form-scoped upload coordinator without React or network state
 * hidden in the editor. The hook below owns one instance for the lifetime of
 * each form; this factory keeps queue behavior deterministic and injectable.
 */
export function createInlineImageCoordinator(
  options: InlineImageCoordinatorOptions = {},
): InlineImageCoordinatorRuntime {
  const uploadTransport = options.upload ?? uploadInlineImage
  const deleteTransport = options.remove ?? deleteInlineImage
  const makeSessionId = options.createUploadSessionId ?? createSessionId
  let sessionId = options.uploadSessionId ?? makeSessionId()
  let records: InlineImageRecord[] = []
  let pendingUploadIds: string[] = []
  let activeUploads = 0
  let disposed = false
  let resetting = false
  let resetPromise: Promise<void> | null = null
  const attempts = new Map<string, UploadAttempt>()
  const activeEditIds = new Set<string>()

  const snapshot = (): InlineImageRecord[] => records.map((record) => ({ ...record }))
  const notify = () => options.onStateChange?.(snapshot())
  const dispatch = (action: InlineImageReducerAction) => {
    records = inlineImageReducer(records, action)
    notify()
  }
  const getRecord = (uploadId: string) => records.find((record) => record.uploadId === uploadId)

  const settleAttempt = (
    uploadId: string,
    attempt: UploadAttempt,
    outcome: { upload: InlineImageUpload } | { error: unknown },
  ) => {
    if (attempt.settled) return
    attempt.settled = true
    if (attempts.get(uploadId) === attempt) attempts.delete(uploadId)
    if ('upload' in outcome) {
      attempt.deferred.resolve(outcome.upload)
    } else {
      attempt.deferred.reject(outcome.error)
    }
  }

  const pump = () => {
    while (!disposed && !resetting && activeUploads < MAX_CONCURRENT_INLINE_UPLOADS && pendingUploadIds.length > 0) {
      const uploadId = pendingUploadIds.shift()!
      const attempt = attempts.get(uploadId)
      const record = getRecord(uploadId)
      if (!attempt || attempt.cancelled || !record || record.status !== 'queued') continue

      activeUploads += 1
      void runAttempt(uploadId, attempt).finally(() => {
        activeUploads -= 1
        attempt.resolveCompletion()
        pump()
      })
    }
  }

  const runAttempt = async (uploadId: string, attempt: UploadAttempt): Promise<void> => {
    const record = getRecord(uploadId)
    if (record && record.status === 'queued' && !attempt.cancelled) {
      dispatch({ type: 'uploading', uploadId })
    }

    try {
      const result = await uploadTransport(attempt.file, attempt.sessionId, (percent) => {
        if (attempt.cancelled) return
        const current = getRecord(uploadId)
        if (current?.status === 'uploading') {
          dispatch({ type: 'progress', uploadId, percent })
        }
        for (const callback of attempt.callbacks) {
          try {
            callback(percent)
          } catch {
            // A view callback must not turn a successful network upload into a failure.
          }
        }
      })

      const current = getRecord(uploadId)
      if (attempt.cancelled || disposed || !current) {
        if (attempt.cleanupOnCompletion) {
          void deleteTransport(result.id, attempt.sessionId).catch(() => undefined)
        }
      } else {
        dispatch({ type: 'succeeded', uploadId, upload: result })
      }
      settleAttempt(uploadId, attempt, { upload: result })
    } catch (error) {
      const normalized = errorFromUnknown(error)
      const current = getRecord(uploadId)
      if (!attempt.cancelled && !disposed && current?.status === 'uploading') {
        dispatch({ type: 'failed', uploadId, error: normalized.message })
      }
      settleAttempt(uploadId, attempt, { error: normalized })
    }
  }

  const cancelPendingAttempt = (uploadId: string, attempt: UploadAttempt | undefined) => {
    const pendingIndex = pendingUploadIds.indexOf(uploadId)
    if (pendingIndex !== -1) pendingUploadIds.splice(pendingIndex, 1)
    if (!attempt) return
    attempt.cancelled = true
    if (!attempt.settled) {
      settleAttempt(uploadId, attempt, { error: new Error('Image upload was removed') })
      attempt.resolveCompletion()
    }
  }

  const deleteStaged = async (imageIds: string[], sessionForDeletes: string): Promise<void> => {
    const uniqueIds = [...new Set(imageIds)]
    const results = await Promise.allSettled(
      uniqueIds.map((imageId) => Promise.resolve().then(() => deleteTransport(imageId, sessionForDeletes))),
    )
    const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
    if (failure) throw errorFromUnknown(failure.reason)
  }

  const clearState = () => {
    for (const [uploadId, attempt] of attempts) {
      if (!attempt.settled) {
        attempt.cancelled = true
        attempt.cleanupOnCompletion = false
        settleAttempt(uploadId, attempt, { error: new Error('Image upload was cleared') })
      }
    }
    pendingUploadIds = []
    records = []
    activeEditIds.clear()
    sessionId = makeSessionId()
    notify()
  }

  const clearActiveImageEdits = () => {
    if (activeEditIds.size === 0) return
    activeEditIds.clear()
    notify()
  }

  const runtime: InlineImageCoordinatorRuntime = {
    get uploadSessionId() {
      return sessionId
    },

    getState() {
      return snapshot()
    },

    get hasBlockingUploads() {
      return hasBlockingInlineImageUploads(records)
    },

    get hasActiveImageEdits() {
      return activeEditIds.size > 0
    },

    get hasBlockingOperations() {
      return hasBlockingInlineImageUploads(records) || activeEditIds.size > 0
    },

    get blockingReason(): InlineImageBlockingReason {
      if (hasBlockingInlineImageUploads(records)) return 'upload'
      if (activeEditIds.size > 0) return 'image-edit'
      return null
    },

    beginImageEdit(editId) {
      if (disposed || activeEditIds.has(editId)) return
      activeEditIds.add(editId)
      notify()
    },

    endImageEdit(editId) {
      if (disposed || !activeEditIds.delete(editId)) return
      notify()
    },

    upload(uploadId, file, onProgress) {
      if (disposed) return Promise.reject(new Error('Inline image coordinator is disposed'))
      if (resetting) return Promise.reject(new Error('Inline image coordinator is resetting'))

      const current = getRecord(uploadId)
      if (current?.status === 'success' && current.upload) {
        return Promise.resolve(current.upload)
      }

      const existingAttempt = attempts.get(uploadId)
      if (existingAttempt && !existingAttempt.settled && current?.status !== 'failed') {
        existingAttempt.callbacks.push(onProgress)
        return existingAttempt.deferred.promise
      }

      const deferred = createDeferredUpload()
      const completion = createAttemptCompletion()
      const attempt: UploadAttempt = {
        file,
        sessionId,
        callbacks: [onProgress],
        deferred,
        completion: completion.promise,
        resolveCompletion: completion.resolve,
        settled: false,
        cancelled: false,
        cleanupOnCompletion: false,
      }
      attempts.set(uploadId, attempt)
      dispatch({ type: 'queued', uploadId, file })
      pendingUploadIds.push(uploadId)
      pump()
      return deferred.promise
    },

    async remove(uploadId, imageId) {
      const current = getRecord(uploadId)
      if (!current) return

      const stagedImageId = imageId ?? current.imageId
      if (stagedImageId && current.status === 'success') {
        await deleteTransport(stagedImageId, sessionId)
      }

      const attempt = attempts.get(uploadId)
      if (current.status === 'uploading' && attempt) {
        attempt.cancelled = true
        attempt.cleanupOnCompletion = true
      } else if (attempt) {
        cancelPendingAttempt(uploadId, attempt)
      }
      dispatch({ type: 'removed', uploadId })
    },

    async reset() {
      if (disposed) return
      if (resetPromise) return resetPromise

      resetting = true
      const sessionForDeletes = sessionId
      const attemptsAtReset = [...attempts.entries()]
      const activeAttemptCompletions: Promise<void>[] = []
      for (const [uploadId, attempt] of attemptsAtReset) {
        if (pendingUploadIds.includes(uploadId)) {
          cancelPendingAttempt(uploadId, attempt)
        } else if (!attempt.settled) {
          // Let an in-flight request finish before taking the success snapshot.
          // This fences late drafts into the same reset cleanup pass.
          activeAttemptCompletions.push(attempt.completion)
        }
      }

      resetPromise = (async () => {
        await Promise.all(activeAttemptCompletions)
        const stagedIds = records
          .filter((record) => record.status === 'success' && record.imageId)
          .map((record) => record.imageId as string)
        await deleteStaged(stagedIds, sessionForDeletes)
        // A successful deletion must finish before local state is discarded.
        // clearState also rotates the session for the next form instance.
        clearState()
        clearActiveImageEdits()
      })()
      try {
        await resetPromise
      } finally {
        resetPromise = null
        resetting = false
      }
    },

    clear() {
      if (disposed || resetting) return
      clearState()
    },

    dispose() {
      if (disposed) return
      disposed = true
      activeEditIds.clear()
      const sessionForDeletes = sessionId
      const stagedIds = records
        .filter((record) => record.status === 'success' && record.imageId)
        .map((record) => record.imageId as string)

      for (const [uploadId, attempt] of attempts) {
        if (attempt.settled) {
          attempts.delete(uploadId)
          continue
        }
        const record = getRecord(uploadId)
        attempt.cancelled = true
        if (record?.status === 'queued') {
          attempt.cleanupOnCompletion = false
          settleAttempt(uploadId, attempt, { error: new Error('Image upload was disposed') })
        } else {
          // An in-flight request may still create a draft after unmount. Keep
          // its completion cleanup enabled, but do not make unmount wait for it.
          attempt.cleanupOnCompletion = true
        }
      }
      pendingUploadIds = []
      // Unmount cleanup is deliberately fire-and-forget; all failures are
      // absorbed by allSettled so React cleanup never creates an unhandled rejection.
      void deleteStaged(stagedIds, sessionForDeletes).catch(() => undefined)
    },
  }

  return runtime
}

/** Creates one coordinator per mounted form, including its unmount safety net. */
export function useInlineDescriptionImages(): InlineImageCoordinator {
  const [, setRevision] = useState(0)
  const coordinatorRef = useRef<InlineImageCoordinatorRuntime | null>(null)

  if (!coordinatorRef.current) {
    coordinatorRef.current = createInlineImageCoordinator({
      onStateChange: () => setRevision((revision) => revision + 1),
    })
  }

  const coordinator = coordinatorRef.current
  useEffect(() => {
    return () => {
      // The safety net only deletes successful staged drafts and never blocks unmount.
      void coordinator.dispose()
    }
  }, [coordinator])

  return coordinator
}
