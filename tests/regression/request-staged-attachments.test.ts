import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync('src/server-actions/requests.ts', 'utf8')
const approvalsSource = readFileSync('src/server-actions/approvals.ts', 'utf8')

const createRequest = source.slice(
  source.indexOf('export async function createRequest'),
  source.indexOf('export interface GetRequestsFilters'),
)

describe('createRequest stagedAttachments schema (Task 3)', () => {
  it('declares stagedAttachments on the zod schema with path/name/type/size/description', () => {
    assert.match(source, /stagedAttachments:\s*z/)
    assert.match(source, /stagedPath:\s*z\.string\(\)\.min\(1\)/)
    assert.match(source, /fileName:\s*z\.string\(\)\.min\(1\)/)
    assert.match(source, /fileType:\s*z\.string\(\)\.min\(1\)/)
    assert.match(source, /fileSize:\s*z\.number\(\)\.int\(\)\.positive\(\)/)
    assert.match(source, /description:\s*z\.string\(\)\.max\(60\)\.optional\(\)/)
    assert.match(source, /MAX_ATTACHMENTS_PER_FORM/)
    assert.match(source, /export interface StagedAttachmentInput/)
  })
})

describe('createRequest moves staged files before the database transaction', () => {
  it('generates the request UUID before prisma.$transaction so final paths are known', () => {
    const requestIdIdx = createRequest.indexOf('const requestId = randomUUID()')
    const txIdx = createRequest.indexOf('prisma.$transaction')
    assert.ok(requestIdIdx >= 0, 'request UUID must be generated up front')
    assert.ok(txIdx >= 0, 'createRequest must use prisma.$transaction')
    assert.ok(requestIdIdx < txIdx, 'request UUID must be known before the transaction')
    assert.match(createRequest, /id:\s*requestId/)
    assert.match(createRequest, /createStoredAttachmentPath\(requestId/)
  })

  it('renames staged files to final paths before prisma.$transaction', () => {
    const renameIdx = createRequest.indexOf('await rename(')
    const txIdx = createRequest.indexOf('prisma.$transaction')
    assert.ok(renameIdx >= 0, 'createRequest must rename staged files')
    assert.ok(txIdx >= 0, 'createRequest must use prisma.$transaction')
    assert.ok(renameIdx < txIdx, 'rename must happen before prisma.$transaction')
  })
})

describe('createRequest treats staged client metadata as untrusted', () => {
  it('guards stagedPath, revalidates metadata, and compares declared size to disk stat', () => {
    assert.match(createRequest, /isStagedAttachmentPath\(item\.stagedPath\)/)
    assert.match(createRequest, /validateAttachmentMetadata/)
    assert.match(createRequest, /attachmentFileExists\(item\.stagedPath\)/)
    assert.match(createRequest, /info\.size !== item\.fileSize/)
    assert.match(createRequest, /fileSize:\s*info\.size/)
  })
})

describe('createRequest commits request rows, attachments, and approvals atomically', () => {
  it('inserts file_attachments rows inside the transaction', () => {
    const txBody = createRequest.slice(createRequest.indexOf('prisma.$transaction'))
    const notifyIdx = txBody.indexOf('createNotification')
    const createManyIdx = txBody.indexOf('tx.file_attachments.createMany')
    assert.ok(createManyIdx >= 0, 'attachment rows must be created with tx.file_attachments.createMany')
    assert.ok(notifyIdx < 0 || createManyIdx < notifyIdx, 'attachment rows must be created before notifications')
  })

  it('writes the approval chain inside the same transaction', () => {
    const txCallback = createRequest.slice(
      createRequest.indexOf('prisma.$transaction'),
      createRequest.indexOf('request = txResult.request'),
    )
    assert.match(txCallback, /createApprovalChain\(/)
    assert.match(txCallback, /\btx,\s*\)/)
    assert.match(approvalsSource, /db: Prisma\.TransactionClient \| typeof prisma = prisma/)
    assert.match(approvalsSource, /db\.request_approvals\.createMany/)
    assert.match(approvalsSource, /getMaxLevelInDepartment\(departmentId, db\)/)
  })

  it('creates notifications only after transaction success', () => {
    const txIdx = createRequest.indexOf('prisma.$transaction')
    const notifyIdx = createRequest.indexOf('createNotification')
    assert.ok(txIdx >= 0)
    assert.ok(notifyIdx >= 0, 'createRequest must still notify approvers')
    assert.ok(notifyIdx > txIdx, 'notifications must run after prisma.$transaction')
  })

  it('restores moved files to staging when the transaction fails', () => {
    const txIdx = createRequest.indexOf('prisma.$transaction')
    const restoreIdx = createRequest.indexOf('movedAttachments].reverse()')
    assert.ok(restoreIdx > txIdx, 'restore must run after a failed transaction attempt')
    assert.match(createRequest, /Failed to restore staged attachment/)
  })
})
