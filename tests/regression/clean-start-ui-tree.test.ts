// Clean-start organization tree UI (Plan C Task 2).
// Render harness: react-dom/server renderToStaticMarkup (sibling UI pattern:
// tests/regression/formatted-text-ui.test.ts, storage-alert.test.ts).
// Pure props snapshot only: NO Prisma, NO database, NO env, NO schema/server ops.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { AssignmentNode, OrganizationUnitNode, PositionNode, TeamNode } from '@/lib/organization/model'
import type { WorkspaceSnapshot } from '@/lib/organization/workspace-admin'
import { OrganizationWorkspace } from '@/components/organization/OrganizationWorkspace'
import { UnassignedPeopleList } from '@/components/organization/UnassignedPeopleList'
import { assignmentsByUserId } from '@/components/organization/TreeNodeRow'

const read = (path: string) => readFileSync(path, 'utf8')

const units: OrganizationUnitNode[] = [
  { id: 'company', name: 'Company', parentId: null, isActive: true, shareRequests: false, canWorkOnSolutions: false, managerUserId: null },
  { id: 'ops', name: 'Operations', parentId: 'company', isActive: true, shareRequests: true, canWorkOnSolutions: false, managerUserId: 'pat' },
  { id: 'section-a', name: 'Section A', parentId: 'ops', isActive: true, shareRequests: false, canWorkOnSolutions: false, managerUserId: null },
  { id: 'section-b', name: 'Section B', parentId: 'ops', isActive: true, shareRequests: true, canWorkOnSolutions: false, managerUserId: null },
]

const positions: PositionNode[] = [
  { id: 'p-staff', name: 'Staff', rank: 1, isActive: true },
  { id: 'p-manager', name: 'Manager', rank: 3, isActive: true },
]

const assignments: AssignmentNode[] = [
  { id: 'asg-pat', userId: 'pat', unitId: 'ops', positionId: 'p-manager', teamId: null, isActive: true },
  { id: 'asg-casey', userId: 'casey', unitId: 'ops', positionId: 'p-staff', teamId: 'team-alpha', isActive: true },
  { id: 'asg-quinn', userId: 'quinn', unitId: 'ops', positionId: 'p-staff', teamId: 'team-beta', isActive: true },
  { id: 'asg-alice', userId: 'alice', unitId: 'section-a', positionId: 'p-staff', teamId: null, isActive: true },
  { id: 'asg-bob', userId: 'bob', unitId: 'section-b', positionId: 'p-staff', teamId: null, isActive: true },
  { id: 'asg-old', userId: 'old', unitId: 'ops', positionId: 'p-staff', teamId: null, isActive: false },
]

const teams: TeamNode[] = [
  { id: 'team-alpha', unitId: 'ops', name: 'Alpha Team', reportsToAssignmentId: 'asg-pat', isActive: true },
  { id: 'team-beta', unitId: 'ops', name: 'Beta Team', reportsToAssignmentId: 'asg-pat', isActive: true },
  { id: 'team-inactive', unitId: 'ops', name: 'Zulu Inactive', reportsToAssignmentId: 'asg-pat', isActive: false },
]

const users: WorkspaceSnapshot['users'] = [
  { id: 'pat', name: 'Pat', email: 'pat@example.com', role: 'general_dept', isActive: true },
  { id: 'casey', name: 'Casey', email: 'casey@example.com', role: 'general_dept', isActive: true },
  { id: 'quinn', name: 'Quinn', email: 'quinn@example.com', role: 'general_dept', isActive: true },
  { id: 'alice', name: 'Alice', email: 'alice@example.com', role: 'general_dept', isActive: true },
  { id: 'bob', name: 'Bob', email: 'bob@example.com', role: 'general_dept', isActive: true },
  { id: 'dana', name: 'Dana', email: 'dana@example.com', role: 'general_dept', isActive: true },
  { id: 'old', name: 'Old', email: 'old@example.com', role: 'general_dept', isActive: false },
]

function makeSnapshot(over: Partial<WorkspaceSnapshot> = {}): WorkspaceSnapshot {
  return {
    units,
    positions,
    assignments,
    teams,
    users,
    unassignedUsers: [{ id: 'dana', name: 'Dana', email: 'dana@example.com' }],
    routeSources: [],
    customChainExceptions: [{ requestId: 'req-custom', title: 'Rush order' }],
    readiness: { ready: true, blockers: [] },
    ...over,
  }
}

function countTestId(html: string, testId: string): number {
  const marker = `data-testid="${testId}"`
  return html.split(marker).length - 1
}

function innerByTestId(html: string, testId: string): string {
  const marker = `data-testid="${testId}"`
  const attr = html.indexOf(marker)
  assert.ok(attr >= 0, `missing data-testid="${testId}"`)
  const open = html.lastIndexOf('<', attr)
  const tagMatch = /^<([a-zA-Z0-9]+)/.exec(html.slice(open))
  assert.ok(tagMatch, `could not parse tag for ${testId}`)
  const tag = tagMatch[1]
  const afterOpen = html.indexOf('>', attr) + 1
  let depth = 1
  let i = afterOpen
  while (i < html.length && depth > 0) {
    const nextOpen = html.indexOf(`<${tag}`, i)
    const nextClose = html.indexOf(`</${tag}>`, i)
    if (nextClose < 0) {
      throw new Error(`unclosed ${testId}`)
    }
    if (nextOpen >= 0 && nextOpen < nextClose) {
      depth += 1
      i = nextOpen + tag.length + 1
    } else {
      depth -= 1
      if (depth === 0) return html.slice(afterOpen, nextClose)
      i = nextClose + tag.length + 3
    }
  }
  throw new Error(`unclosed ${testId}`)
}

function renderWorkspace(snapshot: WorkspaceSnapshot = makeSnapshot()): string {
  return renderToStaticMarkup(createElement(OrganizationWorkspace, { snapshot }))
}

describe('clean-start organization tree UI', () => {
  it('renders Pat once with both Operations teams nested under the person chip', () => {
    const html = renderWorkspace()
    assert.equal(countTestId(html, 'person-chip-pat'), 1)
    const pat = innerByTestId(html, 'person-chip-pat')
    assert.match(pat, /Pat — Manager/)
    assert.match(pat, /data-testid="team-group-team-alpha"/)
    assert.match(pat, /data-testid="team-group-team-beta"/)
    const alpha = innerByTestId(pat, 'team-group-team-alpha')
    const beta = innerByTestId(pat, 'team-group-team-beta')
    assert.match(alpha, /Alpha Team/)
    assert.match(alpha, /Casey — Staff/)
    assert.match(beta, /Beta Team/)
    assert.match(beta, /Quinn — Staff/)
    assert.doesNotMatch(pat, /Zulu Inactive/)
    assert.doesNotMatch(html, /data-testid="person-chip-old"/)
  })

  it('places Alice under Section A only', () => {
    const html = renderWorkspace()
    assert.equal(countTestId(html, 'person-chip-alice'), 1)
    const sectionA = innerByTestId(html, 'unit-row-section-a')
    const sectionB = innerByTestId(html, 'unit-row-section-b')
    const opsPeople = innerByTestId(html, 'unit-people-ops')
    assert.match(sectionA, /data-testid="person-chip-alice"/)
    assert.match(sectionA, /Alice — Staff/)
    assert.doesNotMatch(sectionB, /person-chip-alice/)
    assert.doesNotMatch(opsPeople, /person-chip-alice/)
  })

  it('shows Request sharing badges only on sharing units', () => {
    const html = renderWorkspace()
    const companyHeader = innerByTestId(html, 'unit-header-company')
    const opsHeader = innerByTestId(html, 'unit-header-ops')
    const sectionAHeader = innerByTestId(html, 'unit-header-section-a')
    const sectionBHeader = innerByTestId(html, 'unit-header-section-b')
    assert.doesNotMatch(companyHeader, /Request sharing/)
    assert.match(opsHeader, /Request sharing/)
    assert.doesNotMatch(sectionAHeader, /Request sharing/)
    assert.match(sectionBHeader, /Request sharing/)
    assert.equal(countTestId(html, 'sharing-badge-ops'), 1)
    assert.equal(countTestId(html, 'sharing-badge-section-b'), 1)
    assert.equal(countTestId(html, 'sharing-badge-company'), 0)
    assert.equal(countTestId(html, 'sharing-badge-section-a'), 0)
  })

  it('lists the fixture unassigned user (toolbar chip panel) and compact custom-chain exception badges', () => {
    const html = renderWorkspace()
    // The bottom dock is gone: the workspace shows the toolbar chip and the
    // list renders inside the panel it opens.
    assert.doesNotMatch(html, /organization-unassigned-dock/)
    assert.match(html, /data-testid="unassigned-dock-toggle"/)
    assert.match(html, /Unassigned · 1</)
    const unassigned = renderToStaticMarkup(createElement(UnassignedPeopleList, {
      users: [{ id: 'dana', name: 'Dana', email: 'dana@example.com' }],
    }))
    assert.match(unassigned, /Unassigned people/)
    assert.match(unassigned, /data-testid="unassigned-person-dana"/)
    assert.match(unassigned, /Dana/)
    assert.doesNotMatch(unassigned, /Pat/)
    assert.equal(countTestId(html, 'custom-chain-exception-req-custom'), 1)
    assert.match(html, /Rush order/)
  })

  it('nests child units sorted by name', () => {
    const html = renderWorkspace()
    const children = innerByTestId(html, 'unit-children-ops')
    const sectionA = children.indexOf('unit-row-section-a')
    const sectionB = children.indexOf('unit-row-section-b')
    assert.ok(sectionA >= 0 && sectionB > sectionA, 'Section A must precede Section B')
  })

  it('keeps unit and team names in view mode until pencil (no idle inputs)', () => {
    const html = renderWorkspace()
    assert.doesNotMatch(html, /<input/)
    assert.match(html, /Operations/)
    assert.match(html, /Alpha Team/)
    const row = read('src/components/organization/TreeNodeRow.tsx')
    assert.match(row, /InlineNameEdit/)
  })

  it('person-once is structural: assignments map keyed by user, not per team', () => {
    const byUser = assignmentsByUserId(assignments, 'ops')
    assert.equal(byUser.get('pat')?.id, 'asg-pat')
    assert.equal(
      [...byUser.values()].filter((assignment) => assignment.userId === 'pat').length,
      1,
    )
    const twoTeams = teams.filter((team) => team.isActive && team.reportsToAssignmentId === 'asg-pat')
    assert.equal(twoTeams.length, 2)

    const row = read('src/components/organization/TreeNodeRow.tsx')
    assert.match(row, /export function assignmentsByUserId/)
    assert.match(row, /Map<string, AssignmentNode>/)
    assert.match(row, /byUser\.set\(assignment\.userId/)
    assert.doesNotMatch(
      row,
      /for\s*\(\s*const\s+team\s+of[\s\S]*person-chip/,
    )
  })
})
