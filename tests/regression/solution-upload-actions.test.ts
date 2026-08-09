import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { submitSolutionSchema, resubmitSolutionSchema } from '../../src/lib/schemas/solution-schemas'

// Security-sensitive server-action contract tests. These follow the established
// `private-storage-wiring.test.ts` pattern: read the action module source and
// assert the authorization/storage invariants that prevent unauthorized uploads
// and the accidental resurrection of the legacy trusted-path actions. The brief
// pins the exact regexes below; the additional assertions cover the security
// guarantees the brief describes in prose (active-role, non-deleted request,
// owner-only cleanup, DB-before-physical ordering, server-boundary serialization).
const source = readFileSync('src/server-actions/files.ts', 'utf8')

describe('solution-upload-actions contract (Task 2 brief)', () => {
  it('declares the authorized draft upload and cleanup actions', () => {
    assert.match(source, /export async function uploadSolutionDraftAttachmentAction/)
    assert.match(source, /export async function cleanupSolutionDraftAttachments/)
  })

  it('guards the draft upload behind the active engineering role', () => {
    assert.match(source, /role !== UserRole\.engineering/)
    // Active (not just assigned) engineering role.
    assert.match(source, /isActive/)
  })

  it('only uploads drafts for a non-deleted request in SentToEngineer', () => {
    assert.match(source, /RequestStatus\.SentToEngineer/)
    assert.match(source, /isDeleted/)
    assert.match(source, /deletedAt/)
  })

  it('stores drafts as requestId target / solutionId null / uploadedBy current user', () => {
    assert.match(source, /uploadedById: userId/)
    assert.match(source, /solutionId: null/)
  })

  it('has removed every legacy trusted-path upload action', () => {
    assert.doesNotMatch(source, /export async function prepareFileUpload/)
    assert.doesNotMatch(source, /export async function confirmSolutionFileUpload/)
    assert.doesNotMatch(source, /export async function uploadSolutionFileAction/)
  })
})

describe('draft upload result is a serializable discriminated union', () => {
  it('returns attachmentId + serialized fileAttachment on success and error on failure', () => {
    assert.match(source, /DraftUploadResult/)
    assert.match(source, /success: true; attachmentId: string/)
    assert.match(source, /fileAttachment: SerializedAttachment/)
    assert.match(source, /success: false; error: string/)
  })

  it('serializes Date values before crossing the server boundary', () => {
    // createdAt is a Prisma DateTime; it must be serialized to a string so the
    // Server Action result is plain JSON-safe (Date is not serializable across
    // Next.js server actions without explicit coercion).
    assert.match(source, /SerializedAttachment/)
    assert.match(source, /\.toISOString\(\)/)
  })

  it('writes through the private storage layer with DB-write compensation', () => {
    assert.match(source, /createStoredAttachmentPath/)
    assert.match(source, /writeAttachmentFile/)
    // If the DB record fails, the just-written file must be removed so it is
    // never orphaned outside the request lifecycle.
    assert.match(source, /deleteAttachmentFile/)
    assert.match(source, /throw dbError/)
  })
})

describe('cleanupSolutionDraftAttachments is owner-only and transactional', () => {
  it('validates a UUID array bounded by the shared per-form maximum', () => {
    assert.match(source, /MAX_ATTACHMENTS_PER_FORM/)
    // A strict UUID v4-ish pattern (8-4-4-4-12 hex).
    assert.match(source, /\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}/)
  })

  it('scopes the query to requestId / solutionId:null / uploadedById', () => {
    assert.match(source, /solutionId: null/)
    assert.match(source, /uploadedById: userId/)
    assert.match(source, /requestId,/)
  })

  it('rejects a count mismatch before deleting anything', () => {
    assert.match(source, /owned\.length !== attachmentIds\.length/)
  })

  it('deletes DB records in a transaction, then physically cleans up files', () => {
    assert.match(source, /\$transaction/)
    assert.match(source, /Promise\.allSettled/)
    assert.match(source, /deleteAttachmentFile/)
  })

  it('reports per-attachment cleanup warnings without deleting others', () => {
    // One rejected file delete must not abort the remaining deletes; failures
    // are surfaced individually as warnings.
    assert.match(source, /warnings/)
    assert.match(source, /status === 'rejected'/)
  })
})

describe('submitSolutionSchema validates attachment IDs (Task 3 brief)', () => {
  const validInput = {
    requestId: randomUUID(),
    title: 'Solution title',
    description: 'Solution description',
  }

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

describe('submitSolution transfers only owned staged attachments (Task 3 brief)', () => {
  const solutionsSource = readFileSync('src/server-actions/solutions.ts', 'utf8')
  const submitBody = solutionsSource.slice(
    solutionsSource.indexOf('export async function submitSolution'),
    solutionsSource.indexOf('export async function createCustomApprovalChain')
  )

  it('queries staged attachments scoped to the current user inside the transaction', () => {
    // The staged-attachment query must intersect ALL of: these ids, this request,
    // still unlinked (solutionId null), and owned by the submitting user.
    assert.match(submitBody, /file_attachments\.findMany/)
    assert.match(submitBody, /id:\s*\{\s*in:\s*validated\.fileIds\s*\}/)
    assert.match(submitBody, /requestId:\s*validated\.requestId/)
    assert.match(submitBody, /solutionId:\s*null/)
    assert.match(submitBody, /uploadedById:\s*user\.id/)
  })

  it('compares the found count to the unique id count and throws before linking', () => {
    assert.match(submitBody, /stagedAttachments\.length !== validated\.fileIds\.length/)
    assert.match(submitBody, /One or more attachments are invalid or no longer available/)
  })

  it('verifies the updateMany count before continuing', () => {
    assert.match(submitBody, /file_attachments\.updateMany/)
    assert.match(submitBody, /\.count !== validated\.fileIds\.length/)
  })
})

describe('resubmitSolutionSchema validates resubmission attachment IDs (Task 4 brief)', () => {
  const validInput = {
    requestId: randomUUID(),
    title: 'Updated solution title',
    description: 'Updated solution description',
    cost: 1500,
    currency: 'THB' as const,
    timeline: '3 weeks',
    useCustomHierarchy: false,
  }

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
    assert.match(resubmitBody, /resubmitSolution\(input: ResubmitSolutionInput\)/)
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

  it('queries staged attachments scoped to requestId / solutionId:null / uploadedById', () => {
    assert.match(resubmitBody, /file_attachments\.findMany/)
    assert.match(resubmitBody, /id:\s*\{\s*in:\s*validated\.newFileIds\s*\}/)
    assert.match(resubmitBody, /requestId:\s*validated\.requestId/)
    assert.match(resubmitBody, /solutionId:\s*null/)
    assert.match(resubmitBody, /uploadedById:\s*user\.id/)
  })

  it('requires an exact staged-count match before linking', () => {
    assert.match(resubmitBody, /stagedAttachments\.length !== validated\.newFileIds\.length/)
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

// Task 6: the shared upload flow is wired through the dedicated SolutionForm
// and the SubmitterModal solution/resubmit modes, and the modal router passes
// attachment IDs (never raw File[]) across the server boundary. These
// source-wiring assertions pin the integration the brief describes in Step 1;
// they fail until the duplicated upload loops are removed and the hook is wired
// through both components.
describe('Task 6 source-wiring: hook integration and ID-only server boundary', () => {
  const solutionForm = readFileSync('src/components/solutions/solution-form.tsx', 'utf8')
  const submitterModal = readFileSync('src/components/requests/submitter-modal.tsx', 'utf8')
  const router = readFileSync('src/components/requests/request-modal-router.tsx', 'utf8')

  it('SolutionForm consumes useSolutionAttachments', () => {
    assert.match(solutionForm, /useSolutionAttachments/)
  })

  it('SubmitterModal consumes useSolutionAttachments', () => {
    assert.match(submitterModal, /useSolutionAttachments/)
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
    // The Cancel button must use an async handler, not direct router.back()
    assert.match(solutionForm, /const handleCancel = async/)
    // reset() must be awaited before router.back()
    assert.match(solutionForm, /await reset\(\)/)
    // Cleanup failure is surfaced (not silently swallowed)
    assert.match(solutionForm, /Failed to clean up draft files/)
    // The Cancel button delegates to the handler
    assert.match(solutionForm, /onClick={handleCancel}/)
  })
})

// Task 7 follow-up: a transport-level upload failure (HTTP 500) must leave the
// item in a terminal `error` state (not stuck at `uploading`), be visibly
// failed, block metadata submission, and be retryable without re-uploading the
// successes. The batch coordinator catches a thrown uploadOne and records a
// terminal error (covered in upload-batch.test.ts); these assertions pin that
// both submitter surfaces wire a Retry affordance to ensureUploaded() — never
// to the metadata submit — so a failed item can be retried in isolation.
describe('Task 7 follow-up: per-item retry wiring (transport-error resilience)', () => {
  const solutionForm = readFileSync('src/components/solutions/solution-form.tsx', 'utf8')
  const submitterModal = readFileSync('src/components/requests/submitter-modal.tsx', 'utf8')

  it('SolutionForm binds onRetryItem to an async retry handler', () => {
    // The file-upload card exposes a Retry action per errored item, and the
    // form must wire it to a handler (not leave it unbound).
    assert.match(solutionForm, /const handleRetryItem = async/)
    assert.match(solutionForm, /onRetryItem=\{handleRetryItem\}/)
  })

  it('SolutionForm retry handler calls ensureUploaded only and never submits metadata', () => {
    // Scope to the retry handler body: from its declaration to the next handler
    // declaration, so the metadata submit in handleSubmit cannot leak in.
    const start = solutionForm.indexOf('const handleRetryItem')
    const next = solutionForm.indexOf('const handle', start + 1)
    const retrySlice = solutionForm.slice(start, next === -1 ? undefined : next)
    // Respects the in-flight submit/upload guard.
    assert.match(retrySlice, /if \(isSubmitting\) return/)
    // Re-uploads via the authoritative coordinator; never the metadata action.
    assert.match(retrySlice, /await ensureUploaded\(\)/)
    assert.doesNotMatch(retrySlice, /submitSolution/)
  })

  it('SolutionForm retry handler reports remaining failure or success', () => {
    const start = solutionForm.indexOf('const handleRetryItem')
    const next = solutionForm.indexOf('const handle', start + 1)
    const retrySlice = solutionForm.slice(start, next === -1 ? undefined : next)
    // Branches on the coordinator result and surfaces either outcome.
    assert.match(retrySlice, /!result\.success/)
    assert.match(retrySlice, /entry\.status === 'error'/)
    assert.match(retrySlice, /toast\.success|toast\.error/)
  })

  it('SubmitterModal exposes a Retry action beside errored attachment items', () => {
    // A retry affordance is rendered for items in the error state and is wired
    // to a dedicated handler (distinct from the submit button).
    assert.match(submitterModal, /const handleRetryAttachment = async/)
    assert.match(submitterModal, /onClick=\{handleRetryAttachment\}/)
  })

  it('SubmitterModal retry calls ensureUploaded only, gated on isBusy, no metadata', () => {
    const start = submitterModal.indexOf('const handleRetryAttachment')
    const next = submitterModal.indexOf('const handleSubmit', start + 1)
    const retrySlice = submitterModal.slice(start, next === -1 ? undefined : next)
    // Uses the modal's busy guard, not the form's.
    assert.match(retrySlice, /if \(isBusy\) return/)
    assert.match(retrySlice, /await ensureUploaded\(\)/)
    // Surfaces remaining failures through the modal's error channel.
    assert.match(retrySlice, /setSubmitError/)
    // Retry must never invoke the metadata submit.
    assert.doesNotMatch(retrySlice, /onSubmitSolution/)
    assert.doesNotMatch(retrySlice, /onResubmit/)
  })
})
