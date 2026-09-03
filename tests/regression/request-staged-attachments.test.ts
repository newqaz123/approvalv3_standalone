import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync('src/server-actions/requests.ts', 'utf8')
const approvalsSource = readFileSync('src/server-actions/approvals.ts', 'utf8')
const storageSource = readFileSync('src/lib/attachments/storage.ts', 'utf8')

const createRequest = source.slice(
  source.indexOf('export async function createRequest'),
  source.indexOf('export interface GetRequestsFilters'),
)
const txCallback = createRequest.slice(
  createRequest.indexOf('prisma.$transaction'),
  createRequest.indexOf('request = txResult.request'),
)

describe('createRequest stagedAttachmentIds schema', () => {
  it('declares unique UUID ids bounded by MAX_ATTACHMENTS_PER_FORM and defaulting to []', () => {
    assert.match(source, /stagedAttachmentIds:\s*z\.array\(z\.string\(\)\.uuid\(\)\)/)
    assert.match(source, /MAX_ATTACHMENTS_PER_FORM/)
    assert.match(source, /new Set\(ids\)\.size === ids\.length/)
    assert.match(source, /Attachment IDs must be unique/)
    assert.match(source, /\.default\(\[\]\)/)
    assert.match(source, /stagedAttachmentIds\?:\s*string\[\]/)
  })

  it('does not accept client path/name/type/size metadata', () => {
    assert.doesNotMatch(source, /stagedAttachments:\s*z/)
    assert.doesNotMatch(source, /stagedPath:\s*z/)
    assert.doesNotMatch(source, /export interface StagedAttachmentInput/)
    assert.doesNotMatch(createRequest, /\bstagedAttachments\b/)
  })
})

describe('createRequest verifies owner-scoped ready drafts before adopting', () => {
  it('prechecks exact IDs with uploadedById, requestId null, solutionId null, and ready prefix', () => {
    const precheck = createRequest.slice(0, createRequest.indexOf('prisma.$transaction'))
    assert.match(precheck, /file_attachments\.findMany/)
    assert.match(precheck, /readyRequestDraftWhere\(stagedAttachmentIds,\s*user\.id\)/)
    assert.match(source, /uploadedById/)
    assert.match(source, /requestId:\s*null/)
    assert.match(source, /solutionId:\s*null/)
    assert.match(source, /filePath:\s*\{\s*startsWith:\s*REQUEST_DRAFT_READY_PREFIX\s*\}/)
    assert.match(source, /request-drafts\/ready\//)
    assert.match(precheck, /drafts\.length !== stagedAttachmentIds\.length/)
  })

  it('rejects non-ready paths and missing physical files before the transaction', () => {
    const precheck = createRequest.slice(0, createRequest.indexOf('prisma.$transaction'))
    assert.match(precheck, /isRequestDraftReadyPath\(draft\.filePath\)/)
    assert.match(precheck, /attachmentFileExists\(draft\.filePath\)/)
    assert.ok(
      precheck.indexOf('isRequestDraftReadyPath') < createRequest.indexOf('prisma.$transaction'),
    )
    assert.ok(
      precheck.indexOf('attachmentFileExists') < createRequest.indexOf('prisma.$transaction'),
    )
  })
})

describe('createRequest adopts ready draft IDs inside the same transaction', () => {
  it('creates the request then conditionally updateMany-adopts the exact IDs', () => {
    const createIdx = txCallback.indexOf('tx.requests.create')
    const adoptIdx = txCallback.indexOf('tx.file_attachments.updateMany')
    assert.ok(createIdx >= 0, 'request must be created inside the transaction')
    assert.ok(adoptIdx >= 0, 'draft rows must be adopted with tx.file_attachments.updateMany')
    assert.ok(createIdx < adoptIdx, 'request create must happen before adoption')
    assert.match(txCallback, /readyRequestDraftWhere\(stagedAttachmentIds,\s*user\.id\)/)
    assert.match(txCallback, /requestId:\s*newRequest\.id/)
    assert.match(txCallback, /adopted\.count !== stagedAttachmentIds\.length/)
  })

  it('reconciles inline images, writes creation activity, and builds the approval chain in the same transaction', () => {
    assert.match(txCallback, /reconcileInlineDescriptionImages\(tx/)
    assert.match(txCallback, /action:\s*'created'/)
    assert.match(txCallback, /createApprovalChain\(/)
    assert.match(txCallback, /\btx,\s*\)/)
    assert.match(approvalsSource, /db: Prisma\.TransactionClient \| typeof prisma = prisma/)
    assert.match(approvalsSource, /db\.request_approvals\.createMany/)
    assert.match(approvalsSource, /getMaxLevelInDepartment\(departmentId, db\)/)
  })

  it('applies top-level auto-approve status and activity inside the same transaction', () => {
    assert.match(txCallback, /status:\s*'SentToEngineer'/)
    assert.match(txCallback, /action:\s*'status_changed'/)
    assert.match(txCallback, /Auto-approved by top-level user/)
    const statusIdx = txCallback.indexOf("status: 'SentToEngineer'")
    const notifyIdx = createRequest.indexOf('createNotification')
    const txIdx = createRequest.indexOf('prisma.$transaction')
    assert.ok(statusIdx >= 0)
    assert.ok(notifyIdx > txIdx, 'top-level status change must not wait for notifications')
  })

  it('creates notifications only after transaction success', () => {
    const txIdx = createRequest.indexOf('prisma.$transaction')
    const notifyIdx = createRequest.indexOf('createNotification')
    assert.ok(txIdx >= 0)
    assert.ok(notifyIdx >= 0, 'createRequest must still notify approvers')
    assert.ok(notifyIdx > txIdx, 'notifications must run after prisma.$transaction')
    const txEnd = createRequest.indexOf('request = txResult.request')
    assert.ok(notifyIdx > txEnd, 'notifications must run after the transaction result is assigned')
  })
})

describe('createRequest does not move files during submit', () => {
  it('keeps ready draft paths stable and has no rename/move/restore/claim/tombstone', () => {
    assert.doesNotMatch(createRequest, /\brename\s*\(/)
    assert.doesNotMatch(createRequest, /moveAttachmentFile/)
    assert.doesNotMatch(createRequest, /createStoredAttachmentPath/)
    assert.doesNotMatch(createRequest, /isStagedAttachmentPath/)
    assert.doesNotMatch(createRequest, /createStagedAttachmentPath/)
    assert.doesNotMatch(createRequest, /Failed to restore staged attachment/)
    assert.doesNotMatch(createRequest, /tombstone/)
    assert.doesNotMatch(createRequest, /file_attachments\.createMany/)
  })

  it('leaves request-draft path helpers in storage and removes legacy stage/ helpers', () => {
    assert.match(storageSource, /export function createRequestDraftReadyPath/)
    assert.match(storageSource, /export function isRequestDraftReadyPath/)
    assert.match(storageSource, /export function createRequestDraftUploadingPath/)
    assert.doesNotMatch(storageSource, /export function createStagedAttachmentPath/)
    assert.doesNotMatch(storageSource, /export function isStagedAttachmentPath/)
  })
})
