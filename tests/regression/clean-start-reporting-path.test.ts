// Clean-start reporting path — option A, owner-confirmed (Plan A Task 6).
// In-memory fake repository only: NO Prisma, NO database. Pins the structural
// path contract (kinds/order/metadata/dedupe/null gates/fail-closed
// validation) and the parent A6 rulings R-A6-1/R-A6-2; it deliberately does
// NOT assert approval authority or candidate eligibility (Plan B Task 3/4).
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { loadUserOrganizationContext, resolveReportingPath } from '@/lib/organization/reporting-path'
import type { ReportingPathRepository } from '@/lib/organization/reporting-path'
import { OrganizationValidationError } from '@/lib/organization/assignments'
import type { AssignmentNode, OrganizationUnitNode, PositionNode, TeamNode } from '@/lib/organization/model'

const units: OrganizationUnitNode[] = [
  { id: 'company', name: 'Company', parentId: null, isActive: true, shareRequests: true, canWorkOnSolutions: false, managerUserId: 'u-root' },
  { id: 'eng', name: 'Engineering', parentId: 'company', isActive: true, shareRequests: false, canWorkOnSolutions: true, managerUserId: 'u-engmgr' },
  { id: 'web', name: 'Web', parentId: 'eng', isActive: true, shareRequests: false, canWorkOnSolutions: false, managerUserId: 'u-webmgr' },
]
const positions: PositionNode[] = [
  { id: 'p-staff', name: 'Staff', rank: 1, isActive: true },
  { id: 'p-lead', name: 'Lead', rank: 2, isActive: true },
  { id: 'p-mgr', name: 'Manager', rank: 3, isActive: true },
]
const assignments: AssignmentNode[] = [
  { id: 'a-root', userId: 'u-root', unitId: 'company', positionId: 'p-mgr', teamId: null, isActive: true },
  { id: 'a-engmgr', userId: 'u-engmgr', unitId: 'eng', positionId: 'p-mgr', teamId: null, isActive: true },
  { id: 'a-webmgr', userId: 'u-webmgr', unitId: 'web', positionId: 'p-mgr', teamId: null, isActive: true },
  { id: 'a-lead', userId: 'u-lead', unitId: 'web', positionId: 'p-lead', teamId: null, isActive: true },
  { id: 'a-ung', userId: 'u-ung', unitId: 'web', positionId: 'p-staff', teamId: null, isActive: true },
  { id: 'a-team', userId: 'u-team', unitId: 'web', positionId: 'p-staff', teamId: 't-web', isActive: true },
  { id: 'a-sib2', userId: 'u-sib2', unitId: 'web', positionId: 'p-staff', teamId: 't-other', isActive: true },
]
// u-lead oversees BOTH flat teams (spec: one person may oversee multiple
// teams without additional assignments); t-other members are sibling-team
// coworkers of t-web members and must never enter t-web members' paths.
const teams: TeamNode[] = [
  { id: 't-web', unitId: 'web', name: 'Web Crew', reportsToAssignmentId: 'a-lead', isActive: true },
  { id: 't-other', unitId: 'web', name: 'Other Crew', reportsToAssignmentId: 'a-lead', isActive: true },
]

function makeDb(over: Partial<ReportingPathRepository> = {}): ReportingPathRepository {
  return {
    findUser: async (userId: string) => ({ id: userId, isActive: true }),
    loadUnits: async () => units,
    loadPositions: async () => positions,
    loadAssignments: async () => assignments,
    loadTeams: async () => teams,
    ...over,
  }
}

describe('reporting path — option A', () => {
  it('team member: reports-to, then own-unit manager (different person), then ancestors — full pinned metadata', async () => {
    const path = await resolveReportingPath('u-team', makeDb())
    assert.ok(path)
    assert.deepEqual(path, {
      originUserId: 'u-team',
      assignmentId: 'a-team',
      unitId: 'web',
      positionId: 'p-staff',
      teamId: 't-web',
      unitPath: ['web', 'eng', 'company'],
      steps: [
        { kind: 'TEAM_REPORTS_TO', unitId: 'web', assignmentId: 'a-lead', userId: 'u-lead', positionId: 'p-lead' },
        { kind: 'UNIT_MANAGER', unitId: 'web', assignmentId: 'a-webmgr', userId: 'u-webmgr', positionId: 'p-mgr' },
        { kind: 'UNIT_MANAGER', unitId: 'eng', assignmentId: 'a-engmgr', userId: 'u-engmgr', positionId: 'p-mgr' },
        { kind: 'UNIT_MANAGER', unitId: 'company', assignmentId: 'a-root', userId: 'u-root', positionId: 'p-mgr' },
      ],
    })
    assert.equal(new Set(path.steps.map((step) => step.userId)).size, path.steps.length)
  })

  it('ungrouped: manager chain only — no coworkers, no team people', async () => {
    const path = await resolveReportingPath('u-ung', makeDb())
    assert.ok(path)
    assert.equal(path.teamId, null)
    assert.deepEqual(path.unitPath, ['web', 'eng', 'company'])
    assert.deepEqual(path.steps.map((step) => step.userId), ['u-webmgr', 'u-engmgr', 'u-root'])
    assert.ok(path.steps.every((step) => step.kind === 'UNIT_MANAGER'))
    for (const coworker of ['u-lead', 'u-team', 'u-sib2', 'u-ung']) {
      assert.equal(path.steps.some((step) => step.userId === coworker), false, `${coworker} must not appear`)
    }
  })

  it('deduplicates by userId preserving the first kind when reports-to IS the unit manager', async () => {
    const sameManagerTeams = teams.map((team) => team.id === 't-web' ? { ...team, reportsToAssignmentId: 'a-webmgr' } : team)
    const path = await resolveReportingPath('u-team', makeDb({ loadTeams: async () => sameManagerTeams }))
    assert.ok(path)
    assert.deepEqual(path.steps.map((step) => step.userId), ['u-webmgr', 'u-engmgr', 'u-root'])
    assert.equal(path.steps[0].kind, 'TEAM_REPORTS_TO')
    assert.equal(path.steps[0].assignmentId, 'a-webmgr')
  })

  it('own-team exact-position members are NOT path steps (they enter Plan B Task 3 candidate selection)', async () => {
    const seniorMemberAssignments = [...assignments, { id: 'a-senior', userId: 'u-senior', unitId: 'web', positionId: 'p-lead', teamId: 't-web', isActive: true }]
    const overseenByManagerTeams = teams.map((team) => team.id === 't-web' ? { ...team, reportsToAssignmentId: 'a-webmgr' } : team)
    const path = await resolveReportingPath('u-team', makeDb({
      loadAssignments: async () => seniorMemberAssignments,
      loadTeams: async () => overseenByManagerTeams,
    }))
    assert.ok(path)
    assert.deepEqual(path.steps.map((step) => step.userId), ['u-webmgr', 'u-engmgr', 'u-root'])
    assert.equal(path.steps.some((step) => step.userId === 'u-senior'), false)
  })

  it('never includes the origin: root-manager origin yields an empty chain; unit-manager origin skips self', async () => {
    const rootPath = await resolveReportingPath('u-root', makeDb())
    assert.ok(rootPath)
    assert.deepEqual(rootPath.unitPath, ['company'])
    assert.deepEqual(rootPath.steps, [])
    const managerPath = await resolveReportingPath('u-webmgr', makeDb())
    assert.ok(managerPath)
    assert.deepEqual(managerPath.steps.map((step) => step.userId), ['u-engmgr', 'u-root'])
    assert.equal(managerPath.steps.some((step) => step.userId === 'u-webmgr'), false)
    const leadPath = await resolveReportingPath('u-lead', makeDb())
    assert.ok(leadPath)
    assert.deepEqual(leadPath.steps.map((step) => step.userId), ['u-webmgr', 'u-engmgr', 'u-root'])
  })

  it('returns null for missing, inactive, and unassigned users', async () => {
    assert.equal(await resolveReportingPath('u-nobody', makeDb({ findUser: async () => null })), null)
    assert.equal(await resolveReportingPath('u-gone', makeDb({ findUser: async (userId) => ({ id: userId, isActive: false }) })), null)
    assert.equal(await resolveReportingPath('u-free', makeDb()), null)
  })

  it('origin gates short-circuit before organization load and validation (documented precedence)', async () => {
    const corruptUnits = [...units, { ...units[0] }]
    let loadUnitsCalls = 0
    let loadAssignmentsCalls = 0
    const db: ReportingPathRepository = {
      findUser: async () => null,
      loadUnits: async () => { loadUnitsCalls += 1; return corruptUnits },
      loadPositions: async () => positions,
      loadAssignments: async () => { loadAssignmentsCalls += 1; return assignments },
      loadTeams: async () => teams,
    }
    assert.equal(await resolveReportingPath('u-nobody', db), null)
    assert.equal(loadUnitsCalls, 0)
    assert.equal(loadAssignmentsCalls, 0)
  })

  it('fail-closed: corrupt unit tree throws the raw hierarchy error (duplicate ids, cycles)', async () => {
    const duplicateUnits = [...units, { ...units[0] }]
    await assert.rejects(resolveReportingPath('u-team', makeDb({ loadUnits: async () => duplicateUnits })), /duplicate organization unit id/i)
    const cyclicUnits: OrganizationUnitNode[] = [
      units[0],
      { ...units[1], parentId: 'web' },
      { ...units[2], parentId: 'eng' },
    ]
    await assert.rejects(resolveReportingPath('u-team', makeDb({ loadUnits: async () => cyclicUnits })), /cycle/i)
  })

  it('fail-closed: assignment and team rule violations throw OrganizationValidationError', async () => {
    const duplicateActive = [...assignments, { id: 'a-ung2', userId: 'u-ung', unitId: 'web', positionId: 'p-lead', teamId: null, isActive: true }]
    await assert.rejects(resolveReportingPath('u-team', makeDb({ loadAssignments: async () => duplicateActive })), (error: unknown) => {
      assert.ok(error instanceof OrganizationValidationError)
      assert.equal(error.code, 'ORGANIZATION_INVALID')
      assert.match(error.message, /one active/i)
      return true
    })
    const retiredLeadAssignments = [...assignments, { id: 'a-gone-lead', userId: 'u-gone-lead', unitId: 'web', positionId: 'p-mgr', teamId: null, isActive: false }]
    const retiredReportsToTeams = teams.map((team) => team.id === 't-web' ? { ...team, reportsToAssignmentId: 'a-gone-lead' } : team)
    await assert.rejects(resolveReportingPath('u-team', makeDb({
      loadAssignments: async () => retiredLeadAssignments,
      loadTeams: async () => retiredReportsToTeams,
    })), (error: unknown) => {
      assert.ok(error instanceof OrganizationValidationError)
      assert.equal(error.code, 'ORGANIZATION_INVALID')
      assert.match(error.message, /inactive/)
      return true
    })
  })

  it('valid active assigned origins validate the whole organization before any path is returned', async () => {
    const cyclicUnits: OrganizationUnitNode[] = [
      units[0],
      { ...units[1], parentId: 'web' },
      { ...units[2], parentId: 'eng' },
    ]
    await assert.rejects(resolveReportingPath('u-team', makeDb({ loadUnits: async () => cyclicUnits })), /cycle/i)
  })

  it('unassigned active origin: corruption surfaces rather than masking as unassigned (documented precedence)', async () => {
    const cyclicUnits: OrganizationUnitNode[] = [
      units[0],
      { ...units[1], parentId: 'web' },
      { ...units[2], parentId: 'eng' },
    ]
    await assert.rejects(resolveReportingPath('u-free', makeDb({ loadUnits: async () => cyclicUnits })), /cycle/i)
  })

  it('R-A6-1: inactive ancestors stay in unitPath, contribute no step, and never borrow a live assignment from another unit', async () => {
    const staleManagerUnits: OrganizationUnitNode[] = [
      units[0],
      { ...units[1], isActive: false, managerUserId: 'u-engmgr' },
      units[2],
    ]
    // u-engmgr's only ACTIVE assignment is now directly in company (p-staff):
    // the stale eng reference must not be resolved through it.
    const movedManagerAssignments: AssignmentNode[] = [
      assignments[0],
      { id: 'a-engmgr', userId: 'u-engmgr', unitId: 'company', positionId: 'p-staff', teamId: null, isActive: true },
      ...assignments.slice(2),
    ]
    const db = makeDb({
      loadUnits: async () => staleManagerUnits,
      loadAssignments: async () => movedManagerAssignments,
    })
    const teamPath = await resolveReportingPath('u-team', db)
    assert.ok(teamPath)
    assert.deepEqual(teamPath.unitPath, ['web', 'eng', 'company'])
    assert.deepEqual(teamPath.steps.map((step) => step.userId), ['u-lead', 'u-webmgr', 'u-root'])
    assert.equal(teamPath.steps.some((step) => step.userId === 'u-engmgr'), false)
    assert.equal(teamPath.steps.some((step) => step.unitId === 'eng'), false)
    const ungroupedPath = await resolveReportingPath('u-ung', db)
    assert.ok(ungroupedPath)
    assert.deepEqual(ungroupedPath.steps.map((step) => step.userId), ['u-webmgr', 'u-root'])
  })

  it('active unit with a null manager contributes no step; the walk continues', async () => {
    const vacantEngUnits = units.map((unit) => unit.id === 'eng' ? { ...unit, managerUserId: null } : unit)
    const path = await resolveReportingPath('u-ung', makeDb({ loadUnits: async () => vacantEngUnits }))
    assert.ok(path)
    assert.deepEqual(path.steps.map((step) => step.userId), ['u-webmgr', 'u-root'])
  })

  it('loadUserOrganizationContext: null parity with resolveReportingPath and non-null shape', async () => {
    assert.equal(await loadUserOrganizationContext('u-nobody', makeDb({ findUser: async () => null })), null)
    assert.equal(await loadUserOrganizationContext('u-gone', makeDb({ findUser: async (userId) => ({ id: userId, isActive: false }) })), null)
    assert.equal(await loadUserOrganizationContext('u-free', makeDb()), null)
    const context = await loadUserOrganizationContext('u-team', makeDb())
    assert.ok(context)
    assert.equal(context.userId, 'u-team')
    assert.deepEqual(context.path, await resolveReportingPath('u-team', makeDb()))
  })

  it('R-A6-2: no findUser fan-out — the origin activity gate is the only account lookup', async () => {
    const findUserCalls: string[] = []
    const db: ReportingPathRepository = {
      findUser: async (userId: string) => { findUserCalls.push(userId); return { id: userId, isActive: true } },
      loadUnits: async () => units,
      loadPositions: async () => positions,
      loadAssignments: async () => assignments,
      loadTeams: async () => teams,
    }
    await resolveReportingPath('u-team', db)
    assert.deepEqual(findUserCalls, ['u-team'])
  })

  it('never mutates repository data', async () => {
    const snapshot = JSON.stringify({ units, positions, assignments, teams })
    await resolveReportingPath('u-team', makeDb())
    await resolveReportingPath('u-ung', makeDb())
    assert.deepEqual(JSON.parse(JSON.stringify({ units, positions, assignments, teams })), JSON.parse(snapshot))
  })
})
