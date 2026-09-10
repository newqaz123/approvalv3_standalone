// Clean-start visibility caller rewiring (Plan B Task 9).
// Re-bases tests/regression/request-visibility.test.ts and
// tests/regression/private-file-access.test.ts. Callers must flow through
// B8 scope.ts. Production findActor is users + active assignment + A5
// sharingScopeUnitIds + managed descendants of units this actor manages.
// No department-type or engineering-role blanket. Visibility grants no mutation.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { sharingScopeUnitIds } from '@/lib/organization/sharing'
import { descendantUnitIds } from '@/lib/organization/hierarchy'
import type { OrganizationUnitNode } from '@/lib/organization/model'
import {
  buildRequestVisibilityWhere,
  createRequestVisibilityDb,
  type RequestVisibilityActor,
} from '@/lib/request-visibility/scope'

const read = (path: string) => readFileSync(path, 'utf8')

const CALLERS = [
  'src/app/(dashboard)/engineering/page.tsx',
  'src/app/api/files/download/route.ts',
  'src/lib/inline-images/lifecycle.ts',
  'src/server-actions/analytics.ts',
  'src/server-actions/budget-control.ts',
  'src/server-actions/dashboard.ts',
  'src/server-actions/engineering-sub-tasks.ts',
  'src/server-actions/files.ts',
  'src/server-actions/reports.ts',
  'src/server-actions/request-action-capabilities.ts',
  'src/server-actions/requests.ts',
  'src/server-actions/solutions.ts',
] as const

const u = (id: string, parentId: string | null, over: Partial<OrganizationUnitNode> = {}): OrganizationUnitNode =>
  ({ id, name: id, parentId, isActive: true, shareRequests: false, canWorkOnSolutions: false, managerUserId: null, ...over })

const specUnits = [
  u('company', null, { shareRequests: true }),
  u('operations', 'company', { shareRequests: true }),
  u('section-a', 'operations', { shareRequests: true }),
  u('section-a-child', 'section-a'),
  u('section-b', 'operations', { shareRequests: true }),
]

type FakeUser = { id: string; isActive: boolean; role: string }
type FakeAssignment = { userId: string; unitId: string; isActive: boolean }

function fakeVisibilityPrisma(input: {
  users: FakeUser[]
  assignments?: FakeAssignment[]
  units?: OrganizationUnitNode[]
}) {
  return {
    user: {
      async findUnique({ where }: { where: { id: string } }) {
        return input.users.find((user) => user.id === where.id) ?? null
      },
    },
    organization_assignments: {
      async findFirst({ where }: { where: { userId: string; isActive: boolean } }) {
        return (input.assignments ?? []).find((row) => row.userId === where.userId && row.isActive === where.isActive) ?? null
      },
    },
    organization_units: {
      async findMany() {
        return input.units ?? specUnits
      },
    },
    requests: {
      async findFirst() {
        return null
      },
    },
  }
}

function specPrisma() {
  return fakeVisibilityPrisma({
    users: [
      { id: 'pat', isActive: true, role: 'general' },
      { id: 'alice', isActive: true, role: 'general' },
      { id: 'bob', isActive: true, role: 'general' },
      { id: 'ops-manager', isActive: true, role: 'general' },
      { id: 'eng-outsider', isActive: true, role: 'engineering' },
      { id: 'admin', isActive: true, role: 'admin' },
      { id: 'inactive-pat', isActive: false, role: 'general' },
    ],
    assignments: [
      { userId: 'pat', unitId: 'operations', isActive: true },
      { userId: 'alice', unitId: 'section-a', isActive: true },
      { userId: 'bob', unitId: 'section-b', isActive: true },
      { userId: 'ops-manager', unitId: 'section-a', isActive: true },
      { userId: 'inactive-pat', unitId: 'operations', isActive: true },
    ],
    units: specUnits.map((unit) => unit.id === 'operations' ? { ...unit, managerUserId: 'ops-manager' } : unit),
  })
}

describe('visibility callers rewired to sharing-scope predicate', () => {
  it('every listed caller imports the B8 scope module and none keep predicate/request-access/department-type/engineering blanket', () => {
    for (const path of CALLERS) {
      const source = read(path)
      assert.match(source, /from ['"]@\/lib\/request-visibility\/scope['"]/, `${path} must import from scope.ts`)
      assert.doesNotMatch(source, /from ['"]@\/lib\/request-visibility\/predicate['"]/, `${path} must not import predicate.ts`)
      assert.doesNotMatch(source, /from ['"]@\/lib\/request-access['"]/, `${path} must not import request-access.ts`)
      assert.doesNotMatch(source, /departmentType === ['"]ENGINEERING['"]/, `${path} must not use department-type visibility blanket`)
      assert.doesNotMatch(source, /role === ['"]engineering['"][\s\S]{0,80}visibility|engineering['"] \|\| actor\.departmentType/, `${path} must not keep an engineering visibility blanket`)
    }
  })

  it('guards direct detail, list, counts, exports, files, and inline images with the shared scope policy', () => {
    for (const path of [
      'src/server-actions/requests.ts',
      'src/server-actions/dashboard.ts',
      'src/app/(dashboard)/engineering/page.tsx',
      'src/server-actions/analytics.ts',
      'src/server-actions/budget-control.ts',
      'src/server-actions/files.ts',
      'src/server-actions/reports.ts',
      'src/app/api/files/download/route.ts',
    ]) {
      const source = read(path)
      assert.match(source, /buildRequestVisibilityWhere|canUserViewRequest/)
      assert.match(source, /from ['"]@\/lib\/request-visibility\/scope['"]/)
    }
    const inlineRoute = read('src/app/api/inline-images/[id]/route.ts')
    const inlineLifecycle = read('src/lib/inline-images/lifecycle.ts')
    assert.match(inlineRoute, /canReadInlineImage/)
    assert.match(inlineLifecycle, /canUserViewRequest/)
    assert.match(inlineLifecycle, /from ['"]@\/lib\/request-visibility\/scope['"]/)
  })

  it('keeps admin audit and retention paths protected and deleted-record aware', () => {
    for (const path of [
      'src/server-actions/audit.ts',
      'src/app/api/audit/export/request/[requestId]/route.ts',
      'src/app/api/audit/export/date-range/route.ts',
      'src/app/api/admin/retention/backup/route.ts',
    ]) {
      const source = read(path)
      assert.match(source, /requireAdmin|admin/i)
    }
  })

  it('checks getRequest authorization before returning attachments or activities', () => {
    const source = read('src/server-actions/requests.ts')
    assert.match(source, /getRequest[\s\S]*canUserViewRequest[\s\S]*findUnique/)
  })

  it('composes ordinary list queries as AND of visibility and filters', () => {
    const source = read('src/server-actions/requests.ts')
    assert.match(source, /AND:\s*\[visibilityWhere/)
    assert.match(source, /buildRequestFilters/)
    assert.match(source, /createRequestVisibilityDb/)
  })

  it('keeps action counts on eligibility predicates rather than view permission', () => {
    const requests = read('src/server-actions/requests.ts')
    const dashboard = read('src/server-actions/dashboard.ts')
    const pendingCount = read('src/app/api/actions/pending-count/route.ts')
    assert.match(requests, /snapshotGroupActionWhere/)
    assert.match(requests, /CURRENT_INSTANCE_ROW_FILTER/)
    assert.match(dashboard, /snapshotGroupActionWhere/)
    assert.match(dashboard, /CURRENT_INSTANCE_ROW_FILTER/)
    assert.match(pendingCount, /snapshotGroupActionWhere/)
    assert.match(pendingCount, /CURRENT_INSTANCE_ROW_FILTER/)
    assert.doesNotMatch(pendingCount, /buildRequestVisibilityWhere/)
  })

  it('keeps attachment mutation write guards in addition to read authorization', () => {
    const source = read('src/server-actions/files.ts')
    assert.match(source, /canUserViewRequest/)
    assert.match(source, /isUploader/)
    assert.match(source, /isRequester/)
    assert.match(source, /isEngineeringUser/)
  })
})

describe('private attachment download route wiring', () => {
  const source = read('src/app/api/files/download/route.ts')

  it('requires an id query parameter validated as a UUID', () => {
    assert.match(source, /searchParams\.get\(['"]id['"]\)/)
    assert.match(source, /z\.string\(\)\.uuid\(\)|\.uuid\(\)/)
  })

  it('loads the attachment from file_attachments including its request linkage', () => {
    assert.match(source, /file_attachments/)
    assert.match(source, /requestId/)
    assert.match(source, /solution:\s*\{\s*select:\s*\{\s*requestId:\s*true/)
  })

  it('authorizes through canUserViewRequest from scope.ts before reading the file', () => {
    assert.match(source, /canUserViewRequest/)
    assert.match(source, /from ['"]@\/lib\/request-visibility\/scope['"]/)
    assert.doesNotMatch(source, /from ['"]@\/lib\/request-access['"]/)
  })

  it('reads physical bytes through readAttachmentFile', () => {
    assert.match(source, /readAttachmentFile/)
  })

  it('returns the original DB filename via buildContentDisposition', () => {
    assert.match(source, /\.fileName/)
    assert.match(source, /buildContentDisposition/)
  })

  it('no longer accepts a raw path query or touches public/', () => {
    assert.doesNotMatch(source, /searchParams\.get\(['"]path['"]\)/)
    assert.doesNotMatch(source, /join\(process\.cwd\(\),\s*['"]public/)
  })
})

describe('production findActor — users + active assignment + A5 sharing + managed descendants', () => {
  it('Pat/Alice/Bob sharing scopes match A5; manager descendants are independent of sharing', async () => {
    const db = createRequestVisibilityDb(specPrisma())
    const pat = await db.findActor('pat')
    const alice = await db.findActor('alice')
    const bob = await db.findActor('bob')
    const manager = await db.findActor('ops-manager')
    assert.ok(pat && alice && bob && manager)
    assert.equal(pat.assignmentUnitId, 'operations')
    assert.deepEqual([...pat.sharingScopeUnitIds].sort(), [...sharingScopeUnitIds(specUnits, 'operations')].sort())
    assert.deepEqual([...alice.sharingScopeUnitIds].sort(), [...sharingScopeUnitIds(specUnits, 'section-a')].sort())
    assert.equal(alice.sharingScopeUnitIds.includes('section-b'), false)
    assert.deepEqual(bob.sharingScopeUnitIds, ['section-b'])
    assert.equal(manager.assignmentUnitId, 'section-a')
    assert.equal(manager.sharingScopeUnitIds.includes('section-b'), false)
    assert.deepEqual([...manager.managedUnitIds].sort(), [...descendantUnitIds(specUnits, 'operations')].sort())
    assert.equal(manager.managedUnitIds.includes('section-b'), true)
  })

  it('engineering role is not blanket visibility; missing/inactive actors fail closed', async () => {
    const db = createRequestVisibilityDb(specPrisma())
    const eng = await db.findActor('eng-outsider')
    assert.ok(eng)
    assert.equal(eng.role, 'engineering')
    assert.equal(eng.assignmentUnitId, null)
    assert.deepEqual(eng.sharingScopeUnitIds, [])
    assert.deepEqual(eng.managedUnitIds, [])
    assert.equal(await db.findActor('missing'), null)
    const inactive = await db.findActor('inactive-pat')
    assert.ok(inactive)
    assert.equal(inactive.isActive, false)
    const empty = await buildRequestVisibilityWhere(db, { userId: 'inactive-pat', includeArchived: true })
    assert.deepEqual(empty, { id: { in: [] } })
    const engWhere = await buildRequestVisibilityWhere(db, { userId: 'eng-outsider', includeArchived: true })
    const adminWhere = await buildRequestVisibilityWhere(db, { userId: 'admin', includeArchived: true })
    assert.deepEqual(adminWhere, { isDeleted: false })
    assert.notDeepEqual(engWhere, adminWhere)
  })

  it('visibility grants no mutation and production findActor does not use department-type or position-assignment blankets', () => {
    const source = read('src/lib/request-visibility/scope.ts')
    assert.match(source, /export function createRequestVisibilityDb/)
    assert.match(source, /export async function canUserViewRequest/)
    assert.match(source, /organization_assignments/)
    assert.match(source, /sharingScopeUnitIds/)
    assert.match(source, /managerUserId/)
    assert.match(source, /descendantUnitIds/)
    assert.doesNotMatch(source, /departmentType/)
    assert.doesNotMatch(source, /organization_position_assignments/)
    assert.doesNotMatch(source, /OrganizationPositionCode/)
    assert.doesNotMatch(source, /actor\.role === 'engineering'/)
    assert.doesNotMatch(source, /from '@\/lib\/request-visibility\/predicate'/)
    assert.doesNotMatch(source, /from 'prisma\/prisma-client'/)
    assert.doesNotMatch(source, /import prisma from '@\/lib\/prisma'/)
    assert.doesNotMatch(source, /\.(create|update|delete|upsert)\s*\(/)
  })

  it('inactive assignment is ignored; only the active assignment unit feeds A5', async () => {
    const db = createRequestVisibilityDb(fakeVisibilityPrisma({
      users: [{ id: 'pat', isActive: true, role: 'general' }],
      assignments: [
        { userId: 'pat', unitId: 'section-b', isActive: false },
        { userId: 'pat', unitId: 'operations', isActive: true },
      ],
    }))
    const pat = await db.findActor('pat') as RequestVisibilityActor
    assert.equal(pat.assignmentUnitId, 'operations')
    assert.deepEqual([...pat.sharingScopeUnitIds].sort(), [...sharingScopeUnitIds(specUnits, 'operations')].sort())
  })
})

describe('legacy visibility files are gone after caller rewiring', () => {
  it('does not leave predicate.ts, types.ts, or request-access.ts as live modules', () => {
    for (const path of [
      'src/lib/request-visibility/predicate.ts',
      'src/lib/request-visibility/types.ts',
      'src/lib/request-access.ts',
    ]) {
      assert.throws(() => read(path), /ENOENT/, `${path} must be deleted once src importers are gone`)
    }
  })
})
