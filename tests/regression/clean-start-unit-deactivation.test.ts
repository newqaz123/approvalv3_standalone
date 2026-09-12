// Clean-start unit deactivation (post-C10 follow-up, owner-approved).
// deactivateOrganizationUnit: deactivate-not-delete semantics with typed
// refusals naming offenders. Component harness: renderToStaticMarkup (sibling
// UI pattern: tests/regression/clean-start-ui-unit-panel.test.ts).
// Action tests: in-memory fake OrganizationUnitDeactivationDb only.
// NO Prisma, NO database, NO env, NO schema/server ops.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { AssignmentNode, OrganizationUnitNode, PositionNode, TeamNode } from '@/lib/organization/model'
import { OrganizationValidationError } from '@/lib/organization/assignments'
import {
  deactivateOrganizationUnit,
  type OrganizationUnitDeactivationDb,
  type WorkspaceSnapshot,
} from '@/server-actions/organization'
import { UnitSidePanel, UnitDeactivationSection } from '@/components/organization/UnitSidePanel'
import { OrganizationWorkspace } from '@/components/organization/OrganizationWorkspace'

const read = (path: string) => readFileSync(path, 'utf8')

function unit(
  id: string,
  name: string,
  parentId: string | null,
  extra: Partial<OrganizationUnitNode> = {},
): OrganizationUnitNode {
  return {
    id,
    name,
    parentId,
    isActive: true,
    shareRequests: false,
    canWorkOnSolutions: false,
    managerUserId: null,
    ...extra,
  }
}

function assignment(
  id: string,
  userId: string,
  unitId: string,
  extra: Partial<AssignmentNode> = {},
): AssignmentNode {
  return {
    id,
    userId,
    unitId,
    positionId: 'p-staff',
    teamId: null,
    isActive: true,
    ...extra,
  }
}

function team(
  id: string,
  unitId: string,
  name: string,
  reportsToAssignmentId: string,
  extra: Partial<TeamNode> = {},
): TeamNode {
  return { id, unitId, name, reportsToAssignmentId, isActive: true, ...extra }
}

interface RouteVersionFixture {
  id: string
  scopeUnitId: string
  phase: string
  status: string
}

function makeDeactivationDb(over: {
  units?: OrganizationUnitNode[]
  teams?: TeamNode[]
  assignments?: AssignmentNode[]
  positions?: PositionNode[]
  users?: WorkspaceSnapshot['users'][number][]
  routeVersions?: RouteVersionFixture[]
} = {}) {
  const units = (over.units ?? [
    unit('company', 'Company', null, { shareRequests: true }),
    unit('ops', 'Operations', 'company', { shareRequests: true }),
    unit('section-a', 'Section A', 'ops', { shareRequests: true }),
    unit('section-b', 'Section B', 'ops'),
  ]).map((row) => ({ ...row }))
  const teams = (over.teams ?? []).map((row) => ({ ...row }))
  const positions = (over.positions ?? [
    { id: 'p-staff', name: 'Staff', rank: 1, isActive: true },
    { id: 'p-manager', name: 'Manager', rank: 3, isActive: true },
  ]).map((row) => ({ ...row }))
  const assignments = (over.assignments ?? [
    assignment('asg-pat', 'pat', 'ops', { positionId: 'p-manager' }),
    assignment('asg-alice', 'alice', 'section-a'),
  ]).map((row) => ({ ...row }))
  const users = (over.users ?? [
    { id: 'pat', name: 'Pat', email: 'pat@example.com', role: 'general_dept', isActive: true },
    { id: 'alice', name: 'Alice', email: 'alice@example.com', role: 'general_dept', isActive: true },
    { id: 'riley', name: 'Riley', email: 'riley@example.com', role: 'general_dept', isActive: true },
  ]).map((row) => ({ ...row }))
  const routeVersions = (over.routeVersions ?? []).map((row) => ({ ...row }))
  const audits: Array<{ action: string; comments: string }> = []
  const revalidated: string[] = []
  let exclusive = Promise.resolve()
  const db: OrganizationUnitDeactivationDb & {
    units: OrganizationUnitNode[]
    teams: TeamNode[]
    assignments: AssignmentNode[]
    positions: PositionNode[]
    users: WorkspaceSnapshot['users'][number][]
    routeVersions: RouteVersionFixture[]
    audits: Array<{ action: string; comments: string }>
    revalidated: string[]
  } = {
    adminUserId: 'admin-1',
    units,
    teams,
    assignments,
    positions,
    users,
    routeVersions,
    audits,
    revalidated,
    async loadUnits() {
      return units.map((row) => ({ ...row }))
    },
    async loadTeams() {
      return teams.map((row) => ({ ...row }))
    },
    async loadAssignments() {
      return assignments.map((row) => ({ ...row }))
    },
    async loadPositions() {
      return positions.map((row) => ({ ...row }))
    },
    async loadUsers() {
      return users.map((row) => ({ ...row }))
    },
    async loadRouteVersionsForUnit(unitId) {
      return routeVersions
        .filter((row) => row.scopeUnitId === unitId)
        .map((row) => ({ ...row }))
    },
    async deactivateUnit(id) {
      const row = units.find((candidate) => candidate.id === id)
      if (!row) throw new Error(`missing unit ${id}`)
      row.isActive = false
    },
    async updateUnitName() {
      throw new Error('updateUnitName not used by unit deactivation')
    },
    async updateTeamName() {
      throw new Error('updateTeamName not used by unit deactivation')
    },
    async writeAudit(entry) {
      audits.push({ ...entry })
    },
    async revalidateOrganization() {
      revalidated.push('/admin/organization')
    },
    async runSerializable(fn) {
      const run = exclusive.then(() => fn(db))
      exclusive = run.then(() => undefined, () => undefined)
      return run
    },
  }
  return db
}

const positions: PositionNode[] = [
  { id: 'p-staff', name: 'Staff', rank: 1, isActive: true },
  { id: 'p-manager', name: 'Manager', rank: 3, isActive: true },
]

function makeSnapshot(over: Partial<WorkspaceSnapshot> = {}): WorkspaceSnapshot {
  return {
    units: [
      unit('company', 'Company', null, { shareRequests: true }),
      unit('ops', 'Operations', 'company', { shareRequests: true }),
      unit('section-a', 'Section A', 'ops', { shareRequests: true }),
      unit('section-b', 'Section B', 'ops'),
    ],
    positions,
    assignments: [
      assignment('asg-pat', 'pat', 'ops', { positionId: 'p-manager' }),
      assignment('asg-alice', 'alice', 'section-a'),
    ],
    teams: [],
    users: [
      { id: 'pat', name: 'Pat', email: 'pat@example.com', role: 'general_dept', isActive: true },
      { id: 'alice', name: 'Alice', email: 'alice@example.com', role: 'general_dept', isActive: true },
    ],
    unassignedUsers: [],
    routeSources: [],
    customChainExceptions: [],
    readiness: { ready: true, blockers: [] },
    ...over,
  }
}

describe('deactivateOrganizationUnit fake db — refusals', () => {
  it('refuses the active company root matching /root/i and writes nothing', async () => {
    const db = makeDeactivationDb()
    await assert.rejects(
      () => deactivateOrganizationUnit({ unitId: 'company' }, db),
      (error: unknown) => {
        assert.equal(error instanceof OrganizationValidationError, true)
        assert.match(String(error), /root/i)
        assert.match(String(error), /Company/)
        return true
      },
    )
    assert.equal(db.units.find((row) => row.id === 'company')?.isActive, true)
    assert.equal(db.audits.length, 0)
    assert.deepEqual(db.revalidated, [])
  })

  it('refuses while active child units exist matching /child/i, naming each offender', async () => {
    const db = makeDeactivationDb({
      units: [
        unit('company', 'Company', null),
        unit('mid', 'Mid Unit', 'company'),
        unit('leaf-a', 'Leaf Alpha', 'mid'),
        unit('leaf-b', 'Leaf Beta', 'mid'),
        unit('other', 'Other', 'company'),
      ],
      assignments: [],
    })
    await assert.rejects(
      () => deactivateOrganizationUnit({ unitId: 'mid' }, db),
      (error: unknown) => {
        assert.equal(error instanceof OrganizationValidationError, true)
        assert.match(String(error), /child/i)
        assert.match(String(error), /Leaf Alpha/)
        assert.match(String(error), /Leaf Beta/)
        assert.doesNotMatch(String(error), /Other/)
        return true
      },
    )
    assert.equal(db.units.find((row) => row.id === 'mid')?.isActive, true)
    assert.equal(db.units.find((row) => row.id === 'leaf-a')?.isActive, true)
    assert.equal(db.audits.length, 0)
    assert.deepEqual(db.revalidated, [])
  })

  it('refuses while active assignments sit directly in the unit matching /assigned/i, naming the offender', async () => {
    const db = makeDeactivationDb({
      units: [
        unit('company', 'Company', null),
        unit('target', 'Target Unit', 'company'),
      ],
      assignments: [
        assignment('asg-riley', 'riley', 'target'),
        assignment('asg-pat', 'pat', 'company', { positionId: 'p-manager' }),
      ],
    })
    await assert.rejects(
      () => deactivateOrganizationUnit({ unitId: 'target' }, db),
      (error: unknown) => {
        assert.equal(error instanceof OrganizationValidationError, true)
        assert.match(String(error), /assigned/i)
        assert.match(String(error), /Riley/)
        assert.match(String(error), /asg-riley/)
        return true
      },
    )
    assert.equal(db.units.find((row) => row.id === 'target')?.isActive, true)
    assert.equal(db.assignments.find((row) => row.id === 'asg-riley')?.isActive, true)
    assert.equal(db.audits.length, 0)
    assert.deepEqual(db.revalidated, [])
  })

  it('refuses while active teams sit in the unit matching /team/i, naming the offender', async () => {
    // A valid active team implies an active reports-to assignment in the unit,
    // so this fixture models the fail-closed current state an admin must still
    // not be able to deactivate through: the reports-to assignment went
    // inactive while the team row is still active.
    const db = makeDeactivationDb({
      units: [
        unit('company', 'Company', null),
        unit('target', 'Target Unit', 'company'),
      ],
      assignments: [
        assignment('asg-riley', 'riley', 'target', { positionId: 'p-manager', isActive: false }),
      ],
      teams: [team('team-line', 'target', 'Line A', 'asg-riley')],
    })
    await assert.rejects(
      () => deactivateOrganizationUnit({ unitId: 'target' }, db),
      (error: unknown) => {
        assert.equal(error instanceof OrganizationValidationError, true)
        assert.match(String(error), /team/i)
        assert.match(String(error), /Line A/)
        assert.match(String(error), /team-line/)
        return true
      },
    )
    assert.equal(db.units.find((row) => row.id === 'target')?.isActive, true)
    assert.equal(db.audits.length, 0)
    assert.deepEqual(db.revalidated, [])
  })

  it('refuses while a DRAFT or PUBLISHED route version is scoped to the unit matching /route/i, naming the offender', async () => {
    const draftDb = makeDeactivationDb({
      units: [
        unit('company', 'Company', null),
        unit('target', 'Target Unit', 'company'),
      ],
      assignments: [],
      routeVersions: [
        { id: 'rv-target-draft', scopeUnitId: 'target', phase: 'REQUEST', status: 'DRAFT' },
        { id: 'rv-other', scopeUnitId: 'company', phase: 'REQUEST', status: 'PUBLISHED' },
      ],
    })
    await assert.rejects(
      () => deactivateOrganizationUnit({ unitId: 'target' }, draftDb),
      (error: unknown) => {
        assert.equal(error instanceof OrganizationValidationError, true)
        assert.match(String(error), /route/i)
        assert.match(String(error), /rv-target-draft/)
        assert.match(String(error), /DRAFT/)
        assert.doesNotMatch(String(error), /rv-other/)
        return true
      },
    )
    assert.equal(draftDb.units.find((row) => row.id === 'target')?.isActive, true)
    assert.equal(draftDb.audits.length, 0)
    assert.deepEqual(draftDb.revalidated, [])

    const publishedDb = makeDeactivationDb({
      units: [
        unit('company', 'Company', null),
        unit('target', 'Target Unit', 'company'),
      ],
      assignments: [],
      routeVersions: [
        { id: 'rv-target-published', scopeUnitId: 'target', phase: 'SOLUTION', status: 'PUBLISHED' },
      ],
    })
    await assert.rejects(
      () => deactivateOrganizationUnit({ unitId: 'target' }, publishedDb),
      (error: unknown) => {
        assert.equal(error instanceof OrganizationValidationError, true)
        assert.match(String(error), /route/i)
        assert.match(String(error), /rv-target-published/)
        assert.match(String(error), /PUBLISHED/)
        return true
      },
    )
    assert.equal(publishedDb.audits.length, 0)
  })

  it('rejects a missing unit and an already-inactive unit without writing', async () => {
    const db = makeDeactivationDb()
    await assert.rejects(
      () => deactivateOrganizationUnit({ unitId: 'nope' }, db),
      /not found/i,
    )
    const inactiveTarget = makeDeactivationDb({
      units: [
        unit('company', 'Company', null),
        unit('gone', 'Gone Unit', 'company', { isActive: false }),
      ],
      assignments: [],
    })
    await assert.rejects(
      () => deactivateOrganizationUnit({ unitId: 'gone' }, inactiveTarget),
      /not active/i,
    )
    assert.equal(db.audits.length, 0)
    assert.deepEqual(inactiveTarget.revalidated, [])
  })
})

describe('deactivateOrganizationUnit fake db — success', () => {
  it('deactivates a clean leaf, audits, revalidates, and keeps every other field as history', async () => {
    const db = makeDeactivationDb()
    const before = db.units.map((row) => ({ ...row }))
    const assignmentsBefore = db.assignments.map((row) => ({ ...row }))
    const result = await deactivateOrganizationUnit({ unitId: 'section-b' }, db)
    assert.deepEqual(result, { success: true })
    const after = db.units.find((row) => row.id === 'section-b')
    assert.equal(after?.isActive, false)
    // deactivate-not-delete: only isActive flips; name/parent/flags/manager
    // survive as history (requests.organizationUnitId stays a valid reference).
    assert.deepEqual(
      { ...after, isActive: true },
      before.find((row) => row.id === 'section-b'),
    )
    assert.deepEqual(db.assignments, assignmentsBefore)
    assert.equal(db.units.find((row) => row.id === 'section-a')?.isActive, true)
    assert.equal(db.units.find((row) => row.id === 'company')?.isActive, true)
    assert.equal(db.audits.length, 1)
    assert.equal(db.audits[0].action, 'organization_unit_deactivated')
    assert.match(db.audits[0].comments, /section-b/)
    assert.match(db.audits[0].comments, /Section B/)
    assert.deepEqual(db.revalidated, ['/admin/organization'])
  })

  it('keeps a manager reference on the deactivated unit as stale history (A3 exempts inactive units)', async () => {
    const db = makeDeactivationDb({
      units: [
        unit('company', 'Company', null),
        unit('target', 'Target Unit', 'company', { managerUserId: 'riley' }),
      ],
      assignments: [
        assignment('asg-riley', 'riley', 'company', { positionId: 'p-manager' }),
      ],
    })
    const result = await deactivateOrganizationUnit({ unitId: 'target' }, db)
    assert.deepEqual(result, { success: true })
    const after = db.units.find((row) => row.id === 'target')
    assert.equal(after?.isActive, false)
    assert.equal(after?.managerUserId, 'riley')
  })
})

describe('tree hides inactive units', () => {
  it('renders no row for an inactive unit the loader still returned, while active siblings stay', () => {
    const snapshot = makeSnapshot({
      units: [
        unit('company', 'Company', null, { shareRequests: true }),
        unit('ops', 'Operations', 'company', { shareRequests: true }),
        unit('section-a', 'Section A', 'ops', { shareRequests: true }),
        unit('section-b', 'Section B', 'ops', { isActive: false }),
      ],
    })
    const html = renderToStaticMarkup(createElement(OrganizationWorkspace, { snapshot }))
    assert.doesNotMatch(html, /data-testid="unit-row-section-b"/)
    assert.doesNotMatch(html, /data-testid="unit-header-section-b"/)
    assert.doesNotMatch(html, /Section B/)
    assert.match(html, /data-testid="unit-row-section-a"/)
    assert.match(html, /Section A/)
  })

  it('hides an inactive intermediate unit and never renders its subtree from it', () => {
    const snapshot = makeSnapshot({
      units: [
        unit('company', 'Company', null, { shareRequests: true }),
        unit('ops', 'Operations', 'company', { isActive: false }),
        unit('section-a', 'Section A', 'ops', { shareRequests: true }),
      ],
      assignments: [],
    })
    const html = renderToStaticMarkup(createElement(OrganizationWorkspace, { snapshot }))
    assert.doesNotMatch(html, /data-testid="unit-row-ops"/)
    // an active child of an inactive parent never renders through it
    assert.doesNotMatch(html, /data-testid="unit-row-section-a"/)
    assert.match(html, /data-testid="unit-row-company"/)
  })
})

describe('UnitSidePanel deactivation UI', () => {
  it('shows the danger Deactivate unit button in the panel without a confirmation initially', () => {
    const snapshot = makeSnapshot()
    const sectionA = snapshot.units.find((row) => row.id === 'section-a')
    assert.ok(sectionA)
    const html = renderToStaticMarkup(createElement(UnitSidePanel, {
      unit: sectionA,
      snapshot,
    }))
    assert.match(html, /data-testid="unit-deactivate"/)
    assert.match(html, /Deactivate unit/)
    assert.doesNotMatch(html, /data-testid="unit-deactivate-confirmation"/)
    assert.doesNotMatch(html, /data-testid="unit-deactivate-confirm"/)
  })

  it('confirmation step shows explanatory copy with confirm and cancel controls', () => {
    const html = renderToStaticMarkup(createElement(UnitDeactivationSection, {
      unitName: 'Section A',
      confirming: true,
      saving: false,
      error: null,
      onStart: () => {},
      onConfirm: () => {},
      onCancel: () => {},
    }))
    assert.match(html, /data-testid="unit-deactivate-confirmation"/)
    assert.match(html, /Section A/)
    assert.match(html, /history/i)
    assert.match(html, /data-testid="unit-deactivate-confirm"/)
    assert.match(html, /data-testid="unit-deactivate-cancel"/)
    // the reveal button itself is hidden while confirming
    assert.doesNotMatch(html, /data-testid="unit-deactivate"/)
  })

  it('guard errors render adjacent to the confirmation and the confirmation state is retained', () => {
    const html = renderToStaticMarkup(createElement(UnitDeactivationSection, {
      unitName: 'Operations',
      confirming: true,
      saving: false,
      error: 'Unit "Operations" has active child units: "Section A"; deactivate children first',
      onStart: () => {},
      onConfirm: () => {},
      onCancel: () => {},
    }))
    const errorAt = html.indexOf('data-testid="unit-deactivate-error"')
    const confirmAt = html.indexOf('data-testid="unit-deactivate-confirm"')
    assert.ok(errorAt >= 0, 'adjacent error element must exist')
    assert.ok(confirmAt > errorAt, 'error renders adjacent (before the confirm control)')
    assert.match(html, /role="alert"/)
    assert.match(html, /deactivate children first/)
    assert.match(html, /data-testid="unit-deactivate-cancel"/)
  })

  it('no error element renders before a save is attempted', () => {
    const html = renderToStaticMarkup(createElement(UnitDeactivationSection, {
      unitName: 'Section A',
      confirming: false,
      saving: false,
      error: null,
      onStart: () => {},
      onConfirm: () => {},
      onCancel: () => {},
    }))
    assert.doesNotMatch(html, /data-testid="unit-deactivate-error"/)
    assert.match(html, /data-testid="unit-deactivate"/)
  })
})

describe('unit deactivation source contracts', () => {
  it('exports the action with Serializable isolation, typed refusals, and validateOrganization before the write', () => {
    const actions = read('src/server-actions/organization.ts')
    assert.match(actions, /export async function deactivateOrganizationUnit/)
    assert.match(actions, /organization_unit_deactivated/)
    assert.match(actions, /isolationLevel: 'Serializable'/)
    const start = actions.indexOf('export async function deactivateOrganizationUnit')
    const body = actions.slice(start)
    assert.match(body, /validateOrganization/)
    const validateAt = body.indexOf('validateOrganization(')
    const writeAt = body.indexOf('deactivateUnit(')
    assert.ok(validateAt >= 0 && writeAt > validateAt, 'validateOrganization must run before the deactivate write')
    assert.match(actions, /revalidatePath\('\/admin\/organization'\)/)
    // never a destructive removal: no delete calls in the action body
    assert.doesNotMatch(body, /\.delete\(|deleteMany|\.delete\b/)
  })
})
