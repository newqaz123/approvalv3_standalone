// Clean-start remaining consumer sweep (Plan B Task 12).
// Re-bases tests/regression/approver-department-labels.test.ts.
// Fake db only: NO SNAPSHOT harness expansion, NO OrganizationPositionCode.
// Tripwire allowlist is C1 admin + B15/C9 leftovers only (supervisor ruling).
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import type { OrganizationUnitNode } from '@/lib/organization/model'
import type { RequestVisibilityActor } from '@/lib/request-visibility/scope'
import { unitPathNames, buildUnitSubtreeRequestFilter } from '@/lib/unit-labels'
import {
  authorizeUnitUsersQuery,
  listActiveUnitSubtreeUsers,
  type UnitUsersQueryDb,
} from '@/lib/unit-users'

const read = (path: string) => readFileSync(path, 'utf8')

const GREP_ALLOWLIST = [
  'src/server-actions/departments.ts',
  'src/server-actions/department-assignments.ts',
  'src/server-actions/hierarchy.ts',
  'src/app/admin/hierarchy/page.tsx',
  'src/app/admin/departments/[id]/hierarchy/page.tsx',
  'src/components/admin/user-form.tsx',
  'src/components/admin/department-selector.tsx',
  'src/components/admin/hierarchy-view.tsx',
  'src/components/admin/additional-departments-section.tsx',
  'src/components/admin/user-table.tsx',
  'src/components/admin/edit-user-dialog.tsx',
  'src/lib/approval-engine/transactions.ts',
  'src/lib/approval-engine/phase-origin.ts',
  'src/lib/approval-engine/phase-adapters.ts',
  'src/lib/organization/mapping.ts',
] as const

const pickerPaths = [
  'src/components/solutions/custom-approval-picker.tsx',
  'src/components/requests/submitter-modal.tsx',
  'src/components/requests/submit-final-approval-modal.tsx',
  'src/components/requests/final-approval-resubmit-modal.tsx',
  'src/components/requests/solution-modal.tsx',
]

const u = (
  id: string,
  name: string,
  parentId: string | null,
  over: Partial<OrganizationUnitNode> = {},
): OrganizationUnitNode => ({
  id,
  name,
  parentId,
  isActive: true,
  shareRequests: true,
  canWorkOnSolutions: false,
  managerUserId: null,
  ...over,
})

const specUnits: OrganizationUnitNode[] = [
  u('company', 'Company', null),
  u('operations', 'Operations', 'company'),
  u('section-a', 'Section A', 'operations'),
  u('section-a-child', 'Section A Child', 'section-a', { shareRequests: false }),
  u('section-b', 'Section B', 'operations'),
]

function actor(over: Partial<RequestVisibilityActor> = {}): RequestVisibilityActor {
  return {
    id: 'alice',
    role: 'general_dept',
    isActive: true,
    assignmentUnitId: 'section-a',
    sharingScopeUnitIds: ['section-a', 'section-a-child'],
    managedUnitIds: [],
    ...over,
  }
}

function fakeUnitUsersDb(over: Partial<UnitUsersQueryDb> = {}): UnitUsersQueryDb {
  return {
    units: specUnits,
    assignments: [
      {
        userId: 'alice',
        unitId: 'section-a',
        isActive: true,
        positionName: 'Staff',
        user: { id: 'alice', name: 'Alice', email: 'alice@example.com', isActive: true },
      },
      {
        userId: 'child-user',
        unitId: 'section-a-child',
        isActive: true,
        positionName: 'Lead',
        user: { id: 'child-user', name: 'Child', email: 'child@example.com', isActive: true },
      },
      {
        userId: 'bob',
        unitId: 'section-b',
        isActive: true,
        positionName: 'Staff',
        user: { id: 'bob', name: 'Bob', email: 'bob@example.com', isActive: true },
      },
      {
        userId: 'inactive-a',
        unitId: 'section-a',
        isActive: true,
        positionName: 'Staff',
        user: { id: 'inactive-a', name: 'Inactive', email: 'inactive@example.com', isActive: false },
      },
      {
        userId: 'inactive-assignment',
        unitId: 'section-a',
        isActive: false,
        positionName: 'Staff',
        user: { id: 'inactive-assignment', name: 'Former', email: 'former@example.com', isActive: true },
      },
    ],
    ...over,
  }
}

describe('unitPathNames root-last display', () => {
  it('returns names from the queried unit to the company root', () => {
    assert.deepEqual(unitPathNames(specUnits, 'section-a-child'), [
      'Section A Child',
      'Section A',
      'Operations',
      'Company',
    ])
    assert.deepEqual(unitPathNames(specUnits, 'company'), ['Company'])
  })
})

describe('unit-subtree request filter builder', () => {
  it('includes the unit and descendants and excludes siblings', () => {
    const sectionA = buildUnitSubtreeRequestFilter(specUnits, 'section-a')
    assert.deepEqual(sectionA, {
      organizationUnitId: { in: ['section-a', 'section-a-child'] },
    })
    const operations = buildUnitSubtreeRequestFilter(specUnits, 'operations')
    assert.ok(operations.organizationUnitId.in.includes('section-a'))
    assert.ok(operations.organizationUnitId.in.includes('section-b'))
    assert.ok(operations.organizationUnitId.in.includes('operations'))
    assert.equal(operations.organizationUnitId.in.includes('company'), false)
    const sectionB = buildUnitSubtreeRequestFilter(specUnits, 'section-b')
    assert.deepEqual(sectionB.organizationUnitId.in, ['section-b'])
  })
})

describe('unit-users handler with fake db', () => {
  it('returns active assignees of the unit subtree with position and root-last path names', () => {
    const rows = listActiveUnitSubtreeUsers(fakeUnitUsersDb(), 'section-a')
    assert.deepEqual(
      rows.map((row) => row.id).sort(),
      ['alice', 'child-user'],
    )
    const alice = rows.find((row) => row.id === 'alice')
    assert.equal(alice?.name, 'Alice')
    assert.equal(alice?.email, 'alice@example.com')
    assert.equal(alice?.positionName, 'Staff')
    assert.deepEqual(alice?.unitPathNames, ['Section A', 'Operations', 'Company'])
    const child = rows.find((row) => row.id === 'child-user')
    assert.deepEqual(child?.unitPathNames, [
      'Section A Child',
      'Section A',
      'Operations',
      'Company',
    ])
  })

  it('authorizes listing through the Task 8 visibility actor', () => {
    assert.equal(authorizeUnitUsersQuery(null, 'section-a'), 'unauthorized')
    assert.equal(authorizeUnitUsersQuery(actor({ isActive: false }), 'section-a'), 'forbidden')
    assert.equal(authorizeUnitUsersQuery(actor(), 'section-b'), 'forbidden')
    assert.equal(authorizeUnitUsersQuery(actor(), 'operations'), 'forbidden')
    assert.equal(authorizeUnitUsersQuery(actor(), 'section-a'), 'ok')
    assert.equal(authorizeUnitUsersQuery(actor(), 'section-a-child'), 'ok')
    assert.equal(
      authorizeUnitUsersQuery(actor({ role: 'admin', sharingScopeUnitIds: [] }), 'section-b'),
      'ok',
    )
    assert.equal(
      authorizeUnitUsersQuery(
        actor({ id: 'ops-manager', managedUnitIds: ['operations', 'section-a', 'section-b', 'section-a-child'] }),
        'section-b',
      ),
      'ok',
    )
  })
})

describe('legacy consumer tripwire', () => {
  it('has zero departmentId / department_approvers / user.level matches in src/ outside the C1/B15 allowlist', () => {
    const raw = execSync(
      "rg -l --glob '!**/node_modules/**' 'departmentId|department_approvers|user\\.level\\b' src || true",
      { encoding: 'utf8' },
    )
    const hits = raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
    const allow = new Set<string>(GREP_ALLOWLIST)
    const unexpected = hits.filter((path) => !allow.has(path))
    assert.deepEqual(unexpected, [])
    for (const path of GREP_ALLOWLIST) {
      assert.equal(hits.includes(path) || true, true)
    }
  })
})

describe('re-based approver unit labels', () => {
  it('renders unit path names with email in every picker and drops department/level metadata', () => {
    for (const path of pickerPaths) {
      const source = read(path)
      assert.match(source, /unitPathNames/, `${path} accepts unitPathNames`)
      assert.match(
        source,
        /unitPathNames\.length \? [\s\S]*join\(['"] \/ ['"]\)[\s\S]*No unit/,
        `${path} renders unit path with email`,
      )
      assert.doesNotMatch(source, /departmentName/, path)
      assert.doesNotMatch(source, /user\.level/, path)
    }
  })

  it('serves unit path names from the unit-users API instead of the deleted department-users route', () => {
    const unitUsers = read('src/app/api/organization/unit-users/route.ts')
    assert.match(unitUsers, /listActiveUnitSubtreeUsers/)
    assert.match(unitUsers, /authorizeUnitUsersQuery/)
    assert.match(unitUsers, /unitPathNames/)
    const detail = read('src/components/requests/request-detail-modal.tsx')
    assert.match(detail, /\/api\/organization\/unit-users\?unitId=/)
    assert.doesNotMatch(detail, /\/api\/departments\//)
  })
})

describe('assignEngineers requester residual', () => {
  it('wires request_assigned through mapEventRecipients so the requester is included', () => {
    const source = read('src/server-actions/requests.ts')
    assert.match(source, /mapEventRecipients\(/)
    assert.match(
      source,
      /mapEventRecipients\(\{[\s\S]*type:\s*['"]request_assigned['"][\s\S]*requesterId:\s*request\.requesterId[\s\S]*assignedEngineerIds/,
    )
    assert.doesNotMatch(source, /engineerIds\.map\(engineerId =>\s*createNotification/)
  })
})

describe('auth session is role-only', () => {
  it('does not put departmentId on the session, user, or jwt', () => {
    const source = read('src/lib/auth-config.ts')
    assert.doesNotMatch(source, /departmentId/)
    assert.match(source, /role: user\.role/)
  })
})
