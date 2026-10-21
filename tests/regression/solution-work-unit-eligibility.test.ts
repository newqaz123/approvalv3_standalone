// H9: solution-work surfaces (engineering dashboard, needs-action list,
// manual completion, Engineering navigation) use the unit
// "Can work on solutions" flag, never the user role.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import type { OrganizationUnitNode } from '@/lib/organization/model'
import { isActorSolutionWorker, type SolutionWorkActorDb } from '@/lib/solution-work-actor'

const read = (path: string) => readFileSync(path, 'utf8')

function bodyOf(path: string, marker: string): string {
  const source = read(path)
  const start = source.indexOf(marker)
  assert.ok(start >= 0, `${path} missing ${marker}`)
  const end = source.indexOf('\nexport ', start + 1)
  return source.slice(start, end === -1 ? undefined : end)
}

const u = (id: string, parentId: string | null, over: Partial<OrganizationUnitNode> = {}): OrganizationUnitNode => ({
  id,
  name: id,
  parentId,
  isActive: true,
  shareRequests: false,
  canWorkOnSolutions: false,
  managerUserId: null,
  ...over,
})

const units: OrganizationUnitNode[] = [
  u('company', null),
  u('engineering', 'company', { canWorkOnSolutions: true }),
  u('eng-team', 'engineering'),
  u('ops', 'company'),
  u('retired-eng', 'company', { canWorkOnSolutions: true, isActive: false }),
]

function fakeDb(users: Record<string, { isActive: boolean; role: string; unitIds: string[] }>): SolutionWorkActorDb {
  return {
    async findUser(userId) {
      const user = users[userId]
      return user ? { isActive: user.isActive } : null
    },
    async findActiveAssignmentUnitIds(userId) {
      return users[userId]?.unitIds ?? []
    },
    async findUnits() {
      return units
    },
  }
}

describe('isActorSolutionWorker (unit-flag eligibility)', () => {
  const db = fakeDb({
    flaggedGeneral: { isActive: true, role: 'general_dept', unitIds: ['engineering'] },
    descendant: { isActive: true, role: 'general_dept', unitIds: ['eng-team'] },
    roleOnly: { isActive: true, role: 'engineering', unitIds: ['ops'] },
    inactive: { isActive: false, role: 'engineering', unitIds: ['engineering'] },
    retired: { isActive: true, role: 'engineering', unitIds: ['retired-eng'] },
    unassigned: { isActive: true, role: 'engineering', unitIds: [] },
  })

  it('grants a non-engineering-role user assigned to a flagged unit', async () => {
    assert.equal(await isActorSolutionWorker(db, 'flaggedGeneral'), true)
  })
  it('grants a user in a descendant of a flagged unit', async () => {
    assert.equal(await isActorSolutionWorker(db, 'descendant'), true)
  })
  it('denies an engineering-ROLE user whose unit is not flagged', async () => {
    assert.equal(await isActorSolutionWorker(db, 'roleOnly'), false)
  })
  it('denies inactive users, inactive flagged units, unassigned and unknown users', async () => {
    assert.equal(await isActorSolutionWorker(db, 'inactive'), false)
    assert.equal(await isActorSolutionWorker(db, 'retired'), false)
    assert.equal(await isActorSolutionWorker(db, 'unassigned'), false)
    assert.equal(await isActorSolutionWorker(db, 'nobody'), false)
  })
})

describe('solution-work surfaces are unit-flag gated, not role gated', () => {
  it('engineering dashboard page gates on isActorSolutionWorker', () => {
    const page = read('src/app/(dashboard)/engineering/page.tsx')
    assert.doesNotMatch(page, /role\s*!==\s*["']engineering["']/)
    assert.match(page, /isActorSolutionWorker\(/)
    // never pass a client/user id into the needs-action query
    assert.match(page, /getRequestsNeedingEngineeringAction\(\)/)
  })

  it('getRequestsNeedingEngineeringAction derives the actor from the session, not a parameter', () => {
    const body = bodyOf('src/server-actions/requests.ts', 'export async function getRequestsNeedingEngineeringAction')
    assert.match(body, /export async function getRequestsNeedingEngineeringAction\(\)/)
    assert.match(body, /await auth\(\)/)
    assert.match(body, /isActorSolutionWorker\(/)
    assert.doesNotMatch(body, /role\s*!==\s*'engineering'/)
  })

  it('markRequestComplete and canMarkComplete use unit-flag eligibility', () => {
    for (const marker of ['export async function markRequestComplete', 'export async function canMarkComplete']) {
      const body = bodyOf('src/server-actions/solutions.ts', marker)
      assert.match(body, /isActorSolutionWorker\(/, marker)
      assert.doesNotMatch(body, /UserRole\.engineering/, marker)
    }
  })

  it('Engineering navigation follows the unit flag from /api/user/department', () => {
    const route = read('src/app/api/user/department/route.ts')
    assert.match(route, /canWorkOnSolutions:\s*await isActorSolutionWorker\(/)
    for (const path of ['src/components/navigation/navbar.tsx', 'src/components/mobile/mobile-nav.tsx']) {
      const source = read(path)
      assert.doesNotMatch(source, /role\s*===\s*["']engineering["']/, path)
      assert.match(source, /\/api\/user\/department/, path)
      assert.match(source, /canWorkOnSolutions/, path)
    }
  })
})
