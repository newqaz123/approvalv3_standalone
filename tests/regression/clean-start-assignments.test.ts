import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { OrganizationValidationError, validateOrganization } from '@/lib/organization/assignments'
import type { AssignmentNode, OrganizationUnitNode, PositionNode, TeamNode } from '@/lib/organization/model'

const units: OrganizationUnitNode[] = [
  { id: 'company', name: 'Company', parentId: null, isActive: true, shareRequests: true, canWorkOnSolutions: false, managerUserId: 'u-boss' },
  { id: 'eng', name: 'Engineering', parentId: 'company', isActive: true, shareRequests: false, canWorkOnSolutions: true, managerUserId: 'u-lead' },
]
const positions: PositionNode[] = [
  { id: 'p-staff', name: 'Staff', rank: 1, isActive: true },
  { id: 'p-lead', name: 'Team Lead', rank: 2, isActive: true },
  { id: 'p-mgr', name: 'Unit Manager', rank: 3, isActive: true },
]
const asg = (
  id: string,
  userId: string,
  unitId: string,
  positionId: string,
  teamId: string | null = null,
  over: Partial<AssignmentNode> = {},
): AssignmentNode => ({ id, userId, unitId, positionId, teamId, isActive: true, ...over })
const assignments: AssignmentNode[] = [
  asg('a-boss', 'u-boss', 'company', 'p-mgr'),
  asg('a-lead', 'u-lead', 'eng', 'p-mgr'),
  asg('a-m1', 'u-m1', 'eng', 'p-staff', 't-1'),
  asg('a-m2', 'u-m2', 'eng', 'p-staff', 't-1'),
]
const teams: TeamNode[] = [
  { id: 't-1', unitId: 'eng', name: 'Maintenance Crew', reportsToAssignmentId: 'a-lead', isActive: true },
]

/** Every rejection must be the typed OrganizationValidationError with ids in the message. */
function expectOrganizationError(fn: () => void, ...patterns: RegExp[]): void {
  try {
    fn()
  } catch (err) {
    assert.ok(
      err instanceof OrganizationValidationError,
      `expected OrganizationValidationError, got: ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`,
    )
    assert.equal(err.code, 'ORGANIZATION_INVALID')
    for (const pattern of patterns) {
      assert.ok(pattern.test(err.message), `expected message to match ${pattern}, got: ${err.message}`)
    }
    return
  }
  assert.fail('expected validateOrganization to throw, but it returned')
}

describe('clean-start assignments — valid organizations', () => {
  it('accepts a valid organization and returns undefined', () => {
    assert.equal(validateOrganization(units, positions, assignments, teams), undefined)
  })

  it('accepts one reports-to person overseeing multiple teams in the same unit without extra assignments', () => {
    const twoTeams = [...teams, { id: 't-2', unitId: 'eng', name: 'Night Crew', reportsToAssignmentId: 'a-lead', isActive: true }]
    validateOrganization(units, positions, assignments, twoTeams)
  })

  it('accepts an active unit without a selected manager', () => {
    const noManager = units.map((x) => (x.id === 'eng' ? { ...x, managerUserId: null } : x))
    validateOrganization(noManager, positions, assignments, teams)
  })

  it('tolerates history: a second INACTIVE assignment for the same user', () => {
    const withHistory = [...assignments, asg('a-m1-old', 'u-m1', 'company', 'p-staff', null, { isActive: false })]
    validateOrganization(units, positions, withHistory, teams)
  })

  it('tolerates history: an inactive assignment referencing a missing unit, position, and team', () => {
    const withHistory = [...assignments, asg('a-hist', 'u-hist', 'gone-unit', 'gone-pos', 'gone-team', { isActive: false })]
    validateOrganization(units, positions, withHistory, teams)
  })

  it('tolerates history: an inactive unit with a stale managerUserId', () => {
    const withLegacyUnit = [
      ...units,
      { id: 'legacy', name: 'Legacy', parentId: 'company', isActive: false, shareRequests: false, canWorkOnSolutions: false, managerUserId: 'u-ancient' },
    ]
    validateOrganization(withLegacyUnit, positions, assignments, teams)
  })

  it('tolerates history: an inactive team with an inactive reports-to assignment', () => {
    const withRetired = [...assignments, asg('a-retired', 'u-retired', 'eng', 'p-lead', null, { isActive: false })]
    const withOldTeam = [...teams, { id: 't-old', unitId: 'eng', name: 'Old Crew', reportsToAssignmentId: 'a-retired', isActive: false }]
    validateOrganization(units, positions, withRetired, withOldTeam)
  })

  it('tolerates history: an inactive assignment referencing a deactivated team', () => {
    const withHistory = [...assignments, asg('a-h2', 'u-h2', 'eng', 'p-staff', 't-1', { isActive: false })]
    validateOrganization(units, positions, withHistory, teams)
  })

  it('tolerates the same team name in another unit and when the other team is inactive', () => {
    const otherUnitTeam = [...teams, { id: 't-9', unitId: 'company', name: 'Maintenance Crew', reportsToAssignmentId: 'a-boss', isActive: true }]
    validateOrganization(units, positions, assignments, otherUnitTeam)
    const inactiveDuplicate = [...teams, { id: 't-1b', unitId: 'eng', name: 'Maintenance Crew', reportsToAssignmentId: 'a-lead', isActive: false }]
    validateOrganization(units, positions, assignments, inactiveDuplicate)
  })

  it('compares reports-to rank against ACTIVE members only', () => {
    // a-m3 is an inactive member holding p-mgr (rank 3), equal to the reports-to
    // rank — inactive members must not affect the strictly-above comparison.
    const withInactiveSenior = [...assignments, asg('a-m3', 'u-m3', 'eng', 'p-mgr', 't-1', { isActive: false })]
    validateOrganization(units, positions, withInactiveSenior, teams)
  })

  it('does not mutate its inputs', () => {
    const before = { units, positions, assignments, teams }
    const snapshot = JSON.parse(JSON.stringify(before))
    validateOrganization(units, positions, assignments, teams)
    assert.deepEqual({ units, positions, assignments, teams }, snapshot)
  })
})

describe('rule 1 — exactly one active assignment per user', () => {
  it('rejects a second active assignment for one user, naming the user and both assignments', () => {
    const doubled = [...assignments, asg('a-m1b', 'u-m1', 'company', 'p-staff')]
    expectOrganizationError(
      () => validateOrganization(units, positions, doubled, teams),
      /one active/i,
      /"u-m1"/,
      /"a-m1"/,
      /"a-m1b"/,
    )
  })
})

describe('rule 2 — active assignments reference existing active units and positions', () => {
  it('rejects an active assignment in a missing unit', () => {
    const bad = [...assignments, asg('a-x', 'u-x', 'ghost-unit', 'p-staff')]
    expectOrganizationError(() => validateOrganization(units, positions, bad, teams), /missing unit/i, /"a-x"/, /"ghost-unit"/)
  })

  it('rejects an active assignment in an inactive unit', () => {
    const withInactiveUnit = [
      ...units,
      { id: 'legacy', name: 'Legacy', parentId: 'company', isActive: false, shareRequests: false, canWorkOnSolutions: false, managerUserId: null },
    ]
    const bad = [...assignments, asg('a-x', 'u-x', 'legacy', 'p-staff')]
    expectOrganizationError(() => validateOrganization(withInactiveUnit, positions, bad, teams), /inactive unit/i, /"a-x"/, /"legacy"/)
  })

  it('rejects an active assignment with a missing position', () => {
    const bad = [...assignments, asg('a-x', 'u-x', 'eng', 'ghost-pos')]
    expectOrganizationError(() => validateOrganization(units, positions, bad, teams), /missing position/i, /"a-x"/, /"ghost-pos"/)
  })

  it('rejects an active assignment with an inactive position', () => {
    const withOldPosition = [...positions, { id: 'p-old', name: 'Old', rank: 2, isActive: false }]
    const bad = [...assignments, asg('a-x', 'u-x', 'eng', 'p-old')]
    expectOrganizationError(() => validateOrganization(units, withOldPosition, bad, teams), /inactive position/i, /"a-x"/, /"p-old"/)
  })
})

describe('rule 3 — unit managers are active direct assignments of the managed unit', () => {
  it('rejects a manager actively assigned to a different unit, naming both units and the manager assignment', () => {
    const remoteManager = units.map((x) => (x.id === 'eng' ? { ...x, managerUserId: 'u-boss' } : x))
    expectOrganizationError(
      () => validateOrganization(remoteManager, positions, assignments, teams),
      /manager/i,
      /"eng"/,
      /"u-boss"/,
      /"a-boss"/,
      /"company"/,
    )
  })

  it('rejects a manager with only an inactive assignment in the managed unit', () => {
    const retiredManagerUnits = units.map((x) => (x.id === 'eng' ? { ...x, managerUserId: 'u-old' } : x))
    const withRetired = [...assignments, asg('a-old', 'u-old', 'eng', 'p-staff', null, { isActive: false })]
    expectOrganizationError(
      () => validateOrganization(retiredManagerUnits, positions, withRetired, teams),
      /manager/i,
      /"eng"/,
      /"u-old"/,
    )
  })

  it('rejects a manager with no assignment at all', () => {
    const phantomManagerUnits = units.map((x) => (x.id === 'eng' ? { ...x, managerUserId: 'u-ghost' } : x))
    expectOrganizationError(
      () => validateOrganization(phantomManagerUnits, positions, assignments, teams),
      /manager/i,
      /"eng"/,
      /"u-ghost"/,
    )
  })
})

describe('rule 4 — an active team reports to an active assignment in the same unit', () => {
  it('rejects a reports-to referencing a missing assignment', () => {
    const bad = [{ ...teams[0], reportsToAssignmentId: 'a-ghost' }]
    expectOrganizationError(() => validateOrganization(units, positions, assignments, bad), /missing assignment/i, /"t-1"/, /"a-ghost"/)
  })

  it('rejects an inactive reports-to assignment', () => {
    const withRetired = [...assignments, asg('a-ret', 'u-ret', 'eng', 'p-lead', null, { isActive: false })]
    const bad = [{ ...teams[0], reportsToAssignmentId: 'a-ret' }]
    expectOrganizationError(() => validateOrganization(units, positions, withRetired, bad), /inactive/i, /"t-1"/, /"a-ret"/)
  })

  it('rejects a reports-to actively assigned to a different unit', () => {
    const bad = [{ ...teams[0], reportsToAssignmentId: 'a-boss' }]
    expectOrganizationError(
      () => validateOrganization(units, positions, assignments, bad),
      /unit/i,
      /"t-1"/,
      /"a-boss"/,
      /"eng"/,
      /"company"/,
    )
  })

  it('rejects an active team anchored to a missing unit through its reports-to rule', () => {
    const bad = [...teams, { id: 't-ghost', unitId: 'ghost-unit', name: 'Ghost Crew', reportsToAssignmentId: 'a-lead', isActive: true }]
    expectOrganizationError(
      () => validateOrganization(units, positions, assignments, bad),
      /unit/i,
      /"t-ghost"/,
      /"a-lead"/,
      /"ghost-unit"/,
    )
  })
})

describe('rule 5 — reports-to is outside the membership and strictly above every active member', () => {
  it('rejects an equal-rank reports-to outside the membership (R10 copy: rank and strictly above)', () => {
    const equalRankCrew = [
      ...assignments,
      asg('a-equal', 'u-equal', 'eng', 'p-staff'),
      asg('a-r1', 'u-r1', 'eng', 'p-staff', 't-rank'),
    ]
    const bad = [{ id: 't-rank', unitId: 'eng', name: 'Rank Crew', reportsToAssignmentId: 'a-equal', isActive: true }]
    expectOrganizationError(
      () => validateOrganization(units, positions, equalRankCrew, bad),
      /rank/i,
      /strictly above/i,
      /"t-rank"/,
      /"a-equal"/,
    )
  })

  it('rejects a reports-to ranked below one active member — every active member counts', () => {
    const mixedCrew = [...assignments, asg('a-hi', 'u-hi', 'eng', 'p-lead', 't-mix')]
    const bad = [{ id: 't-mix', unitId: 'eng', name: 'Mix Crew', reportsToAssignmentId: 'a-low', isActive: true }]
    const withLow = [...mixedCrew, asg('a-low', 'u-low', 'eng', 'p-staff')]
    expectOrganizationError(
      () => validateOrganization(units, positions, withLow, bad),
      /strictly above/i,
      /rank/i,
      /"t-mix"/,
      /"a-low"/,
      /"a-hi"/,
    )
  })

  it('rejects a reports-to that is itself an active member of the team (self-membership)', () => {
    // The plan sample fixture: reportsToAssignmentId a-m1, which is a member of t-1.
    const bad = [{ ...teams[0], reportsToAssignmentId: 'a-m1' }]
    expectOrganizationError(
      () => validateOrganization(units, positions, assignments, bad),
      /member/i,
      /rank/i,
      /strictly above/i,
      /"t-1"/,
      /"a-m1"/,
    )
  })
})

describe('rule 6 — active team membership stays within the member’s own unit', () => {
  it('rejects cross-unit membership, naming the member assignment and the team', () => {
    const crossUnitMember = assignments.map((a) => (a.id === 'a-m2' ? { ...a, unitId: 'company' } : a))
    expectOrganizationError(
      () => validateOrganization(units, positions, crossUnitMember, teams),
      /team/i,
      /"a-m2"/,
      /"t-1"/,
      /"company"/,
      /"eng"/,
    )
  })

  it('rejects an active membership referencing a missing team', () => {
    const orphan = assignments.map((a) => (a.id === 'a-m2' ? { ...a, teamId: 't-missing' } : a))
    expectOrganizationError(() => validateOrganization(units, positions, orphan, teams), /missing team/i, /"a-m2"/, /"t-missing"/)
  })

  it('rejects an active membership referencing an inactive team', () => {
    const deactivated = teams.map((t) => (t.id === 't-1' ? { ...t, isActive: false } : t))
    expectOrganizationError(
      () => validateOrganization(units, positions, assignments, deactivated),
      /inactive team/i,
      /"a-m1"/,
      /"t-1"/,
    )
  })
})

describe('rule 7 — duplicate active team names within one unit', () => {
  it('rejects duplicate active team names in one unit, naming unit, name, and both teams', () => {
    const dup = [...teams, { id: 't-2', unitId: 'eng', name: 'Maintenance Crew', reportsToAssignmentId: 'a-lead', isActive: true }]
    expectOrganizationError(
      () => validateOrganization(units, positions, assignments, dup),
      /duplicate team/i,
      /"eng"/,
      /Maintenance Crew/,
      /"t-1"/,
      /"t-2"/,
    )
  })
})

describe('rule 8 — global tree failures are wrapped as OrganizationValidationError', () => {
  it('wraps more-than-one-active-root', () => {
    const twoRoots: OrganizationUnitNode[] = [
      { id: 'r1', name: 'R1', parentId: null, isActive: true, shareRequests: true, canWorkOnSolutions: false, managerUserId: null },
      { id: 'r2', name: 'R2', parentId: null, isActive: true, shareRequests: false, canWorkOnSolutions: false, managerUserId: null },
    ]
    expectOrganizationError(() => validateOrganization(twoRoots, positions, assignments, teams), /more than one active root/i)
  })

  it('wraps unit cycles', () => {
    const cyclic: OrganizationUnitNode[] = [
      { id: 'a', name: 'A', parentId: 'b', isActive: true, shareRequests: true, canWorkOnSolutions: false, managerUserId: null },
      { id: 'b', name: 'B', parentId: 'a', isActive: true, shareRequests: false, canWorkOnSolutions: false, managerUserId: null },
    ]
    expectOrganizationError(() => validateOrganization(cyclic, positions, assignments, teams), /cycle/i)
  })

  it('wraps duplicate unit ids', () => {
    const duplicated = [...units, { ...units[1], name: 'Engineering Clone' }]
    expectOrganizationError(() => validateOrganization(duplicated, positions, assignments, teams), /duplicate organization unit id/i, /"eng"/)
  })
})

describe('identity integrity — id lookups stay unambiguous', () => {
  it('rejects duplicate assignment ids', () => {
    const dup = [...assignments, asg('a-m1', 'u-dup', 'eng', 'p-staff')]
    expectOrganizationError(() => validateOrganization(units, positions, dup, teams), /duplicate assignment id/i, /"a-m1"/)
  })

  it('rejects duplicate team ids', () => {
    const dup = [...teams, { id: 't-1', unitId: 'company', name: 'Company Crew', reportsToAssignmentId: 'a-boss', isActive: true }]
    expectOrganizationError(() => validateOrganization(units, positions, assignments, dup), /duplicate team id/i, /"t-1"/)
  })

  it('rejects duplicate position ids', () => {
    const dup = [...positions, { id: 'p-staff', name: 'Staff Again', rank: 4, isActive: true }]
    expectOrganizationError(() => validateOrganization(units, dup, assignments, teams), /duplicate position id/i, /"p-staff"/)
  })
})
