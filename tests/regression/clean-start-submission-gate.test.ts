// Clean-start assignment submission gate (Plan B Task 6).
// In-memory fakes only: NO Prisma, NO database, NO env, NO schema/server ops.
// Spec: every active user with an active organization assignment may submit
// requests. No per-user Submit-requests checkbox. Inactive or unassigned
// users cannot submit.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { canSubmitRequests } from '@/lib/approval-engine/attempts'

describe('canSubmitRequests', () => {
  it('allows an active user with an active assignment', () => {
    assert.equal(canSubmitRequests({ isActiveUser: true, hasActiveAssignment: true }), true)
  })

  it('refuses an inactive user even when assigned', () => {
    assert.equal(canSubmitRequests({ isActiveUser: false, hasActiveAssignment: true }), false)
  })

  it('refuses an unassigned active user', () => {
    assert.equal(canSubmitRequests({ isActiveUser: true, hasActiveAssignment: false }), false)
  })

  it('refuses an inactive unassigned user', () => {
    assert.equal(canSubmitRequests({ isActiveUser: false, hasActiveAssignment: false }), false)
  })

  it('source contract: gate is only isActiveUser + hasActiveAssignment; no per-user checkbox', () => {
    const source = readFileSync('src/lib/approval-engine/attempts.ts', 'utf8')
    assert.match(source, /export function canSubmitRequests/)
    assert.match(source, /isActiveUser/)
    assert.match(source, /hasActiveAssignment/)
    assert.doesNotMatch(source, /submitPermission/)
    assert.doesNotMatch(source, /canSubmit\s*:/)
    assert.doesNotMatch(source, /@prisma\/client/)
  })
})
