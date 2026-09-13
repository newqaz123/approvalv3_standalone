// Owner-approved org visual polish (atop accepted 2cb7113).
// Contracts:
//  - desktop sibling rail spans ONLY first-child center to last-child center
//    (per-child segments; the group-wide full-width rail is gone on desktop);
//    single-child branches keep the colinear stem/stub join with no rail
//  - vertical stubs meet the child card TOP CENTER
//  - compact header-only cards (no manager, no people) render no empty body;
//    the child stem still leaves the parent card's BOTTOM edge
//  - position badges are tone-coded: manager family = blue, Supervisor/Lead =
//    amber, Staff = emerald, anything else = neutral slate
//  - tree sharing icon = sky when on, solutions wrench = amber when on, off =
//    muted (the unit panel rows share the same tone language)
//  - unit panel title is the unit NAME (no "Manage " prefix)
//  - assignment panel title is the person SHORT name with SEPARATE labeled
//    Unit / Position lines (never one combined gray "Name — Unit" string)
//  - manager dropdown candidates carry name + position (name left, position
//    right in the option row)
// Pure render/source assertions plus short Playwright DOM checks. No Prisma,
// database, env, or write actions.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { chromium, type Page } from '@playwright/test'
import esbuild from 'esbuild'
import postcss from 'postcss'
import tailwindcss from 'tailwindcss'
import autoprefixer from 'autoprefixer'
import type { AssignmentNode, OrganizationUnitNode, PositionNode, TeamNode } from '@/lib/organization/model'
import type { WorkspaceSnapshot } from '@/server-actions/organization'
import { OrganizationWorkspace } from '@/components/organization/OrganizationWorkspace'
import { UnitSidePanel, directManagerCandidates } from '@/components/organization/UnitSidePanel'
import { PersonAssignmentPanel } from '@/components/organization/PersonAssignmentPanel'
import {
  positionBadgeClasses,
  positionToneFor,
} from '@/lib/organization/position-tone'
import {
  UNIT_PATH_SEPARATOR,
  searchUnitRows,
  unitDepthIndent,
  unitPathRows,
} from '@/lib/organization/unit-tree'

const read = (path: string) => readFileSync(path, 'utf8')

// Fixture mirrors the live Admin Division -> GA/QSEC/HR shape including a
// header-only Admin Division (no manager, no people) and a single-child
// QSEC -> QC chain for the colinear join.
const units: OrganizationUnitNode[] = [
  { id: 'vsp-company', name: 'Factory', parentId: null, isActive: true, shareRequests: false, canWorkOnSolutions: false, managerUserId: 'vsp-dana' },
  { id: 'vsp-admin', name: 'Admin Division', parentId: 'vsp-company', isActive: true, shareRequests: true, canWorkOnSolutions: false, managerUserId: null },
  { id: 'vsp-ga', name: 'GA Department', parentId: 'vsp-admin', isActive: true, shareRequests: false, canWorkOnSolutions: false, managerUserId: 'vsp-ga-manager' },
  { id: 'vsp-hr', name: 'HR Department', parentId: 'vsp-admin', isActive: true, shareRequests: false, canWorkOnSolutions: false, managerUserId: null },
  { id: 'vsp-qsec', name: 'QSEC Department', parentId: 'vsp-admin', isActive: true, shareRequests: false, canWorkOnSolutions: true, managerUserId: null },
  { id: 'vsp-qc', name: 'QC Section', parentId: 'vsp-qsec', isActive: true, shareRequests: false, canWorkOnSolutions: false, managerUserId: null },
]

const positions: PositionNode[] = [
  { id: 'vsp-pos-dept-manager', name: 'Department manager', rank: 3, isActive: true },
  { id: 'vsp-pos-section-manager', name: 'Section manager', rank: 3, isActive: true },
  { id: 'vsp-pos-supervisor', name: 'Supervisor', rank: 2, isActive: true },
  { id: 'vsp-pos-staff', name: 'Staff', rank: 1, isActive: true },
]

const assignments: AssignmentNode[] = [
  { id: 'vsp-asg-dana', userId: 'vsp-dana', unitId: 'vsp-company', positionId: 'vsp-pos-dept-manager', teamId: null, isActive: true },
  { id: 'vsp-asg-ga-manager', userId: 'vsp-ga-manager', unitId: 'vsp-ga', positionId: 'vsp-pos-dept-manager', teamId: null, isActive: true },
  { id: 'vsp-asg-ga-staff', userId: 'vsp-ga-staff', unitId: 'vsp-ga', positionId: 'vsp-pos-staff', teamId: null, isActive: true },
  { id: 'vsp-asg-ga-supervisor', userId: 'vsp-ga-supervisor', unitId: 'vsp-ga', positionId: 'vsp-pos-supervisor', teamId: null, isActive: true },
  { id: 'vsp-asg-ga-member', userId: 'vsp-ga-member', unitId: 'vsp-ga', positionId: 'vsp-pos-staff', teamId: 'vsp-team-line', isActive: true },
  { id: 'vsp-asg-qsec-staff', userId: 'vsp-qsec-staff', unitId: 'vsp-qsec', positionId: 'vsp-pos-section-manager', teamId: null, isActive: true },
  { id: 'vsp-asg-hr-staff', userId: 'vsp-hr-staff', unitId: 'vsp-hr', positionId: 'vsp-pos-staff', teamId: null, isActive: true },
]

const teams: TeamNode[] = [
  { id: 'vsp-team-line', name: 'GA Line Team', unitId: 'vsp-ga', reportsToAssignmentId: 'vsp-asg-ga-manager', isActive: true },
]

const users: WorkspaceSnapshot['users'] = [
  { id: 'vsp-dana', name: 'Dana Manager', email: 'dana@example.com', role: 'general_dept', isActive: true },
  { id: 'vsp-ga-manager', name: 'Mock Department Manager — GA', email: 'ga-manager@example.com', role: 'general_dept', isActive: true },
  { id: 'vsp-ga-staff', name: 'Mock Staff 1 — GA', email: 'ga-staff@example.com', role: 'general_dept', isActive: true },
  { id: 'vsp-ga-supervisor', name: 'Mock Supervisor — GA', email: 'ga-supervisor@example.com', role: 'general_dept', isActive: true },
  { id: 'vsp-ga-member', name: 'Mock Member — GA', email: 'ga-member@example.com', role: 'general_dept', isActive: true },
  { id: 'vsp-qsec-staff', name: 'Mock Section Manager — QSEC', email: 'qsec-staff@example.com', role: 'general_dept', isActive: true },
  { id: 'vsp-hr-staff', name: 'Mock HR Staff — HR', email: 'hr-staff@example.com', role: 'general_dept', isActive: true },
]

const snapshot: WorkspaceSnapshot = {
  units,
  positions,
  assignments,
  teams,
  users,
  unassignedUsers: [],
  routeSources: [],
  customChainExceptions: [],
  readiness: { ready: true, blockers: [] },
}

function renderWorkspace(): string {
  return renderToStaticMarkup(createElement(OrganizationWorkspace, { snapshot }))
}

function openTag(html: string, testId: string): string {
  const marker = `data-testid="${testId}"`
  const attr = html.indexOf(marker)
  assert.ok(attr >= 0, `missing data-testid="${testId}"`)
  const open = html.lastIndexOf('<', attr)
  return html.slice(open, html.indexOf('>', attr) + 1)
}

function innerByTestId(html: string, testId: string): string {
  const tag = openTag(html, testId)
  const tagMatch = /^<([a-zA-Z0-9]+)/.exec(tag)
  assert.ok(tagMatch, `could not parse tag for ${testId}`)
  const name = tagMatch[1]
  const afterOpen = html.indexOf(tag) + tag.length
  let depth = 1
  let i = afterOpen
  while (i < html.length && depth > 0) {
    const nextOpen = html.indexOf(`<${name}`, i)
    const nextClose = html.indexOf(`</${name}>`, i)
    if (nextClose < 0) {
      throw new Error(`unclosed ${testId}`)
    }
    if (nextOpen >= 0 && nextOpen < nextClose) {
      depth += 1
      i = nextOpen + name.length + 1
    } else {
      depth -= 1
      if (depth === 0) return html.slice(afterOpen, nextClose)
      i = nextClose + name.length + 3
    }
  }
  throw new Error(`unclosed ${testId}`)
}

function classOfTestId(html: string, testId: string): string {
  const match = /class="([^"]*)"/.exec(openTag(html, testId))
  assert.ok(match, `no class attribute on ${testId}`)
  return match[1]
}

let compiledCssPromise: Promise<string> | null = null

async function compiledApplicationCss(): Promise<string> {
  if (!compiledCssPromise) {
    compiledCssPromise = postcss([tailwindcss(), autoprefixer])
      .process(read('src/app/globals.css'), { from: 'src/app/globals.css' })
      .then((result) => result.css)
  }
  return compiledCssPromise
}

async function withWorkspaceDom(frameWidth: string, run: (page: Page) => Promise<void>): Promise<void> {
  const css = await compiledApplicationCss()
  const html = renderWorkspace()
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    await page.setContent(`<!DOCTYPE html><html><head><style>${css}</style></head><body>
      <div style="width:${frameWidth};max-width:${frameWidth};">${html}</div>
    </body></html>`)
    await run(page)
  } finally {
    await browser.close()
  }
}

describe('sibling rail endpoints', () => {
  it('spans only first-child center to last-child center with no overshoot (desktop)', { timeout: 60_000 }, async () => {
    const css = read('src/app/globals.css')
    // The group-wide rail is gone on desktop: the rail is drawn per child.
    const groupRule = css.match(/(?:^|\n)\.organization-unit-children::after\s*\{[^}]*\}/)
    assert.ok(groupRule, 'group rail rule must exist (mobile still uses it)')
    assert.match(groupRule[0], /display:\s*none/, 'desktop must not paint the group-wide rail')
    // The rail is drawn as two chained half-segments per child: a non-first
    // child draws [left edge, center] and a non-last child draws [center,
    // right edge + gap]. Chained, they span exactly first-child center →
    // last-child center with no overshoot.
    const leftHalfRule = css.match(/(?:^|\n)\.organization-unit-child:not\(:first-child\)::before\s*\{[^}]*\}/)
    assert.ok(leftHalfRule, 'left rail half rule must exist')
    assert.match(leftHalfRule[0], /left:\s*0/)
    assert.match(leftHalfRule[0], /width:\s*50%/, 'left half spans the wrapper start to its own center')
    const rightHalfRule = css.match(/(?:^|\n)\.organization-unit-child:not\(:last-child\)::after\s*\{[^}]*\}/)
    assert.ok(rightHalfRule, 'right rail half rule must exist')
    assert.match(rightHalfRule[0], /left:\s*50%/, 'right half starts at the child center')
    assert.match(rightHalfRule[0], /width:\s*calc\(\s*50%\s*\+\s*1rem\s*\)/, 'right half reaches the next wrapper across the 1rem gap')

    await withWorkspaceDom('760px', async (page) => {
      // Anonymous inline expressions only: page.evaluate serializes this
      // source, so named inner functions are not allowed here.
      // Anonymous inline expressions only: page.evaluate serializes this
      // source, so it must be a plain string with no named inner functions.
      const facts: {
        groupRailPainted: boolean
        segmentCount: number
        firstHasLeftHalf: boolean
        firstHasRightHalf: boolean
        lastHasLeftHalf: boolean
        lastHasRightHalf: boolean
        rail: { left: number; right: number } | null
        gaStubCenterX: number | null
        hrStubCenterX: number | null
        qsecStubCenterX: number | null
        gaCardCenterX: number | null
        hrCardCenterX: number | null
        qsecCardCenterX: number | null
      } | null = await page.evaluate(`(() => {
        const usedPx = (value) => {
          if (!value || value === 'auto') return 0
          const parsed = parseFloat(String(value).trim())
          return Number.isFinite(parsed) ? parsed : 0
        }
        const segmentOf = (wrapper, name) => {
          const cs = getComputedStyle(wrapper, name)
          if (cs.display === 'none' || cs.content === 'none') return null
          const r = wrapper.getBoundingClientRect()
          const host = getComputedStyle(wrapper)
          const left = r.left + (parseFloat(host.borderLeftWidth) || 0) + usedPx(cs.left)
          const top = r.top + (parseFloat(host.borderTopWidth) || 0) + usedPx(cs.top)
          const width = parseFloat(cs.width)
          const height = parseFloat(cs.height)
          if (!Number.isFinite(width) || !Number.isFinite(height) || height === 0) return null
          return { left, right: left + width, top, bottom: top + height }
        }
        const centerX = (selector) => {
          const el = document.querySelector(selector)
          if (!el) return null
          const r = el.getBoundingClientRect()
          return (r.left + r.right) / 2
        }
        const group = document.querySelector('[data-testid="unit-children-vsp-admin"]')
        if (!group) return null
        const wrappers = Array.from(group.querySelectorAll(':scope > .organization-unit-child'))
        const drawn = wrappers
          .flatMap((wrapper) => [segmentOf(wrapper, '::before'), segmentOf(wrapper, '::after')])
          .filter(Boolean)
        const rail = drawn.length > 0
          ? {
              left: Math.min(...drawn.map((seg) => seg.left)),
              right: Math.max(...drawn.map((seg) => seg.right)),
            }
          : null
        const painted = (cs) => !(cs.display === 'none' || cs.content === 'none')
        const groupAfter = getComputedStyle(group, '::after')
        const firstWrapper = wrappers[0]
        const lastWrapper = wrappers[wrappers.length - 1]
        return {
          groupRailPainted: painted(groupAfter),
          segmentCount: drawn.length,
          firstHasRightHalf: painted(getComputedStyle(firstWrapper, '::after')),
          firstHasLeftHalf: painted(getComputedStyle(firstWrapper, '::before')),
          lastHasLeftHalf: painted(getComputedStyle(lastWrapper, '::before')),
          lastHasRightHalf: painted(getComputedStyle(lastWrapper, '::after')),
          rail,
          gaStubCenterX: centerX('[data-testid="unit-connector-vsp-ga"]'),
          hrStubCenterX: centerX('[data-testid="unit-connector-vsp-hr"]'),
          qsecStubCenterX: centerX('[data-testid="unit-connector-vsp-qsec"]'),
          gaCardCenterX: centerX('[data-testid="unit-card-vsp-ga"]'),
          hrCardCenterX: centerX('[data-testid="unit-card-vsp-hr"]'),
          qsecCardCenterX: centerX('[data-testid="unit-card-vsp-qsec"]'),
        }
      })()`)
      assert.ok(facts, 'admin sibling group must render')
      const gaStubCenterX = facts.gaStubCenterX
      const hrStubCenterX = facts.hrStubCenterX
      const qsecStubCenterX = facts.qsecStubCenterX
      const gaCardCenterX = facts.gaCardCenterX
      const hrCardCenterX = facts.hrCardCenterX
      const qsecCardCenterX = facts.qsecCardCenterX
      const railBoxFacts = facts.rail
      if (
        gaStubCenterX === null || hrStubCenterX === null || qsecStubCenterX === null
        || gaCardCenterX === null || hrCardCenterX === null || qsecCardCenterX === null
        || railBoxFacts === null
      ) {
        assert.fail('rail/stub/card measurements must all render')
      }
      // Three siblings: GA (first), HR (middle), QSEC (last).
      assert.equal(facts.groupRailPainted, false, 'group-wide rail must not paint on desktop (no overshoot past GA/QSEC)')
      assert.equal(facts.segmentCount, 4, 'three siblings draw exactly 2n-2 half-segments')
      assert.equal(facts.firstHasLeftHalf, false, 'the first child draws no left half')
      assert.equal(facts.firstHasRightHalf, true, 'the first child starts the rail rightward')
      assert.equal(facts.lastHasLeftHalf, true, 'the last child finishes the rail from its left')
      assert.equal(facts.lastHasRightHalf, false, 'the last child draws no right half (no overshoot)')
      assert.ok(facts.rail, 'a rail must be drawn')
      assert.ok(
        Math.abs(railBoxFacts.left - gaStubCenterX) <= 1.5,
        `rail must START at the first-child stub center (rail left ${railBoxFacts.left} vs GA stub ${gaStubCenterX})`,
      )
      assert.ok(
        Math.abs(railBoxFacts.right - qsecStubCenterX) <= 1.5,
        `rail must END at the last-child stub center (rail right ${railBoxFacts.right} vs QSEC stub ${qsecStubCenterX})`,
      )
      // Continuity through the middle child: HR's stub joins both halves.
      assert.ok(
        Math.abs(gaStubCenterX - gaCardCenterX) <= 1,
        'GA stub must meet the GA card top center',
      )
      assert.ok(
        Math.abs(hrStubCenterX - hrCardCenterX) <= 1,
        'HR stub must meet the HR card top center',
      )
      assert.ok(
        Math.abs(qsecStubCenterX - qsecCardCenterX) <= 1,
        'QSEC stub must meet the QSEC card top center',
      )
    })
  })

  it('keeps the single-child branch colinear with no horizontal rail', { timeout: 60_000 }, async () => {
    await withWorkspaceDom('760px', async (page) => {
      const facts: {
        segmentPainted: boolean
        stemCenterX: number
        stubCenterX: number
        stubBottom: number
        cardTop: number
      } | null = await page.evaluate(`(() => {
        const usedPx = (value) => {
          if (!value || value === 'auto') return 0
          const parsed = parseFloat(String(value).trim())
          return Number.isFinite(parsed) ? parsed : 0
        }
        const group = document.querySelector('[data-testid="unit-children-vsp-qsec"]')
        const stem = group ? getComputedStyle(group, '::before') : null
        const wrapper = group ? group.querySelector(':scope > .organization-unit-child') : null
        const segment = wrapper ? getComputedStyle(wrapper, '::after') : null
        const segmentBefore = wrapper ? getComputedStyle(wrapper, '::before') : null
        const stub = document.querySelector('[data-testid="unit-connector-vsp-qc"]')
        const card = document.querySelector('[data-testid="unit-card-vsp-qc"]')
        if (!group || !stem || !wrapper || !stub || !card) return null
        const groupRect = group.getBoundingClientRect()
        const stemLeft = groupRect.left + usedPx(stem.left)
        const stemRight = stemLeft + parseFloat(stem.width)
        const stubRect = stub.getBoundingClientRect()
        const cardRect = card.getBoundingClientRect()
        return {
          segmentPainted: !((segment.display === 'none' || segment.content === 'none')
            && (segmentBefore.display === 'none' || segmentBefore.content === 'none')),
          stemCenterX: (stemLeft + stemRight) / 2,
          stubCenterX: (stubRect.left + stubRect.right) / 2,
          stubBottom: stubRect.bottom,
          cardTop: cardRect.top,
        }
      })()`)
      assert.ok(facts, 'single-child chain must render')
      assert.equal(facts.segmentPainted, false, 'a single child must not draw a horizontal rail segment')
      assert.ok(
        Math.abs(facts.stemCenterX - facts.stubCenterX) <= 2,
        `stem and stub must stay colinear (${facts.stemCenterX} vs ${facts.stubCenterX})`,
      )
      assert.ok(
        Math.abs(facts.stubBottom - facts.cardTop) <= 1,
        `stub must meet the child card top (${facts.stubBottom} vs ${facts.cardTop})`,
      )
    })
  })
})

describe('compact header-only cards', () => {
  it('renders no empty body for a unit without manager or people', () => {
    const html = renderWorkspace()
    assert.ok(
      !html.includes('data-testid="unit-people-vsp-admin"'),
      'header-only Admin Division must not render an empty people body',
    )
    // Units with people keep their body.
    assert.match(html, /data-testid="unit-people-vsp-ga"/)
  })

  it('keeps the card compact and the stem leaving the BOTTOM edge', { timeout: 60_000 }, async () => {
    await withWorkspaceDom('760px', async (page) => {
      const facts: {
        adminHeight: number
        gaHeight: number
        childrenTop: number
        adminBottom: number
        stubTop: number
      } | null = await page.evaluate(`(() => {
        const adminCard = document.querySelector('[data-testid="unit-card-vsp-admin"]')
        const gaCard = document.querySelector('[data-testid="unit-card-vsp-ga"]')
        const children = document.querySelector('[data-testid="unit-children-vsp-admin"]')
        const stub = document.querySelector('[data-testid="unit-connector-vsp-ga"]')
        if (!adminCard || !gaCard || !children || !stub) return null
        return {
          adminHeight: adminCard.getBoundingClientRect().height,
          gaHeight: gaCard.getBoundingClientRect().height,
          childrenTop: children.getBoundingClientRect().top,
          adminBottom: adminCard.getBoundingClientRect().bottom,
          stubTop: stub.getBoundingClientRect().top,
        }
      })()`)
      assert.ok(facts, 'admin/ga cards must render')
      assert.ok(
        facts.adminHeight < facts.gaHeight - 20,
        `header-only card must be clearly more compact than a people card (${facts.adminHeight} vs ${facts.gaHeight})`,
      )
      const gap = facts.childrenTop - facts.adminBottom
      assert.ok(
        gap >= 23,
        `children box must sit a stem-height below the compact card bottom (got ${gap}px)`,
      )
      assert.ok(
        facts.stubTop >= facts.adminBottom - 1,
        `stem must start AT the compact card's bottom edge, not inside it (${facts.stubTop} vs ${facts.adminBottom})`,
      )
    })
  })
})

describe('position badge tones', () => {
  it('classifies positions: manager family blue, Supervisor/Lead amber, Staff emerald, rest slate', () => {
    assert.equal(positionToneFor('Manager'), 'manager')
    assert.equal(positionToneFor('Department manager'), 'manager')
    assert.equal(positionToneFor('Section manager'), 'manager')
    assert.equal(positionToneFor('Supervisor'), 'lead')
    assert.equal(positionToneFor('Lead'), 'lead')
    assert.equal(positionToneFor('Staff'), 'staff')
    assert.equal(positionToneFor('Director'), 'neutral')
    assert.equal(positionToneFor('Contractor'), 'neutral')

    assert.match(positionBadgeClasses('Manager'), /blue/)
    assert.match(positionBadgeClasses('Department manager'), /blue/)
    assert.match(positionBadgeClasses('Supervisor'), /amber/)
    assert.match(positionBadgeClasses('Lead'), /amber/)
    assert.match(positionBadgeClasses('Staff'), /emerald/)
    assert.match(positionBadgeClasses('Director'), /slate/)
  })

  it('tones the rendered chips: manager blue, supervisor amber, staff + team member emerald', () => {
    const html = renderWorkspace()
    const managerBadge = classOfTestId(html, 'person-position-vsp-ga-manager')
    assert.match(managerBadge, /bg-blue-100/, 'manager badge must be blue')
    assert.match(managerBadge, /text-blue-800/)
    const supervisorBadge = classOfTestId(html, 'person-position-vsp-ga-supervisor')
    assert.match(supervisorBadge, /bg-amber-100/, 'supervisor badge must be amber')
    assert.match(supervisorBadge, /text-amber-800/)
    const staffBadge = classOfTestId(html, 'person-position-vsp-ga-staff')
    assert.match(staffBadge, /bg-emerald-100/, 'staff badge must be emerald')
    assert.match(staffBadge, /text-emerald-800/)
    const memberBadge = classOfTestId(html, 'team-member-position-vsp-ga-member')
    assert.match(memberBadge, /bg-emerald-100/, 'team member badge shares the staff tone')
    const sectionBadge = classOfTestId(html, 'person-position-vsp-qsec-staff')
    assert.match(sectionBadge, /bg-blue-100/, 'section manager badge must be blue')
  })
})

describe('flag icon tones', () => {
  it('colors tree icons when on: sharing sky, solutions amber', () => {
    const html = renderWorkspace()
    const sharing = classOfTestId(html, 'sharing-badge-vsp-admin')
    assert.match(sharing, /sky/, 'sharing icon must be sky when on')
    const solutions = classOfTestId(html, 'solutions-badge-vsp-qsec')
    assert.match(solutions, /amber/, 'solutions icon must be amber when on')
  })

  it('unit panel rows share the tone language: on = colored, off = muted', () => {
    const adminPanel = renderToStaticMarkup(createElement(UnitSidePanel, { unit: units[1], snapshot }))
    const adminRows = adminPanel
    assert.match(adminRows, /data-testid="unit-share-requests"/)
    // Admin has sharing ON and solutions OFF.
    const sharingRow = adminRowOf(adminRows, 'unit-share-requests')
    assert.match(sharingRow, /sky/, 'sharing row icon must be sky when on')
    const solutionsRow = adminRowOf(adminRows, 'unit-can-work-on-solutions')
    assert.match(solutionsRow, /muted-foreground/, 'solutions row icon must be muted when off')

    const qsecPanel = renderToStaticMarkup(createElement(UnitSidePanel, { unit: units[4], snapshot }))
    const qsecSolutions = adminRowOf(qsecPanel, 'unit-can-work-on-solutions')
    assert.match(qsecSolutions, /amber/, 'solutions row icon must be amber when on')
    const qsecSharing = adminRowOf(qsecPanel, 'unit-share-requests')
    assert.match(qsecSharing, /muted-foreground/, 'sharing row icon must be muted when off')
  })
})

function adminRowOf(panelHtml: string, switchTestId: string): string {
  // The toggle row is the bordered flex row that contains the labeled switch.
  const attr = panelHtml.indexOf(`data-testid="${switchTestId}"`)
  assert.ok(attr >= 0, `missing data-testid="${switchTestId}"`)
  const rowStart = panelHtml.lastIndexOf('<div', attr)
  const rowEnd = panelHtml.indexOf('</div>', attr)
  return panelHtml.slice(rowStart, rowEnd)
}

describe('unit tree path picker (assign-person unit dropdown)', () => {
  it('builds depth-first rows with depth and full path', () => {
    const rows = unitPathRows(units)
    const qc = rows.find((row) => row.unit.id === 'vsp-qc')
    assert.ok(qc)
    assert.equal(qc.depth, 3)
    assert.equal(
      qc.path,
      `Factory${UNIT_PATH_SEPARATOR}Admin Division${UNIT_PATH_SEPARATOR}QSEC Department${UNIT_PATH_SEPARATOR}QC Section`,
    )
    const admin = rows.find((row) => row.unit.id === 'vsp-admin')
    assert.ok(admin)
    assert.equal(admin.depth, 1)
    assert.equal(admin.path, `Factory${UNIT_PATH_SEPARATOR}Admin Division`)
    // Siblings stay name-sorted: GA < HR < QSEC under Admin Division.
    const adminChildren = rows.filter((row) => row.unit.parentId === 'vsp-admin').map((row) => row.unit.name)
    assert.deepEqual(adminChildren, ['GA Department', 'HR Department', 'QSEC Department'])
  })

  it('searches by own or ancestor name; empty query matches all; indent grows with depth', () => {
    const rows = unitPathRows(units)
    assert.equal(searchUnitRows(rows, '').length, rows.length)
    const byAncestor = searchUnitRows(rows, 'admin')
    assert.ok(byAncestor.some((row) => row.unit.id === 'vsp-qc'), 'ancestor name must match descendants')
    const byOwn = searchUnitRows(rows, 'QC Section')
    assert.ok(byOwn.every((row) => row.unit.id === 'vsp-qc'))
    assert.equal(searchUnitRows(rows, 'zzz-not-a-unit').length, 0)
    assert.equal(unitDepthIndent(0), 0)
    assert.equal(unitDepthIndent(2), 28)
    assert.equal(unitDepthIndent(-1), 0)
  })

  it('renders the combobox trigger and keeps the assignment-unit-select seam', () => {
    const html = renderToStaticMarkup(createElement(PersonAssignmentPanel, {
      snapshot,
      assignmentId: 'vsp-asg-ga-staff',
    }))
    const trigger = openTag(html, 'assignment-unit-select')
    assert.match(trigger, /role="combobox"/)
    assert.match(trigger, /aria-expanded="false"/)
    // The closed trigger shows the selected unit's full tree path.
    assert.match(
      html,
      new RegExp(`Factory${UNIT_PATH_SEPARATOR}Admin Division${UNIT_PATH_SEPARATOR}GA Department`),
    )
  })

  it('wires the workspace unit select to the tree picker (source contract)', () => {
    const source = read('src/components/organization/PersonAssignmentPanel.tsx')
    assert.match(source, /UnitTreeSelect/)
    assert.match(source, /units=\{activeUnits\}/)
    assert.match(source, /onChange=\{handleUnitChange\}/)
    const picker = read('src/components/organization/UnitTreeSelect.tsx')
    assert.match(picker, /searchUnitRows/)
    assert.match(picker, /unitDepthIndent/)
    assert.match(picker, /aria-label=\{row\.unit\.name\}/, 'option accessible name stays the clean unit name')
  })
})

describe('unassigned chip panel + sticky zoom toolbar', () => {
  it('removes the bottom dock and hosts an Unassigned · N chip in the sticky toolbar', () => {
    const html = renderWorkspace()
    // Bottom dock gone from the page; the list only renders inside the panel.
    assert.doesNotMatch(html, /organization-unassigned-dock/)
    const chip = openTag(html, 'unassigned-dock-toggle')
    assert.match(chip, /aria-expanded="false"/)
    assert.match(chip, /aria-label="Unassigned people"/)
    const workspace = innerByTestId(html, 'organization-workspace')
    assert.match(workspace, /Unassigned · \d+/)
    const toolbar = openTag(html, 'flowchart-zoom-toolbar')
    // Sticky: always visible at the top while the canvas/page scroll.
    assert.match(toolbar, /sticky/)
    assert.match(toolbar, /top-0/)
    assert.match(toolbar, /z-20/)
  })

  it('keeps the ZoomableFlowchart toolbarExtras seam (source contract)', () => {
    const flowchart = read('src/components/organization/ZoomableFlowchart.tsx')
    assert.match(flowchart, /toolbarExtras/)
    const workspace = read('src/components/organization/OrganizationWorkspace.tsx')
    assert.match(workspace, /unassigned-dock-toggle/)
    assert.match(workspace, /setUnassignedPanelOpen/)
  })
})

describe('drawer heading split', () => {
  it('titles the unit panel with the unit name (no Manage prefix)', () => {
    const html = renderToStaticMarkup(createElement(UnitSidePanel, { unit: units[2], snapshot }))
    assert.match(html, /<h2[^>]*>GA Department<\/h2>/)
    assert.doesNotMatch(html, /Manage GA/)
    const source = read('src/components/organization/UnitSidePanel.tsx')
    assert.doesNotMatch(source, /Manage \$\{/, 'unit panel must not prefix Manage in the title')
  })

  it('titles the assignment panel with the person short name plus separate Unit/Position lines', () => {
    const html = renderToStaticMarkup(createElement(PersonAssignmentPanel, {
      snapshot,
      assignmentId: 'vsp-asg-ga-staff',
    }))
    // Title is the short name only; the combined gray "Name — Unit" line is gone.
    assert.match(html, /<h2[^>]*>Mock Staff 1<\/h2>/)
    assert.doesNotMatch(html, /Mock Staff 1 — GA/)
    // Separate labeled subtitle fields: Unit vs Position.
    assert.match(html, /data-testid="assignment-subtitle-unit"[^>]*>\s*<span[^>]*>Unit:<\/span>\s*GA Department/)
    assert.match(html, /data-testid="assignment-subtitle-position"[^>]*>\s*<span[^>]*>Position:<\/span>\s*Staff/)
  })

  it('keeps the assign-mode heading and shows the short name as subtitle', () => {
    const html = renderToStaticMarkup(createElement(PersonAssignmentPanel, {
      snapshot,
      userId: 'vsp-hr-staff',
    }))
    assert.match(html, /<h2[^>]*>Assign person<\/h2>/)
    assert.match(html, /Mock HR Staff</)
    assert.doesNotMatch(html, /Mock HR Staff — HR/)
  })

  it('manager dropdown candidates carry name + position for a name-left/position-right row', () => {
    const candidates = directManagerCandidates(snapshot, 'vsp-ga')
    const manager = candidates.find((row) => row.userId === 'vsp-ga-manager')
    assert.ok(manager, 'GA manager must be a candidate')
    assert.equal(manager.name, 'Mock Department Manager — GA')
    assert.equal(manager.positionName, 'Department manager')
    const member = candidates.find((row) => row.userId === 'vsp-ga-member')
    assert.ok(member, 'team member is an active direct assignee and stays a candidate')
    assert.equal(member.positionName, 'Staff')

    const source = read('src/components/organization/UnitSidePanel.tsx')
    // The option row places the short name left and the position right.
    assert.match(source, /personShortName\(candidate\.name\)/)
    assert.match(source, /justify-between/, 'option row must separate name and position')
  })
})

describe('exactly one management drawer', () => {
  // P1 regression: the Unassigned chip previously only toggled
  // unassignedPanelOpen, so clicking it while a unit/person/team drawer was
  // open rendered TWO manage drawers side by side (live screenshot in the
  // visual-polish review). Opening any manage drawer is a selection: it must
  // close the others. Verified against the REAL hydrated OrganizationWorkspace
  // (offline chromium harness; no dev server, no database, no writes).
  it('opening Unassigned closes the unit/person/team drawer and vice versa', { timeout: 180_000 }, async () => {
    const css = await compiledApplicationCss()
    await esbuild.build({
      entryPoints: ['tests/regression/fixtures/unassigned-drawer-harness.ts'],
      bundle: true,
      format: 'iife',
      platform: 'browser',
      outfile: 'test-results/orgpolishfix1-unassigned-drawer-harness.js',
      alias: {
        '@': `${process.cwd()}/src`,
        '@/server-actions/organization': `${process.cwd()}/tests/regression/fixtures/server-actions-browser-stub.ts`,
      },
      define: { 'process.env.NODE_ENV': '"production"' },
      logLevel: 'silent',
    })
    const browser = await chromium.launch({ headless: true })
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
      // The dev bundle references the `process` global (next/link et al), so
      // shim it before the harness bundle runs.
      await page.setContent(`<!DOCTYPE html><html><head>
        <script>window.process = { env: { NODE_ENV: 'production' } };</script>
        <style>${css}</style>
      </head><body>
        <div data-testid="unassigned-drawer-harness-root" style="width:1280px;max-width:1280px;"></div>
      </body></html>`)
      await page.addScriptTag({ path: 'test-results/orgpolishfix1-unassigned-drawer-harness.js' })
      await page.waitForSelector('[data-testid="unassigned-dock-toggle"]', { timeout: 30_000 })

      const drawers = () => page.evaluate(() => ({
        count: document.querySelectorAll('[data-testid="organization-manage-drawer"]').length,
        unassigned: !!document.querySelector('[data-testid="unassigned-people-list"]'),
        unit: !!document.querySelector('[data-testid="unit-side-panel"]'),
        person: !!document.querySelector('[data-testid="person-assignment-panel"]'),
        team: !!document.querySelector('[data-testid="team-panel"]'),
      }))
      const chipExpanded = () => page.getByTestId('unassigned-dock-toggle').getAttribute('aria-expanded')

      assert.deepEqual(await drawers(), { count: 0, unassigned: false, unit: false, person: false, team: false })

      // Unit drawer opens alone.
      await page.getByTestId('unit-header-udh-ga').click()
      assert.deepEqual(await drawers(), { count: 1, unassigned: false, unit: true, person: false, team: false })

      // THE FIX: the Unassigned chip takes over — exactly one drawer remains.
      await page.getByTestId('unassigned-dock-toggle').click()
      assert.deepEqual(await drawers(), { count: 1, unassigned: true, unit: false, person: false, team: false })
      assert.equal(await chipExpanded(), 'true')

      // A person selection closes Unassigned again.
      await page.getByTestId('person-chip-udh-ga-staff').locator('button').first().click()
      assert.deepEqual(await drawers(), { count: 1, unassigned: false, unit: false, person: true, team: false })
      assert.equal(await chipExpanded(), 'false')

      // Back to Unassigned from the person drawer.
      await page.getByTestId('unassigned-dock-toggle').click()
      assert.deepEqual(await drawers(), { count: 1, unassigned: true, unit: false, person: false, team: false })

      // A team selection closes Unassigned.
      await page.getByTestId('team-select-udh-team-line').click()
      assert.deepEqual(await drawers(), { count: 1, unassigned: false, unit: false, person: false, team: true })
      assert.equal(await chipExpanded(), 'false')

      // Back to Unassigned from the team drawer.
      await page.getByTestId('unassigned-dock-toggle').click()
      assert.deepEqual(await drawers(), { count: 1, unassigned: true, unit: false, person: false, team: false })

      // A unit selection closes Unassigned (reverse direction).
      await page.getByTestId('unit-header-udh-ga').click()
      assert.deepEqual(await drawers(), { count: 1, unassigned: false, unit: true, person: false, team: false })
      assert.equal(await chipExpanded(), 'false')
    } finally {
      await browser.close()
    }
  })
})
