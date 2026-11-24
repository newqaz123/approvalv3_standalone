import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { createTranslator } from '../../src/lib/i18n/messages'

const en = createTranslator('en')
const th = createTranslator('th')
const source = (path: string) => readFileSync(`src/${path}`, 'utf8')

test('DeleteRequestModal translates actions and interpolates the exact configured title', () => {
  assert.equal(en('admin.deletePermanently'), 'Permanently Delete')
  assert.equal(th('admin.deletePermanently'), 'ลบถาวร')
  const title = 'Pending — ชื่อเดิม {count}'
  assert.equal(th('admin.deleteSingleDescription', { title }), `จะลบ "${title}" และข้อมูลทั้งหมดถาวร ย้อนกลับไม่ได้`)
  const modal = source('components/admin/delete-request-modal.tsx')
  assert.match(modal, /t\('admin\.deletePermanently'\)/)
  assert.match(modal, /confirmText !== 'PERMANENTLY DELETE'/)
})

test('Audit export controls translate without replacing export formats, statuses or raw details', () => {
  assert.equal(en('admin.exportByRequest'), 'Export by Request')
  assert.equal(th('admin.exportByRequest'), 'ส่งออกตาม Request')
  assert.match(source('components/admin/request-export-card.tsx'), /\{request\.status\}/)
  assert.match(source('app/admin/deleted-requests/page.tsx'), /request\.activities\[0\]\.comments/)
  assert.match(source('components/admin/audit-export-button.tsx'), /\?format=\$\{format\}/)
})
