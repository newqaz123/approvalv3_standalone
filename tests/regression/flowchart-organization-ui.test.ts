// Flowchart organization UI contracts. Pure render/source assertions plus a
// short Playwright geometry check of the flowchart CSS. No Prisma, database,
// env, or write actions.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { chromium } from '@playwright/test'
import postcss from 'postcss'
import tailwindcss from 'tailwindcss'
import autoprefixer from 'autoprefixer'
import type { AssignmentNode, OrganizationUnitNode, PositionNode, TeamNode } from '@/lib/organization/model'
import type { WorkspaceSnapshot } from '@/server-actions/organization'
import { OrganizationWorkspace } from '@/components/organization/OrganizationWorkspace'
import { UnitSidePanel } from '@/components/organization/UnitSidePanel'
import { UnassignedPeopleList } from '@/components/organization/UnassignedPeopleList'

const units: OrganizationUnitNode[] = [
  { id: 'flow-root', name: 'Flow Root', parentId: null, isActive: true, shareRequests: false, canWorkOnSolutions: false, managerUserId: null },
  { id: 'flow-child-a', name: 'Flow Child A Engineering', parentId: 'flow-root', isActive: true, shareRequests: true, canWorkOnSolutions: false, managerUserId: 'flow-manager' },
  { id: 'flow-child-b', name: 'Flow Child B Production', parentId: 'flow-root', isActive: true, shareRequests: false, canWorkOnSolutions: true, managerUserId: null },
  { id: 'flow-grand-1', name: 'Flow Grand 1', parentId: 'flow-child-a', isActive: true, shareRequests: false, canWorkOnSolutions: false, managerUserId: null },
  { id: 'flow-grand-2', name: 'Flow Grand 2', parentId: 'flow-child-a', isActive: true, shareRequests: false, canWorkOnSolutions: false, managerUserId: null },
  { id: 'flow-only', name: 'Flow Only Child', parentId: 'flow-child-b', isActive: true, shareRequests: false, canWorkOnSolutions: false, managerUserId: null },
]

const positions: PositionNode[] = [
  { id: 'flow-manager-position', name: 'Department manager', rank: 3, isActive: true },
  { id: 'flow-staff-position', name: 'Staff', rank: 1, isActive: true },
]

const assignments: AssignmentNode[] = [
  { id: 'flow-manager-assignment', userId: 'flow-manager', unitId: 'flow-child-a', positionId: 'flow-manager-position', teamId: null, isActive: true },
  { id: 'flow-staff-assignment', userId: 'flow-staff', unitId: 'flow-child-a', positionId: 'flow-staff-position', teamId: null, isActive: true },
  // manager-ranked assignee on a unit whose persisted manager is None
  { id: 'flow-ranked-assignment', userId: 'flow-ranked', unitId: 'flow-child-b', positionId: 'flow-manager-position', teamId: null, isActive: true },
]

const teams: TeamNode[] = []

const users: WorkspaceSnapshot['users'] = [
  { id: 'flow-manager', name: 'Dana Manager', email: 'dana@example.com', role: 'general_dept', isActive: true },
  { id: 'flow-staff', name: 'Pat Staff', email: 'pat@example.com', role: 'general_dept', isActive: true },
  { id: 'flow-ranked', name: 'Riley Ranked', email: 'riley@example.com', role: 'general_dept', isActive: true },
  { id: 'flow-unassigned', name: 'Alice Unassigned', email: 'alice@example.com', role: 'general_dept', isActive: true },
]

const snapshot: WorkspaceSnapshot = {
  units,
  positions,
  assignments,
  teams,
  users,
  unassignedUsers: [{ id: 'flow-unassigned', name: 'Alice Unassigned', email: 'alice@example.com' }],
  routeSources: [],
  customChainExceptions: [],
  readiness: { ready: true, blockers: [] },
}

function renderWorkspace(): string {
  return renderToStaticMarkup(createElement(OrganizationWorkspace, { snapshot }))
}

function openTagByTestId(html: string, testId: string): string {
  const marker = `data-testid="${testId}"`
  const attr = html.indexOf(marker)
  assert.ok(attr >= 0, `missing data-testid="${testId}"`)
  const open = html.lastIndexOf('<', attr)
  return html.slice(open, html.indexOf('>', attr) + 1)
}

function classOfTestId(html: string, testId: string): string {
  const marker = `data-testid="${testId}"`
  const attr = html.indexOf(marker)
  assert.ok(attr >= 0, `missing data-testid="${testId}"`)
  const open = html.lastIndexOf('<', attr)
  const tag = html.slice(open, html.indexOf('>', attr) + 1)
  const match = /class="([^"]*)"/.exec(tag)
  assert.ok(match, `no class attribute on ${testId}`)
  return match[1]
}

function cssRule(source: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = source.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{[^}]*\\}`))
  assert.ok(match, `missing CSS rule for ${selector}`)
  return match[0]
}

type Box = { top: number; left: number; right: number; bottom: number; width: number; height: number }

type Geometry = Record<string, Box | string | number | null>

let compiledCssPromise: Promise<string> | null = null

async function compiledApplicationCss(): Promise<string> {
  if (!compiledCssPromise) {
    compiledCssPromise = postcss([tailwindcss(), autoprefixer])
      .process(readFileSync('src/app/globals.css', 'utf8'), { from: 'src/app/globals.css' })
      .then((result) => result.css)
  }
  return compiledCssPromise
}

async function measureFlowchartGeometry(options: {
  viewport: { width: number; height: number }
  frameWidth: string
}): Promise<Geometry> {
  const css = await compiledApplicationCss()
  assert.match(css, /\.pl-6/, 'compiled application styles must include Tailwind pl-6')
  assert.match(css, /\.border-l-2/, 'compiled application styles must include Tailwind border-l-2')
  assert.match(css, /\.md\\:pl-8/, 'compiled application styles must include Tailwind md:pl-8')
  const html = renderWorkspace()
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: options.viewport })
    await page.setContent(`<!DOCTYPE html><html><head><style>${css}</style></head><body>
      <div data-testid="geometry-frame" style="width:${options.frameWidth};max-width:${options.frameWidth};">${html}</div>
    </body></html>`)
    return await page.evaluate(`(() => {
      const box = (id) => {
        const el = document.querySelector('[data-testid="' + id + '"]')
        if (!el) return null
        const r = el.getBoundingClientRect()
        return { top: r.top, left: r.left, right: r.right, bottom: r.bottom, width: r.width, height: r.height }
      }
      const usedPx = (value, reference) => {
        if (!value || value === 'auto') return 0
        const trimmed = String(value).trim()
        if (trimmed.endsWith('%')) return (parseFloat(trimmed) / 100) * reference
        const parsed = parseFloat(trimmed)
        return Number.isFinite(parsed) ? parsed : 0
      }
      const pseudo = (id, name) => {
        const el = document.querySelector('[data-testid="' + id + '"]')
        if (!el) return null
        const r = el.getBoundingClientRect()
        const cs = getComputedStyle(el, name)
        if (cs.display === 'none' || cs.content === 'none') return null
        const host = getComputedStyle(el)
        const borderLeft = parseFloat(host.borderLeftWidth) || 0
        const borderTop = parseFloat(host.borderTopWidth) || 0
        const paddingBoxWidth = el.clientWidth
        const paddingBoxHeight = el.clientHeight
        let tx = 0, ty = 0
        if (cs.transform && cs.transform !== 'none') {
          const matrix = new DOMMatrixReadOnly(cs.transform)
          tx = matrix.m41
          ty = matrix.m42
        }
        const top = r.top + borderTop + usedPx(cs.top, paddingBoxHeight) + ty
        const left = r.left + borderLeft + usedPx(cs.left, paddingBoxWidth) + tx
        let width = parseFloat(cs.width)
        if (!Number.isFinite(width) || width === 0) {
          width = Math.max(0, paddingBoxWidth - usedPx(cs.left, paddingBoxWidth) - usedPx(cs.right, paddingBoxWidth))
        }
        const height = parseFloat(cs.height)
        if (!height) return null
        return { top: top, left: left, right: left + width, bottom: top + height, width: width, height: height }
      }
      // Rail box = union of the per-child half-segments (::before/::after of
      // each .organization-unit-child wrapper). Chained halves span exactly
      // first-child center -> last-child center (owner-approved endpoint
      // contract); the group-wide ::after rail no longer paints on desktop.
      const railBox = (groupId) => {
        const group = document.querySelector('[data-testid="' + groupId + '"]')
        if (!group) return null
        const wrappers = group.querySelectorAll(':scope > .organization-unit-child')
        let box = null
        wrappers.forEach((w) => {
          ['::before', '::after'].forEach((name) => {
            const cs = getComputedStyle(w, name)
            if (cs.display === 'none' || cs.content === 'none') return
            const r = w.getBoundingClientRect()
            const host = getComputedStyle(w)
            const segLeft = r.left + (parseFloat(host.borderLeftWidth) || 0) + usedPx(cs.left, w.clientWidth)
            const segTop = r.top + (parseFloat(host.borderTopWidth) || 0) + usedPx(cs.top, w.clientHeight)
            const segWidth = parseFloat(cs.width)
            const segHeight = parseFloat(cs.height)
            if (!Number.isFinite(segWidth) || !Number.isFinite(segHeight) || segHeight === 0) return
            const seg = { top: segTop, left: segLeft, right: segLeft + segWidth, bottom: segTop + segHeight, width: segWidth, height: segHeight }
            box = box
              ? { top: Math.min(box.top, seg.top), left: Math.min(box.left, seg.left), right: Math.max(box.right, seg.right), bottom: Math.max(box.bottom, seg.bottom), width: 0, height: 0 }
              : seg
          })
        })
        return box
      }
      const overflowWrap = document.querySelector('[data-testid="unit-overflow-flow-child-a"]')
        && document.querySelector('[data-testid="unit-overflow-flow-child-a"]').closest('.organization-unit-header-overflow')
      return {
        parent: box('unit-row-flow-root'),
        parentCard: box('unit-card-flow-root'),
        childA: box('unit-card-flow-child-a'),
        childB: box('unit-card-flow-child-b'),
        childARow: box('unit-row-flow-child-a'),
        childBRow: box('unit-row-flow-child-b'),
        grand1: box('unit-card-flow-grand-1'),
        grand2: box('unit-card-flow-grand-2'),
        onlyChild: box('unit-card-flow-only'),
        nameA: box('unit-name-flow-child-a'),
        sharingA: box('sharing-badge-flow-child-a'),
        overflowA: box('unit-overflow-flow-child-a'),
        hoverA: box('unit-hover-actions-flow-child-a'),
        connectorA: box('unit-connector-flow-child-a'),
        connectorB: box('unit-connector-flow-child-b'),
        connectorG1: box('unit-connector-flow-grand-1'),
        connectorG2: box('unit-connector-flow-grand-2'),
        connectorOnly: box('unit-connector-flow-only'),
        railRoot: railBox('unit-children-flow-root'),
        stemRoot: pseudo('unit-children-flow-root', '::before'),
        groupRailRoot: pseudo('unit-children-flow-root', '::after'),
        railA: railBox('unit-children-flow-child-a'),
        stemA: pseudo('unit-children-flow-child-a', '::before'),
        railB: railBox('unit-children-flow-child-b'),
        stemB: pseudo('unit-children-flow-child-b', '::before'),
        overflowDisplay: overflowWrap ? getComputedStyle(overflowWrap).display : 'missing',
        cardAWidth: box('unit-card-flow-child-a') ? box('unit-card-flow-child-a').width : 0
      }
    })()`)
  } finally {
    await browser.close()
  }
}

async function measureDesktopGeometry(): Promise<Geometry> {
  return measureFlowchartGeometry({ viewport: { width: 1280, height: 900 }, frameWidth: '720px' })
}

function asBox(value: Box | string | number | null, label: string): Box {
  assert.ok(value && typeof value === 'object', `expected box for ${label}`)
  return value as Box
}

function verticalGap(upperBottom: number, lowerTop: number): number {
  if (lowerTop <= upperBottom) return 0
  return lowerTop - upperBottom
}

function horizontalOverlap(a: Box, b: Box): number {
  return Math.min(a.right, b.right) - Math.max(a.left, b.left)
}

function assertHorizontalIntersection(a: Box, b: Box, label: string) {
  const overlap = horizontalOverlap(a, b)
  assert.ok(
    overlap >= 0,
    `${label} must intersect horizontally (a ${a.left.toFixed(1)}-${a.right.toFixed(1)}, b ${b.left.toFixed(1)}-${b.right.toFixed(1)}, overlap=${overlap.toFixed(1)})`,
  )
}

function assertVerticalSegmentsColinear(a: Box, b: Box, label: string) {
  assertHorizontalIntersection(a, b, label)
  const aMid = (a.left + a.right) / 2
  const bMid = (b.left + b.right) / 2
  assert.ok(
    Math.abs(aMid - bMid) <= 2,
    `${label} stem and stub must share an x, not sit as parallel segments (centers ${aMid.toFixed(1)} vs ${bMid.toFixed(1)})`,
  )
}

function assertConnectorJoinsRailToCard(connector: Box, rail: Box, card: Box, label: string) {
  const railGap = verticalGap(rail.bottom, connector.top)
  const overlapOrTouch = connector.top <= rail.bottom + 2 && rail.top <= connector.bottom + 2
  assert.ok(
    overlapOrTouch && railGap <= 2,
    `${label} connector must meet the rail (rail ${rail.top}-${rail.bottom}, stub ${connector.top}-${connector.bottom}, gap=${railGap})`,
  )
  assertHorizontalIntersection(connector, rail, `${label} stub/rail`)
  assert.ok(
    Math.abs(connector.bottom - card.top) <= 2,
    `${label} connector must meet the card (stub bottom ${connector.bottom} vs card top ${card.top})`,
  )
}

function assertConnectorJoinsStemToCard(connector: Box, stem: Box, card: Box, label: string) {
  assert.ok(
    Math.abs(connector.top - stem.bottom) <= 2,
    `${label} single-child connector must meet the parent stem (stem bottom ${stem.bottom} vs stub top ${connector.top})`,
  )
  assertVerticalSegmentsColinear(stem, connector, `${label} stem/stub`)
  assert.ok(
    Math.abs(connector.bottom - card.top) <= 2,
    `${label} single-child connector must meet the card (stub bottom ${connector.bottom} vs card top ${card.top})`,
  )
}

function assertHorizontalSiblings(left: Box, right: Box, label: string) {
  assert.ok(Math.abs(left.top - right.top) <= 2, `${label} sibling tops must align (got ${left.top} vs ${right.top})`)
  assert.ok(left.right <= right.left + 1, `${label} siblings must sit in a row, not a stack (left.right=${left.right} right.left=${right.left})`)
}

function assertChildUnderParent(child: Box, parent: Box, label: string) {
  assert.ok(child.left >= parent.left - 1, `${label} left ${child.left} is outside parent ${parent.left}`)
  assert.ok(child.right <= parent.right + 1, `${label} right ${child.right} is outside parent ${parent.right}`)
  assert.ok(child.top >= parent.top - 1, `${label} must sit in the parent subtree`)
}

describe('flowchart organization UI', () => {
  it('renders white unit cards with parent-child flowchart connectors', () => {
    const html = renderWorkspace()
    assert.match(html, /data-testid="unit-card-flow-root"[^>]*organization-unit-card/)
    assert.match(html, /data-testid="unit-card-flow-child-a"[^>]*organization-unit-card/)
    assert.match(html, /data-testid="unit-card-flow-child-b"[^>]*organization-unit-card/)
    assert.match(html, /data-testid="unit-card-flow-root"[^>]*bg-white/)
    assert.match(html, /data-testid="unit-children-flow-root"[^>]*organization-unit-children/)
    assert.match(html, /data-testid="unit-connector-flow-child-a"[^>]*organization-flowchart-connector/)
    assert.match(html, /data-testid="unit-connector-flow-child-b"[^>]*organization-flowchart-connector/)
    assert.match(html, /data-testid="unit-connector-flow-grand-1"[^>]*organization-flowchart-connector/)
    assert.match(html, /data-testid="unit-connector-flow-grand-2"[^>]*organization-flowchart-connector/)
    assert.match(html, /data-testid="unit-connector-flow-only"[^>]*organization-flowchart-connector/)
  })

  it('keeps desktop sibling rows nowrap with subtree width and horizontal canvas scroll', () => {
    const css = readFileSync('src/app/globals.css', 'utf8')
    const flowchart = cssRule(css, '.organization-flowchart')
    const node = cssRule(css, '.organization-unit-node')
    const children = cssRule(css, '.organization-unit-children')
    const child = cssRule(css, '.organization-unit-child')
    assert.match(flowchart, /overflow-x:\s*auto/)
    assert.match(flowchart, /max-width:\s*100%/)
    assert.match(node, /width:\s*max-content/)
    assert.match(children, /flex-wrap:\s*nowrap/)
    assert.match(children, /width:\s*max-content/)
    assert.doesNotMatch(children, /flex-wrap:\s*wrap/)
    assert.match(child, /flex:\s*0 0 auto/)
    assert.match(css, /@media \(max-width: 640px\)[\s\S]*flex-wrap:\s*wrap/)
  })

  it('renders desktop sibling geometry: tops aligned, children between parent edges', { timeout: 60_000 }, async () => {
    const g = await measureDesktopGeometry()
    const parent = asBox(g.parent, 'parent')
    const parentCard = asBox(g.parentCard, 'parent card')
    const childA = asBox(g.childA, 'child A')
    const childB = asBox(g.childB, 'child B')
    const childARow = asBox(g.childARow, 'child A row')
    const grand1 = asBox(g.grand1, 'grand 1')
    const grand2 = asBox(g.grand2, 'grand 2')
    const connectorA = asBox(g.connectorA, 'connector A')
    const connectorB = asBox(g.connectorB, 'connector B')

    assertHorizontalSiblings(childA, childB, 'root children')
    assertChildUnderParent(childA, parent, 'child A')
    assertChildUnderParent(childB, parent, 'child B')
    assert.ok(childA.top >= parentCard.bottom - 1, 'child A must sit below the parent card')

    assertHorizontalSiblings(grand1, grand2, 'nested grandchildren')
    assertChildUnderParent(grand1, childARow, 'grand 1')
    assertChildUnderParent(grand2, childARow, 'grand 2')

    const parentCenter = (parentCard.left + parentCard.right) / 2
    assert.ok(connectorA.left < parentCenter + parentCard.width, 'child A connector stays under the parent subtree')
    assert.ok(connectorB.left > parentCenter - parentCard.width, 'child B connector stays under the parent subtree')
    assertChildUnderParent(asBox(g.connectorA, 'connector A'), asBox(g.parent, 'parent'), 'connector A')
    assertChildUnderParent(asBox(g.connectorB, 'connector B'), asBox(g.parent, 'parent'), 'connector B')
    assertChildUnderParent(asBox(g.connectorG1, 'grand connector 1'), asBox(g.childARow, 'child A row'), 'grand connector 1')
    assertChildUnderParent(asBox(g.connectorG2, 'grand connector 2'), asBox(g.childARow, 'child A row'), 'grand connector 2')

    assertConnectorJoinsRailToCard(
      asBox(g.connectorA, 'connector A'),
      asBox(g.railRoot, 'root rail'),
      asBox(g.childA, 'child A'),
      'child A',
    )
    assertConnectorJoinsRailToCard(
      asBox(g.connectorB, 'connector B'),
      asBox(g.railRoot, 'root rail'),
      asBox(g.childB, 'child B'),
      'child B',
    )
    // Rail ENDPOINTS (owner-approved): the rail starts at the FIRST child's
    // stub center and ends at the LAST child's stub center — no overshoot.
    const rootRail = asBox(g.railRoot, 'root rail')
    const stubCenter = (box: Box) => (box.left + box.right) / 2
    assert.ok(
      Math.abs(rootRail.left - stubCenter(asBox(g.connectorA, 'connector A'))) <= 1.5,
      `rail must START at the first child stub center (rail left ${rootRail.left})`,
    )
    assert.ok(
      Math.abs(rootRail.right - stubCenter(asBox(g.connectorB, 'connector B'))) <= 1.5,
      `rail must END at the last child stub center (rail right ${rootRail.right})`,
    )
    assert.equal(g.groupRailRoot, null, 'group-wide rail must not paint on desktop (it dangled past the outer siblings)')
    assertConnectorJoinsRailToCard(
      asBox(g.connectorG1, 'grand connector 1'),
      asBox(g.railA, 'child A rail'),
      asBox(g.grand1, 'grand 1'),
      'grand 1',
    )
    assertConnectorJoinsRailToCard(
      asBox(g.connectorG2, 'grand connector 2'),
      asBox(g.railA, 'child A rail'),
      asBox(g.grand2, 'grand 2'),
      'grand 2',
    )
    assert.equal(g.railB, null, 'single-child branch must not paint a horizontal rail')
    assertConnectorJoinsStemToCard(
      asBox(g.connectorOnly, 'only-child connector'),
      asBox(g.stemB, 'child B stem'),
      asBox(g.onlyChild, 'only child card'),
      'only child',
    )
  })

  it('renders a manager row with initials, short name, position badge; the unassigned list moved into the toolbar chip panel', () => {
    const html = renderWorkspace()
    assert.match(html, /data-testid="unit-manager-flow-child-a"/)
    assert.match(html, /data-testid="manager-avatar-flow-manager"[^>]*>DM<\//)
    // Full label stays on the chip tooltip; the visible chip shows the short
    // name plus a small position badge.
    assert.match(html, /title="Dana Manager — Department manager"/)
    assert.match(html, /data-testid="person-position-flow-manager"[^>]*>\s*Department manager\s*</)
    // The bottom unassigned dock is gone; the toolbar hosts an
    // Unassigned · N chip that opens the list as a manage drawer.
    assert.doesNotMatch(html, /organization-unassigned-dock/)
    const chip = openTagByTestId(html, 'unassigned-dock-toggle')
    assert.match(chip, /aria-expanded="false"/)
    assert.match(html, /Unassigned · 1</)
    const list = renderToStaticMarkup(createElement(UnassignedPeopleList, {
      users: snapshot.unassignedUsers,
    }))
    assert.match(list, /data-testid="unassigned-people-list"[^>]*organization-unassigned-dock/)
    assert.match(list, /data-testid="unassigned-avatar-flow-unassigned"[^>]*>AU<\//)
  })

  it('treats persisted managerUserId null as None even when a manager-ranked person is assigned', () => {
    const html = renderWorkspace()
    assert.doesNotMatch(html, /data-testid="unit-manager-flow-child-b"/)
    assert.match(html, /data-testid="person-chip-flow-ranked"/)
    assert.match(html, /Riley Ranked — Department manager/)
    const row = readFileSync('src/components/organization/TreeNodeRow.tsx', 'utf8')
    assert.match(row, /managerUserId === null/)
    assert.doesNotMatch(row, /includes\('manager'\)/)
  })

  it('constrains compact card names to the name column and uses overflow actions when narrow', () => {
    const html = renderWorkspace()
    const css = readFileSync('src/app/globals.css', 'utf8')
    const nameClass = classOfTestId(html, 'unit-name-flow-child-a')
    assert.match(nameClass, /organization-unit-name/)
    assert.match(nameClass, /min-w-0/)
    assert.match(nameClass, /flex-1/)
    assert.match(nameClass, /overflow-hidden/)
    assert.match(classOfTestId(html, 'unit-header-flow-child-a'), /organization-unit-header/)
    assert.match(html, /data-testid="unit-overflow-flow-child-a"/)
    assert.match(html, /data-testid="unit-hover-actions-flow-child-a"/)

    const nameRule = cssRule(css, '.organization-unit-name')
    assert.match(nameRule, /overflow:\s*hidden/)
    assert.match(nameRule, /min-width:\s*0/)
    assert.match(css, /\[data-testid="inline-name-edit"\][\s\S]*max-width:\s*100%/)
    assert.match(css, /\[data-testid="inline-name-edit-input"\][\s\S]*max-width:\s*100%/)
    assert.match(css, /@container organization-unit-card \(max-width: 30rem\)[\s\S]*organization-unit-header-overflow[\s\S]*display:\s*flex/)
    assert.match(css, /@media \(max-width: 767px\)[\s\S]*organization-unit-header-overflow[\s\S]*display:\s*flex/)

    const actionsClass = classOfTestId(html, 'unit-hover-actions-flow-child-a')
    assert.ok(!/absolute/.test(actionsClass), 'hover actions must stay in flow')
    assert.match(actionsClass, /invisible/)
    assert.match(actionsClass, /opacity-0/)
    assert.match(actionsClass, /group-hover:visible/)
    assert.match(actionsClass, /organization-unit-hover-actions/)
    assert.match(html, /organization-unit-header-overflow/)
  })

  it('keeps compact header labels from overlapping sharing icons', { timeout: 60_000 }, async () => {
    const g = await measureDesktopGeometry()
    const nameA = asBox(g.nameA, 'name A')
    const sharingA = asBox(g.sharingA, 'sharing A')
    assert.ok(
      nameA.right <= sharingA.left + 0.5,
      `name right ${nameA.right} overlaps sharing left ${sharingA.left}`,
    )
    if (g.overflowA && typeof g.overflowA === 'object' && g.overflowA.width > 0) {
      assert.ok(
        nameA.right <= g.overflowA.left + 0.5,
        `name right ${nameA.right} overlaps overflow left ${g.overflowA.left}`,
      )
    }
    if (g.hoverA && typeof g.hoverA === 'object' && g.hoverA.width > 0 && g.hoverA.height > 0) {
      const hoverVisible = g.hoverA.width > 1 && g.hoverA.right - g.hoverA.left > 1
      if (hoverVisible) {
        assert.ok(
          nameA.right <= g.hoverA.left + 0.5,
          `name right ${nameA.right} overlaps hover actions ${g.hoverA.left}`,
        )
      }
    }
  })

  it('exposes overflow actions below md when a fine-pointer card is wider than 24rem', { timeout: 60_000 }, async () => {
    const css = readFileSync('src/app/globals.css', 'utf8')
    const row = readFileSync('src/components/organization/TreeNodeRow.tsx', 'utf8')
    assert.match(row, /max-md:!hidden/)
    assert.match(css, /@media \(max-width: 767px\)[\s\S]*\.organization-unit-header-overflow[\s\S]*display:\s*flex/)
    const g = await measureFlowchartGeometry({ viewport: { width: 500, height: 800 }, frameWidth: '500px' })
    assert.ok(typeof g.cardAWidth === 'number' && g.cardAWidth > 24 * 16, `expected full-width card >24rem, got ${g.cardAWidth}`)
    assert.equal(g.overflowDisplay, 'flex', `overflow must be exposed below md when the card is wider than 24rem (got ${g.overflowDisplay})`)
  })

  it('keeps the manage surface sticky with viewport-bounded internal scrolling', () => {
    const panel = renderToStaticMarkup(createElement(UnitSidePanel, {
      unit: units[1],
      snapshot,
    }))
    assert.match(panel, /data-testid="unit-side-panel"[^>]*sticky/)
    assert.match(panel, /data-testid="unit-side-panel"[^>]*overflow-y-auto/)
    assert.match(panel, /data-testid="unit-side-panel"[^>]*max-h-\[calc\(100vh-2rem\)\]/)

    const workspace = readFileSync('src/components/organization/OrganizationWorkspace.tsx', 'utf8')
    assert.match(workspace, /data-testid="organization-manage-drawer"/)
    assert.match(workspace, /lg:sticky/)
    assert.match(workspace, /overflow-y-auto/)
  })

  it('preserves collapse mounted descendants, queued rename, and person-once teams', () => {
    const row = readFileSync('src/components/organization/TreeNodeRow.tsx', 'utf8')
    assert.match(row, /hidden=\{!expanded\}/)
    assert.match(row, /assignmentsByUserId/)
    assert.match(row, /renameOrganizationUnit/)
    assert.match(row, /InlineNameEdit/)
    const css = readFileSync('src/app/globals.css', 'utf8')
    assert.match(css, /\.organization-unit-children\[hidden\]/)
    assert.match(css, /\.organization-unit-people\[hidden\]/)
    const html = renderWorkspace()
    assert.doesNotMatch(html, /OrgOS|org-os|view-switcher/)
  })
})
