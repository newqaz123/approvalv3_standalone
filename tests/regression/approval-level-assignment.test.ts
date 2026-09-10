import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
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
    assert.match(createUserFn, /prisma\.user\.create\(\{[\s\S]*?\blevel,/)
    assert.match(updateUserFn, /prisma\.user\.update\(\{[\s\S]*?\blevel,/)
    assert.doesNotMatch(createUserFn, /level:\s*input\.level/)
    assert.doesNotMatch(updateUserFn, /level:\s*input\.level/)
  })

  it('C1: department-approver assignment editor is removed; user-form has no department pickers', () => {
    assert.equal(existsSync('src/server-actions/department-assignments.ts'), false)
    assert.equal(existsSync('src/components/admin/additional-departments-section.tsx'), false)

    const userForm = read('src/components/admin/user-form.tsx')
    assert.doesNotMatch(userForm, /departmentId/)
    assert.doesNotMatch(userForm, /DepartmentSelector/)
    assert.doesNotMatch(userForm, /APPROVAL_LEVELS/)
    assert.doesNotMatch(userForm, /organizationUnits/)
  })
})
