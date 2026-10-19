// Clean-start downward-inclusive sharing visibility predicate (Plan B Task 8).
// In-memory fake actors only: NO Prisma runtime, NO database, NO env, NO server.
// Visibility grants no mutation. The engineering ROLE is not blanket access.
// Child sharing settings never subtract from an ancestor member's complete
// subtree (A5 sharingScopeUnitIds). Explicit parent managers retain descendant
// visibility independently via managedUnitIds.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import type { Prisma } from '@prisma/client'
import { sharingScopeUnitIds, visibleRequestOriginUnitIds } from '@/lib/organization/sharing'
import { descendantUnitIds } from '@/lib/organization/hierarchy'
import type { OrganizationUnitNode } from '@/lib/organization/model'
import {
  buildRequestVisibilityWhere,
  canViewRequestByPredicate,
  type RequestVisibilityActor,
  type RequestVisibilityDb,
} from '@/lib/request-visibility/scope'

const u = (id: string, parentId: string | null, over: Partial<OrganizationUnitNode> = {}): OrganizationUnitNode =>
  ({ id, name: id, parentId, isActive: true, shareRequests: false, canWorkOnSolutions: false, managerUserId: null, ...over })

// Spec example: Operations sharing-enabled contains separately sharing-enabled
// Sections A and B; Pat assigned to Operations sees both; Alice in A sees A;
// Bob in B sees B. Child sharing never removes descendants from an ancestor.
const specUnits = [
  u('company', null, { shareRequests: true }),
  u('operations', 'company', { shareRequests: true }),
  u('section-a', 'operations', { shareRequests: true }),
  u('section-a-child', 'section-a'),
  u('section-b', 'operations', { shareRequests: true }),
]

type VisibilityApproval = {
  approverId: string | null
  requiredApproverId: string | null
  candidateGroup: { members: Array<{ userId: string }> } | null
  instanceId: string | null
  instance: { supersededAt: Date | null } | null
}

type VisibilityRequest = {
  id: string
  isDeleted: boolean
  isArchived: boolean
  requesterId: string
  organizationUnitId: string | null
  approvals: VisibilityApproval[]
  solutions: Array<{ approvals: VisibilityApproval[] }>
}

function matchesVisibilityWhere(row: unknown, where: unknown): boolean {
  if (where == null || typeof where !== 'object') return false
  const clause = where as Record<string, unknown>
  const record = row as Record<string, unknown>
  for (const [key, value] of Object.entries(clause)) {
    if (key === 'AND') {
      if (!Array.isArray(value) || !value.every((part) => matchesVisibilityWhere(row, part))) return false
      continue
    }
    if (key === 'OR') {
      if (!Array.isArray(value) || !value.some((part) => matchesVisibilityWhere(row, part))) return false
      continue
    }
    if (key === 'NOT') {
      if (matchesVisibilityWhere(row, value)) return false
      continue
    }
    const current = record[key]
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      const ops = value as Record<string, unknown>
      if ('in' in ops) {
        const list = ops.in
        if (!Array.isArray(list) || !list.some((item) => item === current)) return false
        continue
      }
      if ('equals' in ops) {
        if (current !== ops.equals) return false
        continue
      }
      if ('some' in ops) {
        if (!Array.isArray(current) || !current.some((item) => matchesVisibilityWhere(item, ops.some))) return false
        continue
      }
      if (current == null || !matchesVisibilityWhere(current, value)) return false
      continue
    }
    if (current !== value) return false
  }
  return true
}

function actor(over: Partial<RequestVisibilityActor> & Pick<RequestVisibilityActor, 'id'>): RequestVisibilityActor {
  return {
    role: 'general_dept',
    isActive: true,
    assignmentUnitId: null,
    sharingScopeUnitIds: [],
    managedUnitIds: [],
    canWorkOnSolutions: false,
    ...over,
  }
}

function approval(over: Partial<VisibilityApproval> = {}): VisibilityApproval {
  return {
    approverId: null,
    requiredApproverId: null,
    candidateGroup: { members: [] },
    instanceId: null,
    instance: { supersededAt: null },
    ...over,
  }
}

function request(over: Partial<VisibilityRequest> & Pick<VisibilityRequest, 'id'>): VisibilityRequest {
  return {
    isDeleted: false,
    isArchived: false,
    requesterId: 'other',
    organizationUnitId: null,
    approvals: [],
    solutions: [],
    ...over,
  }
}

function fakeScopeDb(): RequestVisibilityDb {
  const actors: Record<string, RequestVisibilityActor> = {
    pat: actor({
      id: 'pat',
      assignmentUnitId: 'operations',
      sharingScopeUnitIds: visibleRequestOriginUnitIds(specUnits, 'operations'),
    }),
    alice: actor({
      id: 'alice',
      assignmentUnitId: 'section-a',
      sharingScopeUnitIds: visibleRequestOriginUnitIds(specUnits, 'section-a'),
    }),
    bob: actor({
      id: 'bob',
      assignmentUnitId: 'section-b',
      sharingScopeUnitIds: visibleRequestOriginUnitIds(specUnits, 'section-b'),
    }),
    'ops-manager': actor({
      id: 'ops-manager',
      assignmentUnitId: 'section-a',
      sharingScopeUnitIds: visibleRequestOriginUnitIds(specUnits, 'section-a'),
      managedUnitIds: descendantUnitIds(specUnits, 'operations'),
    }),
    'eng-outsider': actor({
      id: 'eng-outsider',
      role: 'engineering',
      assignmentUnitId: null,
    }),
    admin: actor({ id: 'admin', role: 'admin' }),
    'inactive-admin': actor({ id: 'inactive-admin', role: 'admin', isActive: false }),
    'inactive-pat': actor({
      id: 'inactive-pat',
      isActive: false,
      assignmentUnitId: 'operations',
      sharingScopeUnitIds: visibleRequestOriginUnitIds(specUnits, 'operations'),
    }),
  }

  const requests: VisibilityRequest[] = [
    request({ id: 'req-a', organizationUnitId: 'section-a' }),
    request({ id: 'req-b', organizationUnitId: 'section-b' }),
    request({ id: 'req-a-child', organizationUnitId: 'section-a-child' }),
    request({ id: 'req-a-archived', organizationUnitId: 'section-a', isArchived: true }),
    request({ id: 'req-a-deleted', organizationUnitId: 'section-a', isDeleted: true }),
    request({ id: 'req-eng-own', requesterId: 'eng-outsider', organizationUnitId: 'section-b' }),
    request({
      id: 'req-eng-approver',
      organizationUnitId: 'section-a',
      approvals: [approval({ approverId: 'eng-outsider' })],
    }),
    request({
      id: 'req-eng-required',
      organizationUnitId: 'section-a',
      approvals: [approval({ requiredApproverId: 'eng-outsider' })],
    }),
    request({
      id: 'req-eng-candidate',
      organizationUnitId: 'section-a',
      approvals: [approval({ candidateGroup: { members: [{ userId: 'eng-outsider' }] } })],
    }),
    request({
      id: 'req-eng-solution',
      organizationUnitId: 'section-a',
      solutions: [{ approvals: [approval({ approverId: 'eng-outsider' })] }],
    }),
    request({
      id: 'req-eng-superseded',
      organizationUnitId: 'section-a',
      approvals: [approval({
        approverId: 'eng-outsider',
        instanceId: 'inst-old',
        instance: { supersededAt: new Date('2026-01-01T00:00:00.000Z') },
      })],
    }),
  ]

  return {
    async findActor(userId) {
      return actors[userId] ?? null
    },
    async findRequest(where: Prisma.requestsWhereInput) {
      const found = requests.find((row) => matchesVisibilityWhere(row, where))
      return found ? { id: found.id } : null
    },
  }
}

async function listed(db: RequestVisibilityDb, userId: string, requestId: string): Promise<boolean> {
  const where = await buildRequestVisibilityWhere(db, { userId, includeArchived: false })
  const found = await db.findRequest({ AND: [{ id: requestId }, where] })
  return found !== null
}

describe('sharing-scope visibility — spec matrix (Pat/Alice/Bob)', () => {
  it("Pat in Operations sees Section A and B requests even though each section shares separately", async () => {
    const db = fakeScopeDb()
    assert.deepEqual(
      [...sharingScopeUnitIds(specUnits, 'operations')].sort(),
      ['operations', 'section-a', 'section-a-child', 'section-b'].sort(),
    )
    assert.equal(await canViewRequestByPredicate(db, 'pat', 'req-a'), true)
    assert.equal(await canViewRequestByPredicate(db, 'pat', 'req-b'), true)
    assert.equal(await canViewRequestByPredicate(db, 'pat', 'req-a-child'), true)
  })

  it('Alice in Section A sees A and sibling Section B when sharing is ON', async () => {
    const db = fakeScopeDb()
    assert.equal(visibleRequestOriginUnitIds(specUnits, 'section-a').includes('section-b'), true)
    assert.equal(await canViewRequestByPredicate(db, 'alice', 'req-a'), true)
    assert.equal(await canViewRequestByPredicate(db, 'alice', 'req-a-child'), true)
    assert.equal(await canViewRequestByPredicate(db, 'alice', 'req-b'), true)
  })

  it('Bob in Section B sees B and sibling Section A when sharing is ON', async () => {
    const db = fakeScopeDb()
    assert.equal(visibleRequestOriginUnitIds(specUnits, 'section-b').includes('section-a'), true)
    assert.equal(await canViewRequestByPredicate(db, 'bob', 'req-b'), true)
    assert.equal(await canViewRequestByPredicate(db, 'bob', 'req-a'), true)
  })
})

describe('unit manager descendant visibility outside sharing scope', () => {
  it('sees descendant-unit requests outside the actor sharing scope via managedUnitIds', async () => {
    const db = fakeScopeDb()
    const aliceScope = sharingScopeUnitIds(specUnits, 'section-a')
    assert.equal(aliceScope.includes('section-b'), false)
    assert.equal(visibleRequestOriginUnitIds(specUnits, 'section-a').includes('section-b'), true)
    assert.equal(descendantUnitIds(specUnits, 'operations').includes('section-b'), true)
    assert.equal(await canViewRequestByPredicate(db, 'alice', 'req-b'), true)
    assert.equal(await canViewRequestByPredicate(db, 'ops-manager', 'req-b'), true)
    assert.equal(await canViewRequestByPredicate(db, 'ops-manager', 'req-a'), true)
  })
})

describe('engineering role is not blanket visibility', () => {
  it('without overlap sees nothing beyond relationships', async () => {
    const db = fakeScopeDb()
    assert.equal(await canViewRequestByPredicate(db, 'eng-outsider', 'req-a'), false)
    assert.equal(await canViewRequestByPredicate(db, 'eng-outsider', 'req-b'), false)
    assert.equal(await canViewRequestByPredicate(db, 'eng-outsider', 'req-a-child'), false)
    assert.equal(await canViewRequestByPredicate(db, 'eng-outsider', 'req-eng-own'), true)
    assert.equal(await canViewRequestByPredicate(db, 'eng-outsider', 'req-eng-approver'), true)
    assert.equal(await canViewRequestByPredicate(db, 'eng-outsider', 'req-eng-required'), true)
    assert.equal(await canViewRequestByPredicate(db, 'eng-outsider', 'req-eng-candidate'), true)
    assert.equal(await canViewRequestByPredicate(db, 'eng-outsider', 'req-eng-solution'), true)
    assert.equal(await canViewRequestByPredicate(db, 'eng-outsider', 'req-eng-superseded'), false)
  })

  it('admin sees non-deleted requests; engineering where is not the admin base', async () => {
    const db = fakeScopeDb()
    const adminWhere = await buildRequestVisibilityWhere(db, { userId: 'admin', includeArchived: true })
    const engWhere = await buildRequestVisibilityWhere(db, { userId: 'eng-outsider', includeArchived: true })
    assert.deepEqual(adminWhere, { isDeleted: false })
    assert.notDeepEqual(engWhere, adminWhere)
    assert.equal(await canViewRequestByPredicate(db, 'admin', 'req-a'), true)
    assert.equal(await canViewRequestByPredicate(db, 'admin', 'req-b'), true)
  })
})

describe('fail closed, archive list filter, soft-delete', () => {
  it('missing or inactive actor yields empty visibility', async () => {
    const db = fakeScopeDb()
    assert.deepEqual(await buildRequestVisibilityWhere(db, { userId: 'missing', includeArchived: true }), { id: { in: [] } })
    assert.deepEqual(await buildRequestVisibilityWhere(db, { userId: 'inactive-pat', includeArchived: true }), { id: { in: [] } })
    assert.deepEqual(await buildRequestVisibilityWhere(db, { userId: 'inactive-admin', includeArchived: true }), { id: { in: [] } })
    assert.equal(await canViewRequestByPredicate(db, 'missing', 'req-a'), false)
    assert.equal(await canViewRequestByPredicate(db, 'inactive-pat', 'req-a'), false)
    assert.equal(await canViewRequestByPredicate(db, 'inactive-admin', 'req-a'), false)
  })

  it('includeArchived true still finds archived; archive is a list filter', async () => {
    const db = fakeScopeDb()
    const listWhere = await buildRequestVisibilityWhere(db, { userId: 'pat', includeArchived: false })
    const detailWhere = await buildRequestVisibilityWhere(db, { userId: 'pat', includeArchived: true })
    assert.match(JSON.stringify(listWhere), /"isArchived":false/)
    assert.doesNotMatch(JSON.stringify(detailWhere), /isArchived/)
    assert.equal(await listed(db, 'pat', 'req-a-archived'), false)
    assert.equal(await canViewRequestByPredicate(db, 'pat', 'req-a-archived'), true)
    assert.equal(await listed(db, 'alice', 'req-a-archived'), false)
    assert.equal(await canViewRequestByPredicate(db, 'alice', 'req-a-archived'), true)
    assert.equal(await canViewRequestByPredicate(db, 'bob', 'req-a-archived'), true)
  })

  it('soft-deleted is never visible, including to admin with includeArchived true', async () => {
    const db = fakeScopeDb()
    assert.equal(await canViewRequestByPredicate(db, 'pat', 'req-a-deleted'), false)
    assert.equal(await canViewRequestByPredicate(db, 'admin', 'req-a-deleted'), false)
    assert.equal(await listed(db, 'admin', 'req-a-deleted'), false)
  })
})

describe('B8 source contract', () => {
  it('exports the exact APIs, type-only Prisma, no mutation, no engineering blanket', () => {
    const source = readFileSync('src/lib/request-visibility/scope.ts', 'utf8')
    assert.match(source, /export interface RequestVisibilityActor/)
    assert.match(source, /export interface RequestVisibilityDb/)
    assert.match(source, /export async function buildRequestVisibilityWhere/)
    assert.match(source, /export async function canViewRequestByPredicate/)
    assert.match(source, /sharingScopeUnitIds/)
    assert.match(source, /managedUnitIds/)
    assert.match(source, /assignmentUnitId/)
    assert.match(source, /CURRENT_INSTANCE_ROW_FILTER/)
    assert.match(source, /import type \{ Prisma/)
    assert.doesNotMatch(source, /import \{[^}]*Prisma[^}]*\} from '@prisma\/client'/)
    assert.doesNotMatch(source, /from 'prisma\/prisma-client'/)
    assert.doesNotMatch(source, /prisma\.(requests|user|\$)/)
    assert.doesNotMatch(source, /\.(create|update|delete|upsert)\s*\(/)
    assert.doesNotMatch(source, /actor\.role === 'engineering'/)
    assert.doesNotMatch(source, /departmentType/)
    assert.doesNotMatch(source, /from '@\/lib\/request-visibility\/predicate'/)
  })
})
