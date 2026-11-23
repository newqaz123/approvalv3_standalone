import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { translateActivityAction, transformActivitiesToTimeline } from '../../src/lib/modal-data-adapters'
import { createTranslator } from '../../src/lib/i18n/messages'

const th = createTranslator('th')
const en = createTranslator('en')

test('workflow uses the fixed glossary for controls, not status values', () => {
  assert.equal(en('requests.newRequest'), 'New Request')
  assert.equal(th('requests.newRequest'), 'สร้าง Request')
  assert.equal(th('requests.submitRequest'), 'ส่ง Request')
  assert.equal(th('requests.submitSolution'), 'ส่ง Solution')
  assert.equal(th('requests.submitFinalShort'), 'ส่งให้อนุมัติรอบ Final')
  assert.equal(th('nav.pendingApprovals'), 'รอคุณอนุมัติ')
  assert.equal(th('common.status'), 'สถานะ')
})

test('workflow has translated validation, expected failures and generic failure copy', () => {
  assert.equal(th('requests.error.assignmentRequired'), 'คุณต้องมีหน่วยงานก่อนสร้าง Request')
  assert.equal(th('requests.error.requestTitleRequired'), 'ระบุชื่อ Request ให้ถูกต้อง')
  assert.equal(th('requests.error.create'), 'ยังส่ง Request ไม่ได้ ลองอีกครั้ง')
  assert.notEqual(th('requests.error.create'), en('requests.error.create'))
})

const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8')

test('creation failures select stable keys and never show a raw server error', () => {
  const action = read('src/server-actions/requests.ts')
  const ui = read('src/components/requests/requests-list-client.tsx')
  assert.match(action, /errorKey: 'requests\.error\.assignmentRequired'/)
  assert.match(action, /path\[0\] === 'title'[\s\S]*?requests\.error\.requestTitleRequired/)
  assert.match(ui, /t\(result\.errorKey \?\? 'requests\.error\.create'\)/)
  assert.doesNotMatch(ui, /(?:result\.error\b|error\.message)/)
})

test('timeline translates known actions, not comments or opaque action text', () => {
  const common = { createdAt: new Date('2026-01-01T00:00:00.000Z'), user: { name: 'สมชาย Example', email: 'example@example.com' }, comments: 'Improve this — ข้อคิดเห็นเดิม' }
  const [created, opaque] = transformActivitiesToTimeline([
    { ...common, id: '1', action: 'created' },
    { ...common, id: '2', action: 'external_activity' },
  ])
  assert.equal(translateActivityAction(en, created), 'Request created')
  assert.equal(translateActivityAction(th, created), 'สร้าง Request แล้ว')
  assert.equal(translateActivityAction(th, opaque), 'external_activity')
  assert.equal(created.details, common.comments)
  assert.equal(created.user, common.user.name)
})

test('transactional creation failures retain compatibility and return actionable keys by error class', () => {
  const action = read('src/server-actions/requests.ts')
  const catchBlock = action.slice(action.indexOf("console.error('Failed to create request atomically:'"), action.indexOf('if (pendingCandidateUserIds.length > 0)'))
  for (const [failure, key] of [
    ['SubmissionDeniedError', 'assignmentRequired'],
    ['ApprovalRouteConfigurationError', 'approvalRouteUnavailable'],
    ['ApprovalEnginePlanError', 'approvalRouteUnavailable'],
    ['ApprovalEngineConflictError', 'createConflict'],
  ] as const) {
    assert.match(catchBlock, new RegExp(`error instanceof ${failure}[^{}]*\\{\\s*return \\{[^{}]*error: error\\.message,[^{}]*errorKey: 'requests\\.error\\.${key}'`))
  }
  assert.match(catchBlock, /return \{ success: false, error: 'Failed to create request — please try again' \}/)
  assert.match(th('requests.error.approvalRouteUnavailable'), /ติดต่อผู้ดูแลระบบ/)
  assert.match(th('requests.error.createConflict'), /รีเฟรช/)
})

test('both attachment download handlers use status-based copy instead of server response text', () => {
  const router = read('src/components/requests/request-modal-router.tsx')
  assert.equal(router.match(/t\(downloadFailureKey\(res\.status\)\)/g)?.length, 2)
  assert.doesNotMatch(router, /data\.error\s*\|\|\s*t\('requests\.error\.fileUnavailable'\)/)
})
