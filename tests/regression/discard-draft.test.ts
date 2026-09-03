import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  isDraftFieldDirty,
  requestDiscardDraft,
  shouldConfirmDiscardDraft,
} from '@/lib/discard-draft'
import {
  createSubmitterSolutionDraftBaseline,
  discardSubmitterSolutionDraft,
  removeSubmitterExistingFile,
  restoreSubmitterSolutionDraft,
  type RestoredSubmitterSolutionDraft,
} from '@/lib/submitter-solution-draft'

const read = (path: string) => readFileSync(path, 'utf8')

const CLEAN = {
  formIsDirty: false,
  hasFiles: false,
  hasInlineImageDrafts: false,
} as const

describe('shouldConfirmDiscardDraft', () => {
  it('does not confirm when the draft is untouched', () => {
    assert.equal(shouldConfirmDiscardDraft(CLEAN), false)
  })

  it('confirms when the form has unsaved field changes', () => {
    assert.equal(shouldConfirmDiscardDraft({ ...CLEAN, formIsDirty: true }), true)
  })

  it('confirms when files are staged', () => {
    assert.equal(shouldConfirmDiscardDraft({ ...CLEAN, hasFiles: true }), true)
  })

  it('confirms when inline image drafts are staged', () => {
    assert.equal(
      shouldConfirmDiscardDraft({ ...CLEAN, hasInlineImageDrafts: true }),
      true,
    )
  })
})

describe('isDraftFieldDirty', () => {
  it('treats empty markup as untouched', () => {
    assert.equal(isDraftFieldDirty('', ''), false)
    assert.equal(isDraftFieldDirty('<p></p>', ''), false)
    assert.equal(isDraftFieldDirty('<p></p>', '<p></p>'), false)
  })

  it('treats an inserted table as work to lose', () => {
    assert.equal(
      isDraftFieldDirty(
        '<table><tbody><tr><td></td></tr></tbody></table>',
        '',
      ),
      true,
    )
  })

  it('does not confirm when template HTML is unchanged', () => {
    const html = '<p>Template body</p>'
    assert.equal(isDraftFieldDirty(html, html), false)
  })
})

describe('requestDiscardDraft', () => {
  it('leaves immediately when the draft is untouched', () => {
    const calls: string[] = []
    requestDiscardDraft(CLEAN, () => calls.push('confirm'), () => calls.push('leave'))
    assert.deepEqual(calls, ['leave'])
  })

  it('asks for confirmation when the draft has work to lose', () => {
    const calls: string[] = []
    requestDiscardDraft(
      { ...CLEAN, formIsDirty: true },
      () => calls.push('confirm'),
      () => calls.push('leave'),
    )
    assert.deepEqual(calls, ['confirm'])
  })
})

describe('description table width', () => {
  it('lets description tables size to content instead of stretching full width', () => {
    const css = read('src/app/globals.css')
    const block = css.match(/\.rich-text table \{([^}]+)\}/)?.[1]
    assert.ok(block, 'expected a .rich-text table rule')
    assert.match(block, /width:\s*auto/)
    assert.match(block, /max-width:\s*100%/)
    assert.match(block, /table-layout:\s*fixed/)
    assert.doesNotMatch(block, /(?<!max-)width:\s*100%/)
  })

  it('gives inserted cells enough room for a caret without stretching full width', () => {
    const css = read('src/app/globals.css')
    const block = css.match(/\.rich-text th,\s*\.rich-text td \{([^}]+)\}/)?.[1]
    assert.ok(block, 'expected a .rich-text th, td rule')
    assert.match(block, /min-width:\s*8rem/)
    assert.match(block, /min-height:\s*2\.25rem/)
    const kit = read('src/components/rich-text/rich-table-extensions.ts')
    assert.match(kit, /Table\.configure\(\{ resizable: true, cellMinWidth: 120 \}\)/)
  })
})

describe('draft form cancel wiring', () => {
  it('request form confirms before discarding a dirty draft', () => {
    const source = read('src/components/requests/request-form.tsx')
    assert.match(source, /from ['"]@\/lib\/discard-draft['"]/)
    assert.match(source, /from ['"]@\/components\/ui\/discard-draft-dialog['"]/)
    assert.match(source, /requestDiscardDraft\(/)
    assert.match(source, /formIsDirty:\s*isDirty/)
    assert.match(source, /hasFiles:\s*selectedFiles\.length > 0/)
    assert.match(source, /hasInlineImageDrafts:\s*inlineImages\.getState\(\)\.length > 0/)
    assert.match(source, /<DiscardDraftDialog/)
    assert.match(source, /onClick=\{handleCancelClick\}/)
    const leave = source.split('const handleCancel = async')[1]?.split('const formatFileSize')[0] ?? ''
    assert.match(leave, /await inlineImages\.reset\(\)/)
    assert.match(leave, /router\.back\(\)/)
  })

  it('submitter modal treats a currency-only solution change as dirty', () => {
    const source = read('src/components/requests/submitter-modal.tsx')
    assert.match(source, /const initialSolutionCurrency = initialData\?\.solution\?\.currency \|\| "THB"/)
    assert.match(source, /currency !== initialSolutionCurrency/)
  })

  it('submitter modal confirms before discarding a dirty draft', () => {
    const source = read('src/components/requests/submitter-modal.tsx')
    assert.match(source, /from ['"]@\/lib\/discard-draft['"]/)
    assert.match(source, /from ['"]@\/components\/ui\/discard-draft-dialog['"]/)
    assert.match(source, /requestDiscardDraft\(/)
    assert.match(source, /isDraftFieldDirty\(/)
    assert.match(source, /hasFiles:\s*stagedRequestItems\.length > 0 \|\| attachmentItems\.length > 0/)
    assert.match(source, /hasInlineImageDrafts:\s*inlineImages\.getState\(\)\.length > 0/)
    assert.match(source, /<DiscardDraftDialog/)
    assert.match(source, /const handleCloseWithCleanup = async/)
    assert.match(source, /await inlineImages\.reset\(\)/)
  })

  it('submitter solution and resubmit commits synchronously fence close and stale discard state', () => {
    const source = read('src/components/requests/submitter-modal.tsx')
    assert.match(source, /const solutionCommitInFlightRef = useRef\(false\)/)
    assert.match(source, /solutionCommitInFlightRef\.current = true/)
    assert.match(source, /solutionCommitInFlightRef\.current = false/)
    assert.match(source, /requestCommitInFlightRef\.current \|\|\s*solutionCommitInFlightRef\.current/)
    assert.match(source, /setDiscardOpen\(false\)/)
  })

  it('dedicated solution form fences commit/cancel races and clears stale discard state', () => {
    const source = read('src/components/solutions/solution-form.tsx')
    assert.match(source, /const commitInFlightRef = useRef\(false\)/)
    assert.match(source, /const closeInFlightRef = useRef\(false\)/)
    assert.match(source, /if \(isSubmitting \|\| commitInFlightRef\.current \|\| closeInFlightRef\.current\) return/)
    assert.match(source, /setDiscardOpen\(false\)/)
  })

  it('resubmit existing-file removal is locked and submits a synchronous ID snapshot', () => {
    const source = read('src/components/requests/submitter-modal.tsx')
    const removeExisting = source.split('const removeExistingFile')[1]?.split('// Handle submission')[0] ?? ''
    assert.match(removeExisting, /isBusy/)
    assert.match(removeExisting, /solutionCommitInFlightRef\.current/)
    assert.match(removeExisting, /closeInFlightRef\.current/)
    assert.match(source, /disabled=\{requestCloseControlsLocked\}[\s\S]*?title="Remove file"/)
    assert.match(source, /const deletedFileIdsSnapshot = \[\.\.\.deletedFileIds\]/)
    assert.match(source, /deletedFileIds: deletedFileIdsSnapshot/)
  })

  it('resubmit discard lifecycle restores persistent state and prevents stale deletion on reopen', async () => {
    const source = read('src/components/requests/submitter-modal.tsx')
    assert.match(source, /discardSubmitterSolutionDraft\(/)
    assert.match(source, /removeSubmitterExistingFile\(/)
    const initialFiles = [{ id: 'file-1', fileName: 'brief.pdf', fileType: 'pdf' }]
    const baseline = createSubmitterSolutionDraftBaseline({
      mode: 'resubmit',
      solution: {
        title: 'Original solution',
        description: 'Original description',
        cost: 1250,
        timeline: '14 days',
      },
      existingFiles: initialFiles,
    })
    let state: RestoredSubmitterSolutionDraft = restoreSubmitterSolutionDraft(baseline)
    const events: string[] = []
    const harness = {
      open() {
        state = restoreSubmitterSolutionDraft(
          createSubmitterSolutionDraftBaseline({
            mode: 'resubmit',
            solution: {
              title: 'Original solution',
              description: 'Original description',
              cost: 1250,
              timeline: '14 days',
            },
            existingFiles: initialFiles,
          }),
        )
      },
      edit() {
        state = {
          ...state,
          solutionTitle: 'Edited solution',
          solutionDescription: 'Edited description',
          cost: '9000',
          currency: 'USD',
          timeline: '3 days',
          useCustomHierarchy: true,
          customApprovers: ['approver-1'],
          fileUploadError: 'upload failed',
          submitError: 'submit failed',
          discardOpen: true,
        }
      },
      removeExistingFile(fileId: string) {
        const next = removeSubmitterExistingFile(state, fileId)
        state = { ...state, ...next }
      },
      discard(cleanups: {
        cleanupStagedRequestAttachments: () => Promise<void>
        cleanupSolutionAttachments: () => Promise<void>
        cleanupInlineImages: () => Promise<void>
      }) {
        return discardSubmitterSolutionDraft({
          ...cleanups,
          restore: () => {
            events.push('restore')
            state = restoreSubmitterSolutionDraft(baseline)
          },
          close: () => events.push('close'),
        })
      },
    }

    harness.open()
    harness.edit()
    harness.removeExistingFile('file-1')
    assert.deepEqual(state.deletedFileIds, ['file-1'])
    assert.deepEqual(state.existingFiles, [])

    let releaseStaged!: () => void
    let releaseSolution!: () => void
    let releaseInline!: () => void
    const deferred = (name: string, release: (resolve: () => void) => void) =>
      new Promise<void>((resolve) => {
        events.push(name)
        release(resolve)
      })
    const discardPromise = harness.discard({
      cleanupStagedRequestAttachments: () => deferred('staged', (resolve) => { releaseStaged = resolve }),
      cleanupSolutionAttachments: () => deferred('solution', (resolve) => { releaseSolution = resolve }),
      cleanupInlineImages: () => deferred('inline', (resolve) => { releaseInline = resolve }),
    })
    await Promise.resolve()
    assert.deepEqual(events, ['staged'])
    assert.deepEqual(state.deletedFileIds, ['file-1'])
    releaseStaged()
    await Promise.resolve()
    assert.deepEqual(events, ['staged', 'solution'])
    releaseSolution()
    await Promise.resolve()
    assert.deepEqual(events, ['staged', 'solution', 'inline'])
    releaseInline()
    await discardPromise
    assert.deepEqual(events, ['staged', 'solution', 'inline', 'restore', 'close'])
    assert.equal(state.deletedFileIds.length, 0)
    assert.deepEqual(state.existingFiles, initialFiles)
    assert.equal(state.solutionTitle, 'Original solution')
    assert.equal(state.solutionDescription, 'Original description')
    assert.equal(state.cost, '1250')
    assert.equal(state.currency, 'THB')
    assert.equal(state.timeline, '14 days')
    assert.equal(state.useCustomHierarchy, false)
    assert.deepEqual(state.customApprovers, [])

    // Reopen the same persistent harness, then build the deletion payload used
    // by resubmit. The restored existing file remains visible and deletions are empty.
    harness.open()
    const deletionSnapshot = [...state.deletedFileIds]
    assert.deepEqual(deletionSnapshot, [])
    assert.deepEqual(state.existingFiles, initialFiles)
    assert.equal(state.solutionTitle, 'Original solution')
    assert.equal(state.currency, 'THB')
  })

  it('rejected discard cleanup keeps edited and deleted state open for retry', async () => {
    const initialFiles = [{ id: 'file-1', fileName: 'brief.pdf', fileType: 'pdf' }]
    const baseline = createSubmitterSolutionDraftBaseline({ mode: 'resubmit', existingFiles: initialFiles })
    let state: RestoredSubmitterSolutionDraft = restoreSubmitterSolutionDraft(baseline)
    state = {
      ...state,
      solutionDescription: 'Edited description',
      currency: 'USD',
      useCustomHierarchy: true,
      customApprovers: ['approver-1'],
      ...removeSubmitterExistingFile(state, 'file-1'),
    }
    const before = { ...state, existingFiles: [...state.existingFiles], deletedFileIds: [...state.deletedFileIds] }
    const events: string[] = []
    await assert.rejects(
      discardSubmitterSolutionDraft({
        cleanupStagedRequestAttachments: async () => { events.push('staged') },
        cleanupSolutionAttachments: async () => { events.push('solution'); throw new Error('cleanup failed') },
        cleanupInlineImages: async () => { events.push('inline') },
        restore: () => { events.push('restore'); state = restoreSubmitterSolutionDraft(baseline) },
        close: () => events.push('close'),
      }),
    )
    assert.deepEqual(events, ['staged', 'solution'])
    assert.deepEqual(state, before)
  })

  it('a stale SolutionFileUpload add callback cannot bypass operation locks', () => {
    const source = read('src/components/solutions/solution-form.tsx')
    assert.match(source, /const handleAddFiles = useCallback\(/)
    assert.match(source, /onAddFiles=\{handleAddFiles\}/)
    assert.doesNotMatch(source, /onAddFiles=\{addFiles\}/)

    const state = { isSubmitting: false, commitInFlight: false, closeInFlight: false }
    const added: File[][] = []
    const capturedBeforeLock = (files: File[]) => {
      if (state.isSubmitting || state.commitInFlight || state.closeInFlight) return
      added.push(files)
    }
    const selected = [new File(['pdf'], 'a.pdf', { type: 'application/pdf' })]
    state.commitInFlight = true
    capturedBeforeLock(selected)
    state.commitInFlight = false
    state.closeInFlight = true
    capturedBeforeLock(selected)
    state.closeInFlight = false
    state.isSubmitting = true
    capturedBeforeLock(selected)
    assert.equal(added.length, 0)
    state.isSubmitting = false
    capturedBeforeLock(selected)
    assert.equal(added.length, 1)
  })

  it('solution form confirms before discarding a dirty draft', () => {
    const source = read('src/components/solutions/solution-form.tsx')
    assert.match(source, /from ['"]@\/lib\/discard-draft['"]/)
    assert.match(source, /from ['"]@\/components\/ui\/discard-draft-dialog['"]/)
    assert.match(source, /requestDiscardDraft\(/)
    assert.match(source, /formIsDirty:\s*isDirty/)
    assert.match(source, /hasFiles:\s*items\.length > 0/)
    assert.match(source, /hasInlineImageDrafts:\s*inlineImages\.getState\(\)\.length > 0/)
    assert.match(source, /<DiscardDraftDialog/)
    assert.match(source, /onClick=\{handleCancelClick\}/)
    const leave = source.split('const handleCancel = async')[1]?.split('const handleSubmit')[0] ?? ''
    assert.match(leave, /await reset\(\)/)
    assert.match(leave, /await inlineImages\.reset\(\)/)
    assert.match(leave, /router\.back\(\)/)
  })
})
