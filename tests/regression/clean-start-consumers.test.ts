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
import { generateJSONExport, type RequestSnapshot } from '@/lib/export'
import {
  authorizeUnitUsersQuery,
  listActiveUnitSubtreeUsers,
  type UnitUsersQueryDb,
} from '@/lib/unit-users'

const read = (path: string) => readFileSync(path, 'utf8')

function sliceBetween(path: string, start: string, end: string): string {
  const source = read(path)
  const startAt = source.indexOf(start)
  const endAt = source.indexOf(end, startAt + 1)
  assert.ok(startAt >= 0, `${path} missing ${start}`)
  assert.ok(endAt > startAt, `${path} missing ${end} after ${start}`)
  return source.slice(startAt, endAt)
}

const GREP_ALLOWLIST = [] as const

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
      assert.equal(hits.includes(path), true)
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

describe('request filter options are organization units', () => {
  it('returns active organization_units ids that descendantUnitIds can consume', () => {
    const filterOptions = sliceBetween(
      'src/server-actions/requests.ts',
      'export async function getRequestFilterOptions',
      'export async function getMyActionItems',
    )
    assert.match(filterOptions, /prisma\.organization_units\.findMany/)
    assert.match(filterOptions, /isActive:\s*true/)
    assert.match(filterOptions, /id:\s*true/)
    assert.match(filterOptions, /name:\s*true/)
    assert.doesNotMatch(filterOptions, /prisma\.departments/)

    const myRequests = sliceBetween(
      'src/server-actions/requests.ts',
      'export async function getMyRequests',
      'export async function getRequest',
    )
    assert.match(myRequests, /descendantUnitIds\(units, filters\.unitId\)/)

    const dashboardTabs = read('src/components/dashboard/dashboard-tabs.tsx')
    assert.match(dashboardTabs, /getRequestFilterOptions\(\)/)
  })
})

describe('budget unitId path uses organization units', () => {
  it('selects organizationUnit / budget_codes.unitId instead of Prisma department.id', () => {
    const monitor = sliceBetween(
      'src/server-actions/budget-control.ts',
      'export async function getBudgetMonitorData',
      'export async function assignRequestToBudgetCode',
    )
    assert.match(monitor, /prisma\.organization_units\.findMany/)
    assert.match(monitor, /organizationUnit:\s*\{\s*select:\s*\{\s*id:\s*true,\s*name:\s*true/)
    assert.doesNotMatch(monitor, /prisma\.departments/)
    assert.doesNotMatch(monitor, /department:\s*\{\s*select:\s*\{\s*id:\s*true,\s*name:\s*true/)

    const helpers = sliceBetween(
      'src/server-actions/budget-control.ts',
      'function mapBudgetCodeSummary',
      'function getVisibleBudgetCodes',
    )
    assert.match(helpers, /budgetCode\.organizationUnit/)
    assert.match(helpers, /request\.organizationUnit/)
    assert.doesNotMatch(helpers, /budgetCode\.department \?/)
    assert.doesNotMatch(helpers, /request\.department \?/)

    const writes = sliceBetween(
      'src/server-actions/budget-control.ts',
      'export async function assignRequestToBudgetCode',
      'export async function exportBudgetMonitorXlsx',
    )
    assert.match(writes, /unitId:\s*data\.unitId/)
    assert.doesNotMatch(writes, /departmentId:\s*data\.unitId/)
  })
})

describe('leftover Prisma department.id consumers rebase onto organizationUnit', () => {
  it('maps dashboard pending/created/all-request rows from organizationUnit', () => {
    const source = read('src/server-actions/dashboard.ts')
    assert.match(source, /organizationUnit:\s*\{\s*select:\s*\{\s*id:\s*true,\s*name:\s*true/)
    assert.doesNotMatch(source, /department:\s*\{\s*select:\s*\{\s*id:\s*true,\s*name:\s*true/)
    assert.match(source, /department:\s*approval\.request\.organizationUnit/)
    assert.match(source, /department:\s*request\.organizationUnit/)
    assert.match(source, /department:\s*req\.organizationUnit/)
  })

  it('maps engineering action-list rows from organizationUnit', () => {
    const source = sliceBetween(
      'src/server-actions/requests.ts',
      'export async function getRequestsNeedingEngineeringAction',
      'export async function assignEngineers',
    )
    assert.match(source, /organizationUnit:\s*\{\s*select:\s*\{\s*id:\s*true,\s*name:\s*true/)
    assert.doesNotMatch(source, /department:\s*\{\s*select:\s*\{\s*id:\s*true,\s*name:\s*true/)
    assert.match(source, /department:\s*request\.organizationUnit/)
  })

  it('exports audit JSON unitPathNames through unitPathNames() on organization unit ids', () => {
    const exportSource = read('src/lib/export.ts')
    assert.match(exportSource, /unitPathNames\(units, request\.organizationUnitId\)/)
    assert.doesNotMatch(exportSource, /request\.department \? \[request\.department\.name\]/)

    const requestRoute = read('src/app/api/audit/export/request/[requestId]/route.ts')
    const rangeRoute = read('src/app/api/audit/export/date-range/route.ts')
    for (const source of [requestRoute, rangeRoute]) {
      assert.match(source, /organizationUnit:/)
      assert.match(source, /generateJSONExport\([^\n]+,\s*units/)
      assert.doesNotMatch(source, /department:\s*\{\s*select:\s*\{\s*id:\s*true,\s*name:\s*true/)
    }

    const json = generateJSONExport(
      [{
        id: 'r1',
        title: 'Pump',
        organizationUnitId: 'section-a',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        status: 'Completed',
        requester: { id: 'u1', name: 'Ada', email: 'ada@example.com' },
        approvals: [],
        fileAttachments: [],
        activities: [],
      } as unknown as RequestSnapshot],
      specUnits,
    )
    const parsed = JSON.parse(json)
    assert.equal(parsed[0].organizationUnitId, 'section-a')
    assert.deepEqual(parsed[0].unitPathNames, ['Section A', 'Operations', 'Company'])
  })

  it('maps reports packet request department from organizationUnit', () => {
    const source = read('src/server-actions/reports.ts')
    assert.match(source, /organizationUnit:\s*\{\s*select:\s*\{\s*id:\s*true,\s*name:\s*true/)
    assert.doesNotMatch(
      sliceBetween(
        'src/server-actions/reports.ts',
        'async function getExportableRequest',
        'type ExportableRequest',
      ),
      /department:\s*\{\s*select:\s*\{\s*id:\s*true,\s*name:\s*true/,
    )
    assert.match(source, /request\.organizationUnit\?\.name/)
  })

  it('maps users/profile cache department from organization assignment, not Prisma department', () => {
    const cache = read('src/lib/cache/user-cache.ts')
    assert.match(cache, /organizationAssignments/)
    assert.doesNotMatch(cache, /include:\s*\{\s*department:\s*true/)

    const getUsers = sliceBetween(
      'src/server-actions/users.ts',
      'export async function getUsers',
      'export async function getUser',
    )
    assert.doesNotMatch(getUsers, /department:\s*true/)
    assert.match(getUsers, /organizationAssignment/)

    const getUser = sliceBetween(
      'src/server-actions/users.ts',
      'export async function getUser',
      'export async function createUser',
    )
    assert.doesNotMatch(getUser, /department:\s*true/)

    const profile = sliceBetween(
      'src/server-actions/users.ts',
      'export async function getCurrentUserProfile',
      'export async function updateOwnDisplayName',
    )
    assert.match(profile, /organizationAssignments/)
    assert.doesNotMatch(profile, /department:\s*\{\s*select:/)
  })
})

describe('name-only department.name joins rebase onto organizationUnit', () => {
  it('groups analytics breakdown and speed charts by organizationUnit name', () => {
    const breakdown = sliceBetween(
      'src/server-actions/analytics.ts',
      'async function fetchDepartmentData',
      'async function fetchTimeMetrics',
    )
    assert.match(breakdown, /organizationUnit:\s*\{\s*select:\s*\{\s*name:\s*true/)
    assert.match(breakdown, /req\.organizationUnit\?\.name/)
    assert.doesNotMatch(breakdown, /department:\s*\{\s*select:\s*\{\s*name:\s*true/)

    const speeds = sliceBetween(
      'src/server-actions/analytics.ts',
      'async function fetchDepartmentSpeeds',
      'function calculateTrends',
    )
    assert.match(speeds, /organizationUnit:\s*\{\s*select:\s*\{\s*name:\s*true/)
    assert.match(speeds, /req\.organizationUnit\?\.name/)
    assert.doesNotMatch(speeds, /department:\s*\{\s*select:\s*\{\s*name:\s*true/)
  })

  it('loads notification and stale-sub-task names from organizationUnit', () => {
    const notifications = read('src/server-actions/notifications.ts')
    assert.match(notifications, /organizationUnit:\s*\{\s*select:\s*\{\s*name:\s*true/)
    assert.match(notifications, /request\.organizationUnit\?\.name/)
    assert.doesNotMatch(notifications, /department:\s*\{\s*select:\s*\{\s*name:\s*true/)

    const stale = read('src/server-actions/engineering-sub-tasks.ts')
    const staleStart = stale.indexOf('export async function getStaleSubTaskRequests')
    assert.ok(staleStart >= 0)
    const staleBody = stale.slice(staleStart)
    assert.match(staleBody, /organizationUnit:\s*\{\s*select:\s*\{\s*name:\s*true/)
    assert.doesNotMatch(staleBody, /department:\s*\{\s*select:\s*\{\s*name:\s*true/)
  })
})
