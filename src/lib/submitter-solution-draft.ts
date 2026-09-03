export type SubmitterSolutionMode = 'request' | 'solution' | 'resubmit'

export interface SubmitterSolutionFile {
  id: string
  fileName: string
  fileType: string
  description?: string
}

export interface SubmitterSolutionDraftBaselineInput {
  mode: SubmitterSolutionMode
  requestTitle?: string
  solution?: {
    title?: string
    description?: string
    cost?: number
    currency?: string
    timeline?: string
  }
  existingFiles?: readonly SubmitterSolutionFile[]
}

export interface SubmitterSolutionDraftBaseline {
  solutionTitle: string
  solutionDescription: string
  cost: string
  currency: string
  timeline: string
  existingFiles: SubmitterSolutionFile[]
}

export interface RestoredSubmitterSolutionDraft extends SubmitterSolutionDraftBaseline {
  deletedFileIds: string[]
  useCustomHierarchy: boolean
  customApprovers: string[]
  fileUploadError: string | null
  submitError: string | null
  discardOpen: boolean
}

export interface SubmitterExistingFileState {
  existingFiles: SubmitterSolutionFile[]
  deletedFileIds: string[]
}

export interface SubmitterSolutionDiscardOperations {
  cleanupStagedRequestAttachments: () => Promise<void>
  cleanupSolutionAttachments: () => Promise<void>
  cleanupInlineImages: () => Promise<void>
  restore: () => void
  close: () => void
}

/**
 * Canonical baseline for the local solution/resubmit draft. The fallback
 * currency is applied here so initialization, reopen, and cleanup restoration
 * cannot drift apart.
 */
export function createSubmitterSolutionDraftBaseline({
  mode,
  requestTitle,
  solution,
  existingFiles,
}: SubmitterSolutionDraftBaselineInput): SubmitterSolutionDraftBaseline {
  return {
    solutionTitle: mode === 'solution' ? requestTitle || '' : solution?.title || '',
    solutionDescription: solution?.description || '',
    cost: solution?.cost?.toString() || '',
    currency: solution?.currency || 'THB',
    timeline: solution?.timeline || '',
    existingFiles: [...(existingFiles || [])],
  }
}

/** Apply the existing-file removal transition used by resubmit. */
export function removeSubmitterExistingFile(
  state: SubmitterExistingFileState,
  fileId: string,
): SubmitterExistingFileState {
  if (!state.existingFiles.some((file) => file.id === fileId)) return state
  return {
    existingFiles: state.existingFiles.filter((file) => file.id !== fileId),
    deletedFileIds: state.deletedFileIds.includes(fileId)
      ? [...state.deletedFileIds]
      : [...state.deletedFileIds, fileId],
  }
}

/**
 * Run solution/resubmit discard cleanup in ownership order. Restoration and
 * close are deliberately after every await, so a rejection leaves the draft
 * available for retry.
 */
export async function discardSubmitterSolutionDraft({
  cleanupStagedRequestAttachments,
  cleanupSolutionAttachments,
  cleanupInlineImages,
  restore,
  close,
}: SubmitterSolutionDiscardOperations): Promise<void> {
  await cleanupStagedRequestAttachments()
  await cleanupSolutionAttachments()
  await cleanupInlineImages()
  restore()
  close()
}

/** Restore every local solution/resubmit draft field after successful cleanup. */
export function restoreSubmitterSolutionDraft(
  baseline: SubmitterSolutionDraftBaseline,
): RestoredSubmitterSolutionDraft {
  return {
    ...baseline,
    existingFiles: [...baseline.existingFiles],
    deletedFileIds: [],
    useCustomHierarchy: false,
    customApprovers: [],
    fileUploadError: null,
    submitError: null,
    discardOpen: false,
  }
}
