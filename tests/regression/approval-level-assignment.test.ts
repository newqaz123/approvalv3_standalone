import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { validateApprovalLevel } from '@/lib/approval-levels'

const read = (path: string) => readFileSync(path, 'utf8')

describe('approval level assignment boundaries', () => {
  it('accepts only the inclusive 1–10 integer range', () => {
    assert.equal(validateApprovalLevel(1), 1)
    assert.equal(validateApprovalLevel(10), 10)
    for (const invalid of [0, 11, 1.5]) {
      assert.throws(() => validateApprovalLevel(invalid), /1.*10|integer/)
    }
  })

  it('validates internal user create/update writes', () => {
    const source = read('src/server-actions/users.ts')
    assert.match(source, /validateApprovalLevel\(input\.level,\s*\{\s*allowNull:\s*true\s*\}\)/)
    assert.ok((source.match(/validateApprovalLevel/g) ?? []).length >= 2)
  })

  it('validates external department-approver writes', () => {
    const source = read('src/server-actions/department-assignments.ts')
    assert.match(source, /validateApprovalLevel\(level\)/)
  })

  it('uses the shared ten-level policy in both assignment editors', () => {
    for (const path of [
      'src/components/admin/user-form.tsx',
      'src/components/admin/additional-departments-section.tsx',
    ]) {
      const source = read(path)
      assert.match(source, /APPROVAL_LEVELS|MAX_APPROVAL_LEVEL/)
    }
  })
})
