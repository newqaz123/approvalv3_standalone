import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(path, 'utf8')

describe('business suite isolation cleanup', () => {
  it('T17 cleanup signs in as admin before looking for exception rows', () => {
    const source = read('tests/business-e2e/business-chain-changes.spec.ts')
    const fn = source.match(/async function cleanupExceptionIfPresent[\s\S]*?\n\}/)
    assert.ok(fn, 'cleanupExceptionIfPresent must exist')
    assert.match(
      fn[0],
      /signedInSegment/,
      'cleanup must use signedInSegment so a logged-out chains page cannot no-op',
    )
    assert.match(
      fn[0],
      /BUSINESS_ACTOR_EMAILS\.admin/,
      'cleanup must authenticate as admin',
    )
    assert.doesNotMatch(
      fn[0],
      /withRecordedContext/,
      'logged-out withRecordedContext treats missing rows as "already clean"',
    )
  })

  it('T18B cleanup restores Department manager as well as Section manager P without a finally that can replace the primary', () => {
    const source = read('tests/business-e2e/business-approver-availability.spec.ts')
    const t18b = source.match(/test\('T18B stranded attempt[\s\S]*?\n  \}\)/)
    assert.ok(t18b, 'T18B must exist')
    assert.doesNotMatch(t18b[0], /finally \{/, 'a finally throw can replace the primary failure')
    assert.match(t18b[0], /runStrandedReplacementCleanupGuarded/)
    assert.match(
      t18b[0],
      /reactivateDepartmentManager:[\s\S]*BUSINESS_ACTOR_EMAILS\.departmentManager/,
      'Department manager reactivation must be its own step',
    )
    assert.match(
      t18b[0],
      /reactivateSectionManager:[\s\S]*BUSINESS_ACTOR_EMAILS\.sectionManagerP/,
      'Section manager P reactivation must be its own step',
    )
    assert.match(t18b[0], /unit-header-unit-production-1/)
    assert.doesNotMatch(t18b[0], /unit-toggle-unit-production-1/)
    assert.match(t18b[0], /name: 'Production 1', exact: true/)
  })

  it('activateUserViaUi is a no-op when the user is already Active', () => {
    const source = read('tests/business-e2e/business-flow-helpers.ts')
    const fn = source.match(/export async function activateUserViaUi[\s\S]*?\n\}/)
    assert.ok(fn, 'activateUserViaUi must exist')
    assert.match(
      fn[0],
      /Inactive/,
      'activateUserViaUi must look at Inactive before opening Activate',
    )
  })
})
