import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

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
