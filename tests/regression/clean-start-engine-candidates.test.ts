// Clean-start approval candidate selection — option A (Plan B Task 3).
// In-memory fixtures only: NO Prisma, NO database, NO env, NO schema/server ops.
// Builds the candidate SET from exact-position holders (own-team active
// assignments ∪ reporting-path persons). The path is structural, not
// authorization (ledger R-A6-2); this module does not look up user accounts
// and does not perform action-time checks.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { selectStepCandidates } from '@/lib/approval-engine/candidates'
import type { AssignmentNode, ReportingPath } from '@/lib/organization/model'

const teamPath: ReportingPath = {
  originUserId: 'u-origin',
  assignmentId: 'a-origin',
  unitId: 'web',
  positionId: 'p-staff',
  teamId: 't-web',
  unitPath: ['web', 'eng', 'company'],
  steps: [
    { kind: 'TEAM_REPORTS_TO', unitId: 'web', assignmentId: 'a-lead', userId: 'u-lead', positionId: 'p-lead' },
    { kind: 'UNIT_MANAGER', unitId: 'web', assignmentId: 'a-webmgr', userId: 'u-webmgr', positionId: 'p-mgr' },
    { kind: 'UNIT_MANAGER', unitId: 'eng', assignmentId: 'a-engmgr', userId: 'u-engmgr', positionId: 'p-mgr' },
  ],
}

const m1: AssignmentNode = { id: 'a-m1', userId: 'u-m1', unitId: 'web', positionId: 'p-staff', teamId: 't-web', isActive: true }
const m2: AssignmentNode = { id: 'a-m2', userId: 'u-m2', unitId: 'web', positionId: 'p-lead', teamId: 't-web', isActive: true }
const ownTeamMemberAssignments: readonly AssignmentNode[] = [m1, m2]

// Sibling-team extra fixture: NEVER passed as ownTeamMemberAssignments.
const siblingLead: AssignmentNode = {
  id: 'a-sib',
  userId: 'u-sib',
  unitId: 'web',
  positionId: 'p-lead',
  teamId: 't-other',
  isActive: true,
}

const ids = (rows: ReadonlyArray<{ userId: string; assignmentId: string }>) =>
  rows.map((row) => `${row.userId}:${row.assignmentId}`)

describe('clean-start engine candidates — option A', () => {
  it('p-mgr: two path managers; own-team staff/lead never substitute', () => {
    const result = selectStepCandidates({
      path: teamPath,
      requiredPositionId: 'p-mgr',
      ownTeamMemberAssignments,
    })
    assert.deepEqual(ids(result), ['u-webmgr:a-webmgr', 'u-engmgr:a-engmgr'])
  })

  it('p-lead: reports-to AND own-team m2, distinct users, own-team first', () => {
    const result = selectStepCandidates({
      path: teamPath,
      requiredPositionId: 'p-lead',
      ownTeamMemberAssignments,
    })
    assert.deepEqual(ids(result), ['u-m2:a-m2', 'u-lead:a-lead'])
    assert.equal(new Set(result.map((row) => row.userId)).size, result.length)
  })

  it('sibling-team members are excluded when only provided as extra fixtures', () => {
    const extraFixtures: readonly AssignmentNode[] = [siblingLead]
    const result = selectStepCandidates({
      path: teamPath,
      requiredPositionId: 'p-lead',
      ownTeamMemberAssignments,
    })
    assert.equal(extraFixtures.length, 1)
    assert.equal(result.some((row) => row.userId === 'u-sib' || row.assignmentId === 'a-sib'), false)
    assert.deepEqual(ids(result), ['u-m2:a-m2', 'u-lead:a-lead'])
  })

  it('ungrouped origin (ownTeamMemberAssignments=[]) returns path persons only', () => {
    const ungroupedPath: ReportingPath = {
      ...teamPath,
      teamId: null,
      steps: teamPath.steps.filter((step) => step.kind === 'UNIT_MANAGER'),
    }
    const resultLead = selectStepCandidates({
      path: ungroupedPath,
      requiredPositionId: 'p-lead',
      ownTeamMemberAssignments: [],
    })
    const resultMgr = selectStepCandidates({
      path: ungroupedPath,
      requiredPositionId: 'p-mgr',
      ownTeamMemberAssignments: [],
    })
    assert.deepEqual(resultLead, [])
    assert.deepEqual(ids(resultMgr), ['u-webmgr:a-webmgr', 'u-engmgr:a-engmgr'])
    assert.equal(resultMgr.some((row) => row.userId === 'u-m2' || row.userId === 'u-lead'), false)
  })

  it('a person both on the path and in the team appears exactly once', () => {
    const leadAlsoOnTeam: AssignmentNode = {
      id: 'a-lead-as-member',
      userId: 'u-lead',
      unitId: 'web',
      positionId: 'p-lead',
      teamId: 't-web',
      isActive: true,
    }
    const result = selectStepCandidates({
      path: teamPath,
      requiredPositionId: 'p-lead',
      ownTeamMemberAssignments: [...ownTeamMemberAssignments, leadAlsoOnTeam],
    })
    assert.equal(result.filter((row) => row.userId === 'u-lead').length, 1)
    assert.deepEqual(ids(result), ['u-m2:a-m2', 'u-lead:a-lead-as-member'])
  })

  it('origin userId is never a candidate even if on the team at that position', () => {
    const originAtLead: AssignmentNode = {
      id: 'a-origin-lead',
      userId: 'u-origin',
      unitId: 'web',
      positionId: 'p-lead',
      teamId: 't-web',
      isActive: true,
    }
    const pathWithOriginStep: ReportingPath = {
      ...teamPath,
      steps: [
        { kind: 'TEAM_REPORTS_TO', unitId: 'web', assignmentId: 'a-origin-on-path', userId: 'u-origin', positionId: 'p-lead' },
        ...teamPath.steps,
      ],
    }
    const result = selectStepCandidates({
      path: pathWithOriginStep,
      requiredPositionId: 'p-lead',
      ownTeamMemberAssignments: [...ownTeamMemberAssignments, originAtLead],
    })
    assert.equal(result.some((row) => row.userId === 'u-origin'), false)
    assert.deepEqual(ids(result), ['u-m2:a-m2', 'u-lead:a-lead'])
  })

  it('skips inactive own-team assignments; does not invent findUser lookups', () => {
    const inactiveLead: AssignmentNode = {
      id: 'a-inactive',
      userId: 'u-inactive',
      unitId: 'web',
      positionId: 'p-lead',
      teamId: 't-web',
      isActive: false,
    }
    const result = selectStepCandidates({
      path: teamPath,
      requiredPositionId: 'p-lead',
      ownTeamMemberAssignments: [...ownTeamMemberAssignments, inactiveLead],
    })
    assert.equal(result.some((row) => row.userId === 'u-inactive' || row.assignmentId === 'a-inactive'), false)
    assert.deepEqual(ids(result), ['u-m2:a-m2', 'u-lead:a-lead'])
  })

  it('path step whose positionId mismatches requiredPositionId is not a candidate', () => {
    const mismatched: ReportingPath = {
      ...teamPath,
      steps: [
        ...teamPath.steps,
        { kind: 'UNIT_MANAGER', unitId: 'company', assignmentId: 'a-root', userId: 'u-root', positionId: 'p-dir' },
      ],
    }
    const result = selectStepCandidates({
      path: mismatched,
      requiredPositionId: 'p-mgr',
      ownTeamMemberAssignments,
    })
    assert.equal(result.some((row) => row.userId === 'u-root' || row.assignmentId === 'a-root'), false)
    assert.deepEqual(ids(result), ['u-webmgr:a-webmgr', 'u-engmgr:a-engmgr'])
  })

  it('does not query rank-inferred substitution, Prisma, findUser, or legacy engine modules', () => {
    const src = readFileSync('src/lib/approval-engine/candidates.ts', 'utf8')
    assert.doesNotMatch(src, /\.rank\b/)
    assert.doesNotMatch(src, /rank\s*>=/)
    assert.doesNotMatch(src, /gte\s*:/)
    assert.doesNotMatch(src, /@prisma\/client/)
    assert.doesNotMatch(src, /findUser/)
    assert.doesNotMatch(src, /from ['"]@\/lib\/approval-engine\/(legacy|transactions|instances|candidate-groups|phase-adapters|phase-origin)['"]/)
    assert.doesNotMatch(src, /from ['"]\.\/(legacy|transactions|instances|candidate-groups|phase-adapters|phase-origin)['"]/)
  })
})
