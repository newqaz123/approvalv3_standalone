import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { validateLevelNames } from '@/lib/approval-levels'

const read = (path: string) => readFileSync(path, 'utf8')

describe('department level configuration', () => {
  it('accepts level 10 and rejects level 11 at the shared validation boundary', () => {
    assert.deepEqual(validateLevelNames({ '10': 'Director' }), { '10': 'Director' })
    assert.throws(() => validateLevelNames({ '11': 'Invalid' }), /level/i)
  })

  it('validates department level names server-side and clears an explicitly empty map', () => {
    const source = read('src/server-actions/departments.ts')
    assert.match(source, /validateLevelNames/)
    assert.match(source, /levelNames:\s*validatedLevelNames/)
  })

  it('lets the admin form add ten levels and communicates the limit', () => {
    const source = read('src/components/admin/department-form.tsx')
    assert.match(source, /MAX_APPROVAL_LEVEL/)
    assert.match(source, /levelEntries\.length\s*<\s*MAX_APPROVAL_LEVEL/)
    assert.match(source, /Maximum.*10|10.*maximum/i)
    assert.match(source, /return updated\.map\(\(entry, i\) => \(\{ \.\.\.entry, key: String\(i \+ 1\) \}\)\)/)
  })
})
