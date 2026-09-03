import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { submitSolutionSchema, resubmitSolutionSchema } from '../../src/lib/schemas/solution-schemas'
import {
  createSolutionDraftReadyPath,
  isSolutionDraftReadyPath,
} from '../../src/lib/attachments/storage'

// Security-sensitive server-action contract tests. These follow the established
// `private-storage-wiring.test.ts` pattern: read the action module source and
// assert the invariants that keep the live request upload action authorized and
// the legacy trusted-path/draft actions removed. The Task 4 UI swap retired the
// draft upload/cleanup actions (their sole caller, use-solution-attachments,
// was removed), so only their absence is pinned below; the live behavior pins
// (schemas, staged adoption, resubmit transfer) follow.
const source = readFileSync('src/server-actions/files.ts', 'utf8')

describe('solution-upload-actions contract (Task 4 swap)', () => {
  it('has removed the legacy draft upload/cleanup actions with their last caller', () => {
    // The staged XHR protocol (scope: 'solution' on /api/attachments/stage)
    // replaced the submit-time draft upload; no production module may re-add
    // the server actions or their serialized result types.
    assert.doesNotMatch(source, /uploadSolutionDraftAttachmentAction/)
    assert.doesNotMatch(source, /cleanupSolutionDraftAttachments/)
    assert.doesNotMatch(source, /DraftUploadResult/)
    assert.doesNotMatch(source, /CleanupSolutionDraftAttachmentsResult/)
  })

  it('has removed every legacy trusted-path upload action', () => {
    assert.doesNotMatch(source, /export async function prepareFileUpload/)
    assert.doesNotMatch(source, /export async function confirmSolutionFileUpload/)
    assert.doesNotMatch(source, /export async function uploadSolutionFileAction/)
  })

  it('keeps the live request upload and delete actions intact', () => {
    assert.match(source, /export async function uploadFileAction/)
    assert.match(source, /export async function deleteFileAttachment/)
    assert.match(source, /export async function uploadFileAction[\s\S]*validateAttachmentMetadata/)
    assert.match(source, /role check|canEngineerUpload/)
  })
})

describe('submitSolutionSchema validates attachment IDs (Task 3 brief)', () => {
  const validInput = {
    requestId: randomUUID(),
    title: 'Solution title',
    description: 'Solution description',
    inlineImageSessionId: randomUUID(),
  }

  it('requires a UUID inline image upload session', () => {
    assert.throws(() => submitSolutionSchema.parse({
      ...validInput,
      inlineImageSessionId: undefined,
    }))
    assert.throws(() => submitSolutionSchema.parse({
      ...validInput,
      inlineImageSessionId: 'not-a-uuid',
    }))
  })

  it('rejects a non-UUID attachment id', () => {
    assert.throws(() =>
      submitSolutionSchema.parse({ ...validInput, fileIds: ['not-a-uuid'] })
    )
  })

  it('rejects more than 10 attachment ids', () => {
    assert.throws(() =>
      submitSolutionSchema.parse({
        ...validInput,
        fileIds: Array.from({ length: 11 }, () => randomUUID()),
      })
    )
  })

  it('rejects duplicate attachment ids', () => {
    const id = randomUUID()
    assert.throws(() => submitSolutionSchema.parse({ ...validInput, fileIds: [id, id] }))
  })

  it('accepts up to 10 unique UUIDs and defaults to an empty array', () => {
    const withIds = submitSolutionSchema.parse({
      ...validInput,
      fileIds: Array.from({ length: 10 }, () => randomUUID()),
    })
    assert.equal(withIds.fileIds.length, 10)

    const defaulted = submitSolutionSchema.parse(validInput)
    assert.deepEqual(defaulted.fileIds, [])
  })
})

describe('submitSolution adopts only owner-scoped ready solution drafts (Task 2 brief)', () => {
  const solutionsSource = readFileSync('src/server-actions/solutions.ts', 'utf8')
  const submitBody = solutionsSource.slice(
    solutionsSource.indexOf('export async function submitSolution'),
    solutionsSource.indexOf('export async function createCustomApprovalChain')
  )

  it('verifies every id as an owner-scoped ready draft inside the transaction', () => {
    // The shared verifier intersects ALL of: these ids, the target request,
    // still unlinked (solutionId null), owned by the submitting user, the
    // solution-drafts/ready/ prefix, and an existing physical file.
    assert.match(submitBody, /assertAdoptableSolutionDrafts\(\s*tx,\s*validated\.fileIds,\s*validated\.requestId,\s*user\.id/)
  })

  it('compares the found count to the unique id count and throws before linking', () => {
    assert.match(solutionsSource, /drafts\.length !== ids\.length/)
    assert.match(solutionsSource, /One or more attachments are invalid or no longer available/)
  })

  it('adopts with a ready-path conditional updateMany and re-checks the count', () => {
    assert.match(submitBody, /file_attachments\.updateMany/)
    assert.match(submitBody, /readySolutionDraftWhere\(validated\.fileIds,\s*validated\.requestId,\s*user\.id\)/)
    assert.match(submitBody, /\.count !== validated\.fileIds\.length/)
  })

  it('runs verification and adoption inside the transaction so mismatches roll back', () => {
    const txIdx = submitBody.indexOf('prisma.$transaction')
    const verifyIdx = submitBody.indexOf('assertAdoptableSolutionDrafts')
    const adoptIdx = submitBody.indexOf('file_attachments.updateMany')
    assert.ok(txIdx >= 0, 'submission must run in a transaction')
    assert.ok(verifyIdx > txIdx, 'ready-draft verification must run inside the transaction')
    assert.ok(adoptIdx > verifyIdx, 'adoption must happen only after verification passes')
  })

  it('still notifies only after the transaction commits', () => {
    const txIdx = submitBody.indexOf('prisma.$transaction')
    const notifyIdx = submitBody.indexOf("await import('./notifications')")
    assert.ok(txIdx >= 0)
    assert.ok(notifyIdx > txIdx, 'createNotification must run after prisma.$transaction')
  })

  it('never adopts request-scope rows on the solution submit path', () => {
    // The solution flows must pin the solution ready prefix; the request-scope
    // prefix (request-drafts/ready/) must not appear anywhere in solutions.ts.
    assert.doesNotMatch(solutionsSource, /request-drafts\/ready\//)
    assert.match(solutionsSource, /solution-drafts\/ready\//)
  })
})

// The adoption predicate is pinned behaviorally against the shared storage
// module: the exact five-segment `solution-drafts/ready/` shape is the ONLY
// path shape that satisfies it, so request-scope rows, mid-flight (reserved/
// uploading) solution drafts, and legacy `<requestId>/` uploads all fail the
// tightened submit/resubmit predicates instead of being adopted.
describe('solution staged-adoption predicates (Task 2 brief)', () => {
  const solutionsSource = readFileSync('src/server-actions/solutions.ts', 'utf8')
  // Shared predicates live at module level above submitSolution.
  const adoptionHead = solutionsSource.slice(0, solutionsSource.indexOf('export async function submitSolution'))

  it('adopts only solution-drafts/ready/ paths via the server-controlled prefix', () => {
    assert.match(adoptionHead, /SOLUTION_DRAFT_READY_PREFIX = 'solution-drafts\/ready\/'/)
    assert.match(adoptionHead, /filePath:\s*\{\s*startsWith:\s*SOLUTION_DRAFT_READY_PREFIX\s*\}/)
  })

  it('scopes the where predicate to target request, unlinked rows, and current owner', () => {
    assert.match(
      adoptionHead,
      /function readySolutionDraftWhere\(ids: string\[\], requestId: string, uploadedById: string\)/,
    )
    const whereBody = adoptionHead.slice(
      adoptionHead.indexOf('function readySolutionDraftWhere'),
      adoptionHead.indexOf('}', adoptionHead.indexOf('filePath:')),
    )
    assert.match(whereBody, /id:\s*\{\s*in:\s*ids\s*\}/)
    assert.match(whereBody, /requestId,/)
    assert.match(whereBody, /solutionId:\s*null/)
    assert.match(whereBody, /uploadedById,/)
  })

  it('requires the exact five-segment ready path and an existing physical file', () => {
    assert.match(adoptionHead, /isSolutionDraftReadyPath\(draft\.filePath\)/)
    assert.match(adoptionHead, /attachmentFileExists\(draft\.filePath\)/)
    // Wrong-owner/wrong-request rows never reach the path checks: the count
    // mismatch in the verifier throws first (fail closed).
    assert.match(adoptionHead, /drafts\.length !== ids\.length/)
  })

  it('accepts only exact solution ready paths and rejects every cross-scope shape', () => {
    const attachmentId = randomUUID()
    const uploadToken = randomUUID()
    // The exact shape the stage route finalizes to is adoptable.
    assert.equal(
      isSolutionDraftReadyPath(createSolutionDraftReadyPath(attachmentId, uploadToken, 'design.pdf')),
      true,
    )
    // A request-scope ready row (what a request-flow client stages) is rejected.
    assert.equal(
      isSolutionDraftReadyPath(`request-drafts/ready/${attachmentId}/${uploadToken}/design.pdf`),
      false,
    )
    // Mid-flight solution drafts are rejected: only finalized rows adopt.
    assert.equal(
      isSolutionDraftReadyPath(`solution-drafts/reserved/${attachmentId}/${uploadToken}/design.pdf`),
      false,
    )
    assert.equal(
      isSolutionDraftReadyPath(`solution-drafts/uploading/${attachmentId}/${uploadToken}/design.pdf`),
      false,
    )
    // Legacy `<requestId>/<uuid>-<name>` upload paths are rejected.
    assert.equal(isSolutionDraftReadyPath(`${attachmentId}/design.pdf`), false)
    // Solution cancelled markers are rejected.
    assert.equal(
      isSolutionDraftReadyPath(`solution-drafts/cancelled/ready/${attachmentId}/${uploadToken}/design.pdf`),
      false,
    )
  })
})

describe('resubmitSolutionSchema validates resubmission attachment IDs (Task 4 brief)', () => {
  const validInput = {
    requestId: randomUUID(),
    title: 'Updated solution title',
    description: 'Updated solution description',
    inlineImageSessionId: randomUUID(),
    cost: 1500,
    currency: 'THB' as const,
    timeline: '3 weeks',
    useCustomHierarchy: false,
  }

  it('requires a UUID inline image upload session', () => {
    assert.throws(() => resubmitSolutionSchema.parse({
      ...validInput,
      inlineImageSessionId: undefined,
    }))
    assert.throws(() => resubmitSolutionSchema.parse({
      ...validInput,
      inlineImageSessionId: 'not-a-uuid',
    }))
  })

  it('rejects a non-UUID newFileId', () => {
    assert.throws(() =>
      resubmitSolutionSchema.parse({ ...validInput, newFileIds: ['not-a-uuid'] })
    )
  })

  it('rejects more than 10 newFileIds', () => {
    assert.throws(() =>
      resubmitSolutionSchema.parse({
        ...validInput,
        newFileIds: Array.from({ length: 11 }, () => randomUUID()),
      })
    )
  })

  it('rejects duplicate newFileIds', () => {
    const id = randomUUID()
    assert.throws(() => resubmitSolutionSchema.parse({ ...validInput, newFileIds: [id, id] }))
  })

  it('rejects a non-UUID deletedFileId', () => {
    assert.throws(() =>
      resubmitSolutionSchema.parse({ ...validInput, deletedFileIds: ['not-a-uuid'] })
    )
  })

  it('rejects more than 10 deletedFileIds', () => {
    assert.throws(() =>
      resubmitSolutionSchema.parse({
        ...validInput,
        deletedFileIds: Array.from({ length: 11 }, () => randomUUID()),
      })
    )
  })

  it('rejects duplicate deletedFileIds', () => {
    const id = randomUUID()
    assert.throws(() => resubmitSolutionSchema.parse({ ...validInput, deletedFileIds: [id, id] }))
  })

  it('rejects a non-UUID customApprover', () => {
    assert.throws(() =>
      resubmitSolutionSchema.parse({
        ...validInput,
        useCustomHierarchy: true,
        customApprovers: ['not-a-uuid'],
      })
    )
  })

  it('rejects a non-positive cost', () => {
    assert.throws(() => resubmitSolutionSchema.parse({ ...validInput, cost: -5 }))
    assert.throws(() => resubmitSolutionSchema.parse({ ...validInput, cost: 0 }))
  })

  it('accepts up to 10 unique UUIDs and defaults arrays to empty', () => {
    const withIds = resubmitSolutionSchema.parse({
      ...validInput,
      newFileIds: Array.from({ length: 10 }, () => randomUUID()),
      deletedFileIds: Array.from({ length: 10 }, () => randomUUID()),
      customApprovers: Array.from({ length: 5 }, () => randomUUID()),
    })
    assert.equal(withIds.newFileIds.length, 10)
    assert.equal(withIds.deletedFileIds.length, 10)
    assert.equal(withIds.customApprovers.length, 5)

    const defaulted = resubmitSolutionSchema.parse(validInput)
    assert.deepEqual(defaulted.newFileIds, [])
    assert.deepEqual(defaulted.deletedFileIds, [])
    assert.deepEqual(defaulted.customApprovers, [])
  })
})

describe('resubmitSolution transfers staged IDs and deletes files after commit (Task 4 brief)', () => {
  const solutionsSource = readFileSync('src/server-actions/solutions.ts', 'utf8')
  // resubmitSolution is the final export in the file, so slice from its start to
  // the end of the module to capture its full body.
  const resubmitStart = solutionsSource.indexOf('export async function resubmitSolution')
  const resubmitBody = solutionsSource.slice(resubmitStart)

  it('no longer accepts raw File[] inputs or does disk writes / arrayBuffer reads', () => {
    // The signature must carry inferred staged-id input, never File[].
    assert.match(resubmitBody, /resubmitSolution\(input: ResubmitSolutionActionInput\)/)
    assert.doesNotMatch(resubmitBody, /files:\s*File\[\]/)
    assert.doesNotMatch(resubmitBody, /\.arrayBuffer\(\)/)
    assert.doesNotMatch(resubmitBody, /writeAttachmentFile/)
    // No private write happens before the transaction commits.
    assert.doesNotMatch(resubmitBody, /createStoredAttachmentPath/)
  })

  it('validates input through resubmitSolutionSchema', () => {
    assert.match(resubmitBody, /resubmitSolutionSchema\.parse/)
  })

  it('rejects overlap between new and deleted file id sets inside the transaction', () => {
    assert.match(resubmitBody, /overlap/i)
  })

  it('verifies new ids as owner-scoped ready solution drafts inside the transaction', () => {
    assert.match(resubmitBody, /assertAdoptableSolutionDrafts\(\s*tx,\s*validated\.newFileIds,\s*validated\.requestId,\s*user\.id/)
  })

  it('links staged rows through the ready-path predicate with a count re-check', () => {
    assert.match(resubmitBody, /file_attachments\.updateMany/)
    assert.match(resubmitBody, /readySolutionDraftWhere\(validated\.newFileIds,\s*validated\.requestId,\s*user\.id\)/)
    assert.match(resubmitBody, /\.count !== validated\.newFileIds\.length/)
  })

  it('queries deletable attachments scoped to the current solution and exact-counts them', () => {
    assert.match(resubmitBody, /deletableAttachments\.length !== validated\.deletedFileIds\.length/)
  })

  it('links staged rows with an updateMany count re-check', () => {
    assert.match(resubmitBody, /file_attachments\.updateMany/)
    assert.match(resubmitBody, /\.count !== validated\.newFileIds\.length/)
  })

  it('deletes the selected existing attachment rows inside the transaction', () => {
    assert.match(resubmitBody, /file_attachments\.deleteMany/)
  })

  it('runs new-file verification inside the transaction so mismatches roll back', () => {
    const txIdx = resubmitBody.indexOf('runSolutionTransactionWithNotifications')
    const verifyIdx = resubmitBody.indexOf('assertAdoptableSolutionDrafts')
    const adoptIdx = resubmitBody.indexOf('file_attachments.updateMany')
    assert.ok(txIdx >= 0, 'resubmission must run in the post-commit-managed transaction')
    assert.ok(verifyIdx > txIdx, 'ready-draft verification must run inside the transaction')
    assert.ok(adoptIdx > verifyIdx, 'adoption must happen only after verification passes')
  })

  it('still notifies approvers only after the transaction commits', () => {
    const txIdx = resubmitBody.indexOf('runSolutionTransactionWithNotifications')
    const notifyIdx = resubmitBody.indexOf("await import('./notifications')")
    assert.ok(txIdx >= 0)
    assert.ok(notifyIdx > txIdx, 'createNotification must run after the transaction wrapper')
  })

  it('deletes physical files only after the transaction commits via Promise.allSettled', () => {
    assert.match(resubmitBody, /Promise\.allSettled/)
    assert.match(resubmitBody, /deleteAttachmentFile/)
    // A single rejected physical delete must not abort the others or the commit.
    assert.match(resubmitBody, /status === 'rejected'/)
  })

  it('returns the deleted attachment ids with the updated result', () => {
    assert.match(resubmitBody, /deletedAttachmentIds|deletedAttachments/)
  })
})

// Task 4: both solution surfaces stage eagerly through the solution-scope
// staged-attachments hook, and the modal router passes attachment IDs (never
// raw File[]) across the server boundary. These source-wiring assertions pin
// the integration: eager staging with real XHR progress, submit passing only
// readyAttachmentIds, and no submit-time upload loop on either surface.
describe('Task 4 source-wiring: staged hook integration and ID-only server boundary', () => {
  const solutionForm = readFileSync('src/components/solutions/solution-form.tsx', 'utf8')
  const submitterModal = readFileSync('src/components/requests/submitter-modal.tsx', 'utf8')
  const router = readFileSync('src/components/requests/request-modal-router.tsx', 'utf8')

  it('SolutionForm consumes useStagedSolutionAttachments bound to the target request', () => {
    assert.match(solutionForm, /useStagedSolutionAttachments\(\{ requestId \}\)/)
    assert.doesNotMatch(solutionForm, /useSolutionAttachments/)
  })

  it('SubmitterModal consumes useStagedSolutionAttachments for solution/resubmit modes only', () => {
    assert.match(submitterModal, /useStagedSolutionAttachments\(\{ requestId \}\)/)
    assert.doesNotMatch(submitterModal, /useSolutionAttachments/)
  })

  it('neither surface keeps a submit-time upload (ensureUploaded) path', () => {
    assert.doesNotMatch(solutionForm, /ensureUploaded/)
    assert.doesNotMatch(submitterModal, /ensureUploaded/)
  })

  it('submit passes readyAttachmentIds only, exactly once per surface', () => {
    assert.match(solutionForm, /fileIds: readyAttachmentIds,/)
    assert.equal((solutionForm.match(/fileIds: readyAttachmentIds/g) ?? []).length, 1)
    const solutionBranch = submitterModal.split('if (mode === "solution" && onSubmitSolution)')[1]
      ?.split('} else if (mode === "resubmit"')[0] ?? ''
    const resubmitBranch = submitterModal.split('} else if (mode === "resubmit" && onResubmit)')[1]
      ?.split('} catch')[0] ?? ''
    assert.match(solutionBranch, /fileIds: solutionReadyAttachmentIds,/)
    assert.match(resubmitBranch, /fileIds: solutionReadyAttachmentIds,/)
    assert.match(resubmitBranch, /deletedFileIds: deletedFileIdsSnapshot,/)
  })

  it('submit blocks while reserve/upload/cleanup is active or an item is not ready', () => {
    // Mirrors the request-mode blocking predicate: any pending/uploading/errored
    // item or failed cleanup leaves readyAttachmentIds short of items.
    assert.match(solutionForm, /const attachmentsBlocking = stagedBlocking \|\| items\.length !== readyAttachmentIds\.length/)
    assert.match(solutionForm, /if \(attachmentsBlocking\) return/)
    assert.match(
      solutionForm,
      /disabled=\{\s*isSubmitting \|\|\s*inlineImages\.hasBlockingOperations \|\|\s*attachmentsBlocking\s*\}/,
    )
    assert.match(
      submitterModal,
      /const solutionAttachmentsBlocking =\s*stagedSolutionBlocking \|\|\s*attachmentItems\.length !== solutionReadyAttachmentIds\.length;/,
    )
    const solutionSubmit = (submitterModal.split('const handleSubmit = async')[1] ?? '')
      .split('if (isSolutionMode) {')[1]
      ?.split('const deletedFileIdsSnapshot')[0] ?? ''
    assert.match(solutionSubmit, /if \(solutionAttachmentsBlocking\) \{\s*return;/)
    const disabled = submitterModal.split('const isSubmitDisabled = () =>')[1] ?? ''
    assert.match(disabled, /solutionAttachmentsBlocking/)
  })

  it('success clears staged drafts without DELETE before close; failure retains them', () => {
    // SolutionForm: clear() precedes navigation; the failure branch returns
    // before any clear.
    const formSuccess = solutionForm.split("toast.success('Solution submitted successfully')")[1]?.split('router.push')[0] ?? ''
    assert.match(formSuccess, /inlineImages\.clear\(\)\n      clear\(\)/)
    const formFail = solutionForm.split('if (!submitResult.success) {')[1]?.split('toast.success')[0] ?? ''
    assert.doesNotMatch(formFail, /clear\(\)/)
    const modalSolution = submitterModal.split('if (mode === "solution" && onSubmitSolution)')[1]?.split('} catch')[0] ?? ''
    const successIdx = modalSolution.indexOf('clearSolutionAttachments()')
    const closeIdx = modalSolution.indexOf('onOpenChange(false)')
    assert.ok(successIdx !== -1, 'solution success clears staged drafts locally')
    assert.ok(closeIdx !== -1, 'solution success closes the modal')
    assert.ok(
      successIdx < closeIdx,
      'clear() must run before close so unmount cleanup cannot DELETE adopted drafts',
    )
  })

  it('cancel/discard resets the staged hook (scoped DELETE) and keeps the surface open on failure', () => {
    // SolutionForm: reset() awaited before navigation; failure surfaces a toast
    // and does not navigate.
    const formCancel = solutionForm.split('const handleCancel = async')[1]?.split('const handleCancelClick')[0] ?? ''
    assert.match(formCancel, /await reset\(\)/)
    assert.match(formCancel, /router\.back\(\)/)
    assert.match(formCancel, /Failed to clean up draft files/)
    // SubmitterModal: the discard helper receives the staged solution reset.
    assert.match(
      submitterModal,
      /cleanupSolutionAttachments: resetSolutionAttachments,/,
    )
  })

  it('router contains no dynamic raw-file upload loop or import', () => {
    assert.doesNotMatch(router, /formData\.append\('file'/)
    assert.doesNotMatch(router, /uploadFileAction/)
    assert.doesNotMatch(router, /files: data\.files/)
  })

  it('router passes IDs (fileIds / newFileIds) directly', () => {
    assert.match(router, /newFileIds: data\.fileIds/)
  })

  it('SolutionForm cancel awaits hook reset() before navigating and surfaces cleanup failure', () => {
    // The leave path must use an async handler, not direct router.back()
    assert.match(solutionForm, /const handleCancel = async/)
    // reset() must be awaited before router.back()
    assert.match(solutionForm, /await reset\(\)/)
    // Cleanup failure is surfaced (not silently swallowed)
    assert.match(solutionForm, /Failed to clean up draft files/)
    // Cancel asks before discarding a dirty draft, then leaves through handleCancel
    assert.match(solutionForm, /onClick=\{handleCancelClick\}/)
  })
})

// Task 4 follow-up: staging is eager, so per-item retry is a staged-hook
// retryItem(id) (re-PUT + re-XHR under the same stable attachmentId, or a
// cleanup DELETE retry for a removing item) — never a batch re-upload and
// never the metadata submit.
describe('Task 4 follow-up: per-item staged retry wiring', () => {
  const solutionForm = readFileSync('src/components/solutions/solution-form.tsx', 'utf8')
  const submitterModal = readFileSync('src/components/requests/submitter-modal.tsx', 'utf8')

  it('SolutionForm binds onRetryItem to a per-item staged retry handler', () => {
    assert.match(solutionForm, /const handleRetryItem = \(id: string\)/)
    assert.match(solutionForm, /onRetryItem=\{handleRetryItem\}/)
    const start = solutionForm.indexOf('const handleRetryItem')
    const next = solutionForm.indexOf('const handle', start + 1)
    const retrySlice = solutionForm.slice(start, next === -1 ? undefined : next)
    // Respects the commit/close fences and never invokes the metadata action.
    assert.match(retrySlice, /if \(isSubmitting\) return/)
    assert.match(retrySlice, /retryItem\(id\)/)
    assert.doesNotMatch(retrySlice, /submitSolution/)
  })

  it('SolutionForm remove handler stays fenced and calls the staged removeItem', () => {
    const removeSlice = solutionForm.split('const handleRemoveItem')[1]?.split('const handleRetryItem')[0] ?? ''
    assert.match(removeSlice, /if \(isSubmitting\) return/)
    assert.match(removeSlice, /commitInFlightRef\.current \|\| closeInFlightRef\.current/)
    assert.match(removeSlice, /removeItem\(id\)/)
    assert.match(solutionForm, /onRemoveItem=\{handleRemoveItem\}/)
  })

  it('SubmitterModal retry is per-item, gated on isBusy, and never submits metadata', () => {
    assert.match(submitterModal, /const handleRetryAttachment = \(id: string\)/)
    const start = submitterModal.indexOf('const handleRetryAttachment')
    const next = submitterModal.indexOf('const removeExistingFile', start + 1)
    const retrySlice = submitterModal.slice(start, next === -1 ? undefined : next)
    assert.match(retrySlice, /if \(isBusy\) return/)
    assert.match(retrySlice, /retryStagedSolutionItem\(id\)/)
    assert.doesNotMatch(retrySlice, /onSubmitSolution/)
    assert.doesNotMatch(retrySlice, /onResubmit/)
    assert.match(submitterModal, /onClick=\{\(\) => handleRetryAttachment\(item\.id\)\}/)
  })

  it('SubmitterModal remove handler stays fenced and calls the staged remove', () => {
    const removeSlice = submitterModal.split('const handleRemoveAttachment')[1]?.split('const handleRetryAttachment')[0] ?? ''
    assert.match(removeSlice, /isBusy \|\| solutionCommitInFlightRef\.current \|\| closeInFlightRef\.current/)
    assert.match(removeSlice, /removeStagedSolutionItem\(id\)/)
  })
})
