// Clean-start organization tree hierarchy visuals (approved bounded design:
// stronger indentation + connector rails/ticks, subtle unit-header bands,
// more spacing between sibling branches, expand/collapse chevrons with
// aria-expanded and accessible names; arbitrary depth, no fixed levels).
// Render harness: react-dom/server renderToStaticMarkup (sibling UI pattern:
// tests/regression/clean-start-ui-tree.test.ts).
// Pure props snapshot only: NO Prisma, NO database, NO env, NO server ops.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { AssignmentNode, OrganizationUnitNode, PositionNode, TeamNode } from '@/lib/organization/model'
import type { WorkspaceSnapshot } from '@/server-actions/organization'
import { OrganizationWorkspace } from '@/components/organization/OrganizationWorkspace'

const units: OrganizationUnitNode[] = [
  { id: 'treehx-root', name: 'TreeHx Root', parentId: null, isActive: true, shareRequests: false, canWorkOnSolutions: false, managerUserId: null },
  { id: 'treehx-alpha', name: 'TreeHx Alpha', parentId: 'treehx-root', isActive: true, shareRequests: true, canWorkOnSolutions: false, managerUserId: null },
  { id: 'treehx-beta', name: 'TreeHx Beta', parentId: 'treehx-root', isActive: true, shareRequests: false, canWorkOnSolutions: true, managerUserId: null },
  { id: 'treehx-alpha-one', name: 'TreeHx Alpha One', parentId: 'treehx-alpha', isActive: true, shareRequests: false, canWorkOnSolutions: false, managerUserId: null },
  { id: 'treehx-deep', name: 'TreeHx Alpha One Deep', parentId: 'treehx-alpha-one', isActive: true, shareRequests: false, canWorkOnSolutions: false, managerUserId: null },
  { id: 'treehx-peer', name: 'TreeHx Alpha One Peer', parentId: 'treehx-alpha-one', isActive: true, shareRequests: false, canWorkOnSolutions: false, managerUserId: null },
  { id: 'treehx-gone', name: 'TreeHx Gone', parentId: 'treehx-beta', isActive: false, shareRequests: false, canWorkOnSolutions: false, managerUserId: null },
]

const positions: PositionNode[] = [
  { id: 'treehx-pos-staff', name: 'Staff', rank: 1, isActive: true },
  { id: 'treehx-pos-manager', name: 'Manager', rank: 3, isActive: true },
]

const assignments: AssignmentNode[] = [
  { id: 'treehx-asg-morgan', userId: 'treehx-morgan', unitId: 'treehx-alpha', positionId: 'treehx-pos-manager', teamId: null, isActive: true },
  { id: 'treehx-asg-casey', userId: 'treehx-casey', unitId: 'treehx-alpha', positionId: 'treehx-pos-staff', teamId: 'treehx-squad', isActive: true },
  { id: 'treehx-asg-riley', userId: 'treehx-riley', unitId: 'treehx-beta', positionId: 'treehx-pos-staff', teamId: null, isActive: true },
]

const teams: TeamNode[] = [
  { id: 'treehx-squad', unitId: 'treehx-alpha', name: 'TreeHx Squad', reportsToAssignmentId: 'treehx-asg-morgan', isActive: true },
]

const users: WorkspaceSnapshot['users'] = [
  { id: 'treehx-morgan', name: 'TreeHx Morgan', email: 'treehx-morgan@example.com', role: 'general_dept', isActive: true },
  { id: 'treehx-casey', name: 'TreeHx Casey', email: 'treehx-casey@example.com', role: 'general_dept', isActive: true },
  { id: 'treehx-riley', name: 'TreeHx Riley', email: 'treehx-riley@example.com', role: 'general_dept', isActive: true },
]

function makeSnapshot(over: Partial<WorkspaceSnapshot> = {}): WorkspaceSnapshot {
  return {
    units,
    positions,
    assignments,
    teams,
    users,
    unassignedUsers: [],
    routeSources: [],
    customChainExceptions: [],
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

/** The opening tag (with attributes) of the element carrying a data-testid. */
function openTagByTestId(html: string, testId: string): string {
  const marker = `data-testid="${testId}"`
  const attr = html.indexOf(marker)
  assert.ok(attr >= 0, `missing data-testid="${testId}"`)
  const open = html.lastIndexOf('<', attr)
  return html.slice(open, html.indexOf('>', attr) + 1)
}

function classOfTestId(html: string, testId: string): string {
  const match = /class="([^"]*)"/.exec(openTagByTestId(html, testId))
  assert.ok(match, `no class attribute on ${testId}`)
  return match[1]
}

function renderWorkspace(snapshot: WorkspaceSnapshot = makeSnapshot()): string {
  return renderToStaticMarkup(createElement(OrganizationWorkspace, { snapshot }))
}

describe('clean-start tree hierarchy visuals', () => {
  it('renders an expand/collapse toggle with aria-expanded and an accessible name on units with subtree content', () => {
    const html = renderWorkspace()
    // Units with child units and/or people carry the toggle.
    for (const unitId of ['treehx-root', 'treehx-alpha', 'treehx-beta', 'treehx-alpha-one']) {
      const tag = openTagByTestId(html, `unit-toggle-${unitId}`)
      assert.match(tag, /aria-expanded="true"/, `${unitId} toggle must expose aria-expanded`)
      assert.match(tag, /aria-label="Collapse [^"]+"/, `${unitId} toggle needs an accessible name`)
    }
    // Default state stays expanded so every row renders (existing behavior).
    assert.ok(html.includes('data-testid="unit-children-treehx-alpha"'))
    assert.ok(html.includes('data-testid="unit-people-treehx-alpha"'))
  })

  it('renders no toggle on leaf units without people (chevrons only where they collapse something)', () => {
    const html = renderWorkspace()
    assert.equal(countTestId(html, 'unit-toggle-treehx-deep'), 0)
    assert.equal(countTestId(html, 'unit-toggle-treehx-peer'), 0)
    assert.doesNotMatch(html, /data-testid="unit-toggle-treehx-gone"/)
  })

  it('distinguishes unit headers from people chips: subtle band on units, chip style on people', () => {
    const html = renderWorkspace()
    for (const unitId of ['treehx-root', 'treehx-alpha', 'treehx-beta', 'treehx-alpha-one', 'treehx-deep']) {
      assert.match(
        classOfTestId(html, `unit-header-${unitId}`),
        /bg-muted/,
        `${unitId} header must carry the subtle unit band`,
      )
    }
    const morgan = innerByTestId(html, 'person-chip-treehx-morgan')
    assert.match(morgan, /TreeHx Morgan — Manager/)
    // The person affordance stays a secondary chip, never a banded unit header.
    assert.match(morgan, /class="[^"]*bg-secondary/)
    const header = classOfTestId(html, 'unit-header-treehx-alpha')
    assert.ok(!header.includes('bg-secondary'), 'unit header must not reuse the person chip background')
  })

  it('strengthens unit-ancestry structure: indentation rail, per-child connector ticks, sibling-branch spacing', () => {
    const html = renderWorkspace()
    for (const unitId of ['treehx-root', 'treehx-alpha', 'treehx-alpha-one']) {
      const childrenClass = classOfTestId(html, `unit-children-${unitId}`)
      assert.match(childrenClass, /border-l-2/, `${unitId} children need the stronger rail`)
      assert.match(childrenClass, /pl-6/, `${unitId} children need stronger indentation`)
      assert.match(childrenClass, /space-y-5/, `${unitId} sibling branches need extra separation`)
    }
    // Root-level sibling branches get the wider separation too.
    assert.match(classOfTestId(html, 'organization-tree'), /space-y-6/)
    // One connector tick per child unit, from the rail toward the child row.
    for (const childId of ['treehx-alpha', 'treehx-beta', 'treehx-deep', 'treehx-peer']) {
      const tick = openTagByTestId(html, `unit-connector-${childId}`)
      assert.match(tick, /aria-hidden="true"/)
      assert.match(classOfTestId(html, `unit-connector-${childId}`), /bg-border/)
    }
  })

  it('keeps unit ancestry and people/team reporting nesting in separate structures (no conflation)', () => {
    const html = renderWorkspace()
    const alphaChildren = innerByTestId(html, 'unit-children-treehx-alpha')
    const alphaPeople = innerByTestId(html, 'unit-people-treehx-alpha')
    // Child UNITS live under the ancestry rail, never under the people list.
    assert.match(alphaChildren, /data-testid="unit-row-treehx-alpha-one"/)
    assert.doesNotMatch(alphaPeople, /unit-row-treehx-alpha-one/)
    // PEOPLE live under the people list, never under the ancestry rail.
    assert.match(alphaPeople, /data-testid="person-chip-treehx-morgan"/)
    assert.doesNotMatch(alphaChildren, /person-chip-treehx-morgan/)
    // TEAMS nest under their reports-to person chip (person-once), never under the ancestry rail.
    const morganChip = innerByTestId(html, 'person-chip-treehx-morgan')
    assert.match(morganChip, /data-testid="team-group-treehx-squad"/)
    assert.match(morganChip, /TreeHx Squad/)
    assert.match(morganChip, /TreeHx Casey — Staff/)
    assert.doesNotMatch(alphaChildren, /team-group-treehx-squad/)
    assert.equal(countTestId(html, 'person-chip-treehx-morgan'), 1)
    // Inactive filtering is untouched.
    assert.doesNotMatch(html, /TreeHx Gone/)
  })

  it('keeps hover/focus controls out of flow so appearing controls cannot shift rows', () => {
    const html = renderWorkspace()
    // The header band keeps a stable box: controls appear via
    // visibility/opacity, never by joining the layout.
    const headerClass = classOfTestId(html, 'unit-header-treehx-alpha')
    assert.ok(!headerClass.includes('w-fit'), 'header band must not hug content (hover would resize it)')
    const headerInner = innerByTestId(html, 'unit-header-treehx-alpha')
    const actionsMatch = /data-testid="unit-hover-actions-treehx-alpha"[^>]*class="([^"]*)"/.exec(headerInner)
    assert.ok(actionsMatch, 'hover actions must stay inside the unit header')
    const actionsClass = actionsMatch[1]
    assert.match(actionsClass, /absolute/, 'hover actions must be out of flow (no layout shift on hover)')
    assert.match(actionsClass, /invisible/, 'hidden state must use visibility, not display')
    assert.match(actionsClass, /opacity-0/, 'appearance change must be opacity-based')
    assert.match(actionsClass, /group-hover:visible/, 'hover still reveals the controls')
    assert.match(actionsClass, /group-focus-within:visible/, 'keyboard focus still reveals the controls')
  })

  it('preserves the view-mode tree (no idle inputs) and the rename wiring', () => {
    const html = renderWorkspace()
    assert.doesNotMatch(html, /<input/)
    assert.match(html, /TreeHx Alpha One Deep/)
  })
})
