// Clean-start file access (Plan B Task 10).
// Attachment download is visibility of the parent request (B8 actor matrix).
// Upload/delete are visibility plus uploader / assignment-based engineering-phase
// rules. files.ts uses the Task 8 actor builder. Engineering ROLE is not
// solution-work eligibility or visibility.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import type { Prisma } from '@prisma/client'
import { sharingScopeUnitIds } from '@/lib/organization/sharing'
import type { OrganizationUnitNode } from '@/lib/organization/model'
import {
  canViewRequestByPredicate,
  type RequestVisibilityActor,
  type RequestVisibilityDb,
} from '@/lib/request-visibility/scope'

const read = (path: string) => readFileSync(path, 'utf8')

const u = (id: string, parentId: string | null, over: Partial<OrganizationUnitNode> = {}): OrganizationUnitNode =>
  ({ id, name: id, parentId, isActive: true, shareRequests: false, canWorkOnSolutions: false, managerUserId: null, ...over })

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
    }
    if (current !== value) return false
  }
  return true
}

function actor(
  id: string,
  assignmentUnitId: string | null,
  over: Partial<RequestVisibilityActor> = {},
): RequestVisibilityActor {
  const sharing = assignmentUnitId ? sharingScopeUnitIds(specUnits, assignmentUnitId) : []
  return {
    id,
    role: 'general_dept',
    isActive: true,
    assignmentUnitId,
    sharingScopeUnitIds: sharing,
    managedUnitIds: [],
    ...over,
  }
}

function fakeScopeDb(): RequestVisibilityDb {
  const actors: Record<string, RequestVisibilityActor> = {
    pat: actor('pat', 'operations'),
    alice: actor('alice', 'section-a'),
    bob: actor('bob', 'section-b'),
    'eng-outsider': actor('eng-outsider', null, { role: 'engineering' }),
    admin: actor('admin', 'operations', { role: 'admin' }),
  }
  const requests: VisibilityRequest[] = [
    {
      id: 'req-a',
      isDeleted: false,
      isArchived: false,
      requesterId: 'alice',
      organizationUnitId: 'section-a',
      approvals: [],
      solutions: [],
    },
    {
      id: 'req-b',
      isDeleted: false,
      isArchived: false,
      requesterId: 'bob',
      organizationUnitId: 'section-b',
      approvals: [],
      solutions: [],
    },
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

describe('attachment download follows the B8 visibility matrix', () => {
  it('allows download exactly when the parent request is visible', async () => {
    const db = fakeScopeDb()
    assert.equal(await canViewRequestByPredicate(db, 'pat', 'req-a'), true)
    assert.equal(await canViewRequestByPredicate(db, 'pat', 'req-b'), true)
    assert.equal(await canViewRequestByPredicate(db, 'alice', 'req-a'), true)
    assert.equal(await canViewRequestByPredicate(db, 'alice', 'req-b'), false)
    assert.equal(await canViewRequestByPredicate(db, 'bob', 'req-a'), false)
    assert.equal(await canViewRequestByPredicate(db, 'bob', 'req-b'), true)
    assert.equal(await canViewRequestByPredicate(db, 'eng-outsider', 'req-a'), false)
  })

  it('download route authorizes via canUserViewRequest of the parent request', () => {
    const source = read('src/app/api/files/download/route.ts')
    assert.match(source, /canUserViewRequest/)
    assert.match(source, /from ['"]@\/lib\/request-visibility\/scope['"]/)
    assert.doesNotMatch(source, /departmentType/)
    assert.doesNotMatch(source, /role === ['"]engineering['"]/)
  })
})

describe('files.ts mutation auth uses Task 8 actor + assignment-based engineering-phase', () => {
  it('replaces departmentType placeholders with the Task 8 actor builder', () => {
    const source = read('src/server-actions/files.ts')
    assert.match(source, /createRequestVisibilityDb/)
    assert.match(source, /findActor/)
    assert.match(source, /assignmentUnitId/)
    assert.match(source, /canSubmitSolutionWork|existing(Upload|Delete)AttachmentDecision/)
    assert.doesNotMatch(source, /departmentType/)
    assert.doesNotMatch(source, /role === ['"]engineering['"]/)
    assert.doesNotMatch(source, /isEngineeringUser/)
  })

  it('keeps visibility as a prerequisite and does not treat engineering ROLE as mutation', () => {
    const source = read('src/server-actions/files.ts')
    assert.match(source, /canUserViewRequest/)
    assert.match(source, /existingUploadAttachmentDecision/)
    assert.match(source, /existingDeleteAttachmentDecision/)
    assert.match(source, /evaluateRequestAction/)
    assert.doesNotMatch(source, /UserRole\.engineering/)
  })
})
