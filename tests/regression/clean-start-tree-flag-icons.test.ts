// Clean-start tree flag icons follow-up (owner-approved bounded UI).
// Render harness: react-dom/server renderToStaticMarkup (sibling UI pattern:
// tests/regression/clean-start-ui-tree.test.ts). Pure props snapshot only:
// NO Prisma, NO database, NO env, NO schema/server ops.
//
// Approved behavior under test: the tree's text badges for Request sharing
// and Can work on solutions become small sharing and wrench icons, rendered
// only for ENABLED flags, with accessible names and hover/focus tooltips.
// The unit side panel keeps its full settings labels and business semantics.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { AssignmentNode, OrganizationUnitNode, PositionNode, TeamNode } from '@/lib/organization/model'
import type { WorkspaceSnapshot } from '@/server-actions/organization'
import { OrganizationWorkspace } from '@/components/organization/OrganizationWorkspace'
import { SHARE_REQUESTS_LABEL, UnitSidePanel } from '@/components/organization/UnitSidePanel'

const read = (path: string) => readFileSync(path, 'utf8')

const units: OrganizationUnitNode[] = [
  { id: 'company', name: 'Company', parentId: null, isActive: true, shareRequests: false, canWorkOnSolutions: false, managerUserId: null },
  { id: 'ops', name: 'Operations', parentId: 'company', isActive: true, shareRequests: true, canWorkOnSolutions: false, managerUserId: 'pat' },
  { id: 'section-a', name: 'Section A', parentId: 'ops', isActive: true, shareRequests: false, canWorkOnSolutions: false, managerUserId: null },
  { id: 'section-b', name: 'Section B', parentId: 'ops', isActive: true, shareRequests: true, canWorkOnSolutions: true, managerUserId: null },
]

const positions: PositionNode[] = [
  { id: 'p-staff', name: 'Staff', rank: 1, isActive: true },
  { id: 'p-manager', name: 'Manager', rank: 3, isActive: true },
]

const assignments: AssignmentNode[] = [
  { id: 'asg-pat', userId: 'pat', unitId: 'ops', positionId: 'p-manager', teamId: null, isActive: true },
]

const teams: TeamNode[] = []

const users: WorkspaceSnapshot['users'] = [
  { id: 'pat', name: 'Pat', email: 'pat@example.com', role: 'general_dept', isActive: true },
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

describe('tree flag icons', () => {
  it('renders a sharing icon only on units with shareRequests enabled', () => {
    const html = renderWorkspace()
    assert.equal(countTestId(html, 'sharing-badge-ops'), 1)
    assert.equal(countTestId(html, 'sharing-badge-section-b'), 1)
    assert.equal(countTestId(html, 'sharing-badge-company'), 0)
    assert.equal(countTestId(html, 'sharing-badge-section-a'), 0)
  })

  it('renders a wrench icon only on units with canWorkOnSolutions enabled', () => {
    const html = renderWorkspace()
    assert.equal(countTestId(html, 'solutions-badge-section-b'), 1)
    assert.equal(countTestId(html, 'solutions-badge-ops'), 0)
    assert.equal(countTestId(html, 'solutions-badge-company'), 0)
    assert.equal(countTestId(html, 'solutions-badge-section-a'), 0)
  })

  it('icons are accessible: role img, aria-label names, and focusable for hover/focus tooltips', () => {
    const html = renderWorkspace()
    const opsHeader = innerByTestId(html, 'unit-header-ops')
    assert.match(opsHeader, /data-testid="sharing-badge-ops"[^>]*role="img"/)
    assert.match(opsHeader, /data-testid="sharing-badge-ops"[^>]*aria-label="Request sharing"/)
    assert.match(opsHeader, /data-testid="sharing-badge-ops"[^>]*tabindex="0"/)
    const sharingIcon = innerByTestId(html, 'sharing-badge-ops')
    assert.match(sharingIcon, /<svg/)

    const sectionBHeader = innerByTestId(html, 'unit-header-section-b')
    assert.match(sectionBHeader, /data-testid="solutions-badge-section-b"[^>]*role="img"/)
    assert.match(sectionBHeader, /data-testid="solutions-badge-section-b"[^>]*aria-label="Can work on solutions"/)
    assert.match(sectionBHeader, /data-testid="solutions-badge-section-b"[^>]*tabindex="0"/)
    const wrenchIcon = innerByTestId(html, 'solutions-badge-section-b')
    assert.match(wrenchIcon, /<svg/)
  })

  it('the icons are icon-only: no Request sharing or Can work on solutions words as badge text', () => {
    const html = renderWorkspace()
    const sharingIcon = innerByTestId(html, 'sharing-badge-ops')
    assert.doesNotMatch(sharingIcon, />[^<]*Request sharing/)
    const wrenchIcon = innerByTestId(html, 'solutions-badge-section-b')
    assert.doesNotMatch(wrenchIcon, />[^<]*Can work on solutions/)
    // Icon markup (lucide svg), not a text badge.
    assert.match(sharingIcon, /<svg/)
    assert.match(wrenchIcon, /<svg/)
  })

  it('replaces the Badge text element in TreeNodeRow with the icon components', () => {
    const row = read('src/components/organization/TreeNodeRow.tsx')
    assert.match(row, /Share2/)
    assert.match(row, /Wrench/)
    assert.doesNotMatch(row, />Request sharing</)
  })

  it('leaves the custom-chain exception text badges untouched', () => {
    const html = renderWorkspace()
    assert.equal(countTestId(html, 'custom-chain-exception-req-custom'), 1)
    assert.match(html, /Rush order/)
  })
})

describe('settings labels preserved', () => {
  it('UnitSidePanel keeps the full sharing and solutions settings labels', () => {
    const html = renderToStaticMarkup(createElement(UnitSidePanel, {
      unit: units[1],
      snapshot: makeSnapshot(),
    }))
    assert.match(html, /Share requests within this unit and all its descendants/)
    assert.match(html, /Can work on solutions/)
    assert.match(html, /data-testid="unit-share-requests"/)
    assert.match(html, /data-testid="unit-can-work-on-solutions"/)
  })

  it('the exported sharing label stays the full sentence', () => {
    assert.equal(
      SHARE_REQUESTS_LABEL,
      'Share requests within this unit and all its descendants',
    )
  })
})
