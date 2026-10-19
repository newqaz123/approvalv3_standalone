import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { getModalTypeForStatus } from '@/lib/permission-checks'
import { isCurrentInstanceApproval } from '@/lib/approval-engine/current-instance'

const read = (path: string) => readFileSync(path, 'utf8')

describe('current-instance rejection does not keep the resubmit modal after a new attempt', () => {
  it('superseded rejected rows are not current', () => {
    assert.equal(
      isCurrentInstanceApproval({ instanceId: null, instance: null }),
      true,
    )
    assert.equal(
      isCurrentInstanceApproval({
        instanceId: 'live',
        instance: { supersededAt: null },
      }),
      true,
    )
    assert.equal(
      isCurrentInstanceApproval({
        instanceId: 'old',
        instance: { supersededAt: new Date('2026-09-19T00:00:00.000Z') },
      }),
      false,
    )
  })

  it('ImprovementRequest with only superseded rejections uses the approver modal', () => {
    const approvals = [
      {
        status: 'rejected',
        isFinalApproval: false,
        instanceId: 'old',
        instance: { supersededAt: new Date('2026-09-19T00:00:00.000Z') },
      },
      {
        status: 'pending',
        isFinalApproval: false,
        instanceId: 'new',
        instance: { supersededAt: null },
      },
    ]
    const hasRejection = approvals.some(
      (row) =>
        row.status === 'rejected' &&
        !row.isFinalApproval &&
        isCurrentInstanceApproval(row),
    )
    assert.equal(hasRejection, false)
    const config = getModalTypeForStatus(
      'ImprovementRequest',
      hasRejection,
      false,
      false,
      true,
      false,
      false,
    )
    assert.equal(config.modalType, 'approver')
  })

  it('request-modal-router ignores superseded approval rows when choosing rejection modals', () => {
    const source = read('src/components/requests/request-modal-router.tsx')
    assert.match(source, /isCurrentInstanceApproval/)
  })

  it('getRequest loads instance.supersededAt on approval rows so the router can filter', () => {
    const source = read('src/server-actions/requests.ts')
    const getRequest = source.match(/export async function getRequest[\s\S]*?\nexport async function/)
    assert.ok(getRequest, 'getRequest must exist')
    assert.match(getRequest[0], /supersededAt/)
  })

  it('resubmitSolutionViaUi clicks Resubmit Solution and does not require #solutionTitle', () => {
    const source = read('tests/business-e2e/business-flow-helpers.ts')
    const fn = source.match(/export async function resubmitSolutionViaUi[\s\S]*?\n\}/)
    assert.ok(fn, 'resubmitSolutionViaUi must exist')
    assert.match(fn[0], /getByRole\('button', \{ name: 'Resubmit Solution' \}\)/)
    assert.match(fn[0], /\.click\(\)/)
    assert.doesNotMatch(fn[0], /#solutionTitle/)
  })

  it('modal adapter ignores superseded rows when building rejectionInfo', () => {
    const source = read('src/lib/modal-data-adapters.ts')
    assert.match(source, /isCurrentInstanceApproval/)
  })

  it('T14C permitted actor is Engineering resubmit, not requester Final restart', () => {
    const source = read('tests/business-e2e/business-reject-resubmit.spec.ts')
    const t14c = source.match(/test\('T14C Final rejection[\s\S]*?\n  \}\)/)
    assert.ok(t14c, 'T14C must exist')
    assert.match(t14c[0], /resubmitSolutionViaUi/)
    assert.doesNotMatch(t14c[0], /restartFinalApprovalViaUi/)
  })
})
