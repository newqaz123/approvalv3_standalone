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
    const createUserFn =
      source.match(/export async function createUser[\s\S]*?(?=\nexport async function |\n\/\*\*|$)/)?.[0] ?? ''
    const updateUserFn =
      source.match(/export async function updateUser[\s\S]*?(?=\nexport async function |\n\/\*\*|$)/)?.[0] ?? ''

    assert.match(
      createUserFn,
      /validateApprovalLevel\(input\.level,\s*\{\s*allowNull:\s*true\s*\}\)/,
    )
    assert.match(
      updateUserFn,
      /validateApprovalLevel\(input\.level,\s*\{\s*allowNull:\s*true\s*\}\)/,
    )

    // Prisma writes must persist the validated `level` binding, not raw input.level
    assert.match(createUserFn, /prisma\.user\.create\(\{[\s\S]*?\blevel,/
    )
    assert.match(updateUserFn, /prisma\.user\.update\(\{[\s\S]*?\blevel,/
    )
    assert.doesNotMatch(createUserFn, /level:\s*input\.level/)
    assert.doesNotMatch(updateUserFn, /level:\s*input\.level/)
  })

  it('validates external department-approver writes', () => {
    const source = read('src/server-actions/department-assignments.ts')
    assert.match(source, /validateApprovalLevel\(level\)/)
    assert.match(source, /approverLevel:\s*validatedLevel\b/)
    assert.doesNotMatch(source, /approverLevel:\s*level\b/)
    assert.doesNotMatch(source, /validatedLevel as number/)
  })

  it('uses the shared ten-level policy in both assignment editors', () => {
    for (const path of [
      'src/components/admin/user-form.tsx',
      'src/components/admin/additional-departments-section.tsx',
    ]) {
      const source = read(path)
      assert.match(source, /APPROVAL_LEVELS|MAX_APPROVAL_LEVEL/)
    }

    const userForm = read('src/components/admin/user-form.tsx')
    assert.match(userForm, /None if not applicable|or None/i)
    assert.doesNotMatch(userForm, /Leave blank if not applicable/)
  })
})
