// Flowchart readability restyle + single-canvas tabs + flowchart zoom.
// Contracts:
//  - unit card titles show the full unit name at desktop card width (wrap,
//    wider cards, larger type, full-name tooltip) instead of "Adm…" ellipsis
//  - one MANAGER row holds only the persisted unit manager; other assignees
//    are listed separately under their own People heading
//  - people chips show a short label + small position badge; full name stays
//    on the title tooltip; each people row is one line with the name on the
//    left and the position on the right (never a wrapped chip)
//  - darker flowchart connectors
//  - child stems leave the parent card's BOTTOM edge and meet the child card
//    top without crossing the parent card body
//  - /admin/organization renders exactly one canvas per panel (tabs)
//  - the Organization tab zooms the flowchart (+ / − / percent / Fit) without
//    scaling the manage drawer; Fit places BOTH tree edges inside the frame,
//    may drop below the manual 25% minimum, and the height shim tracks the
//    natural tree size (collapse/title rewrap) via ResizeObserver
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
import { OrganizationTabs } from '@/components/organization/OrganizationTabs'
import { ZoomableFlowchart, ZOOM_MIN, clampZoom, fitScaleFor } from '@/components/organization/ZoomableFlowchart'
import { OrganizationTree } from '@/components/organization/OrganizationTree'

// Fixture mirrors the live shapes called out in the readability report:
// Factory -> Admin Division -> GA Department / QSEC Department -> QC Section.
const units: OrganizationUnitNode[] = [
  { id: 'rd-company', name: 'Factory', parentId: null, isActive: true, shareRequests: false, canWorkOnSolutions: false, managerUserId: 'rd-dana' },
  { id: 'rd-admin', name: 'Admin Division', parentId: 'rd-company', isActive: true, shareRequests: true, canWorkOnSolutions: false, managerUserId: null },
  { id: 'rd-ga', name: 'GA Department', parentId: 'rd-admin', isActive: true, shareRequests: false, canWorkOnSolutions: false, managerUserId: 'rd-ga-manager' },
  { id: 'rd-qsec', name: 'QSEC Department', parentId: 'rd-admin', isActive: true, shareRequests: false, canWorkOnSolutions: true, managerUserId: null },
  { id: 'rd-qc', name: 'QC Section', parentId: 'rd-qsec', isActive: true, shareRequests: false, canWorkOnSolutions: false, managerUserId: null },
  { id: 'rd-eng', name: 'Engineering Department', parentId: 'rd-ga', isActive: true, shareRequests: false, canWorkOnSolutions: false, managerUserId: null },
  { id: 'rd-maint', name: 'Maintenance Section', parentId: 'rd-eng', isActive: true, shareRequests: false, canWorkOnSolutions: false, managerUserId: null },
  // Extra roots make the tree wider than a narrow frame so Fit must reduce.
  { id: 'rd-site-b', name: 'Site B Warehouse', parentId: null, isActive: true, shareRequests: false, canWorkOnSolutions: false, managerUserId: null },
  { id: 'rd-site-c', name: 'Site C Depot', parentId: null, isActive: true, shareRequests: false, canWorkOnSolutions: false, managerUserId: null },
]

const positions: PositionNode[] = [
  { id: 'rd-pos-dept-manager', name: 'Department manager', rank: 3, isActive: true },
  { id: 'rd-pos-section-manager', name: 'Section manager', rank: 3, isActive: true },
  { id: 'rd-pos-supervisor', name: 'Supervisor', rank: 2, isActive: true },
  { id: 'rd-pos-staff', name: 'Staff', rank: 1, isActive: true },
]

const assignments: AssignmentNode[] = [
  { id: 'rd-asg-dana', userId: 'rd-dana', unitId: 'rd-company', positionId: 'rd-pos-dept-manager', teamId: null, isActive: true },
  { id: 'rd-asg-ga-manager', userId: 'rd-ga-manager', unitId: 'rd-ga', positionId: 'rd-pos-dept-manager', teamId: null, isActive: true },
  { id: 'rd-asg-ga-staff', userId: 'rd-ga-staff', unitId: 'rd-ga', positionId: 'rd-pos-staff', teamId: null, isActive: true },
  // Supervisor rank but NOT the persisted manager: never under MANAGER.
  { id: 'rd-asg-ga-supervisor', userId: 'rd-ga-supervisor', unitId: 'rd-ga', positionId: 'rd-pos-supervisor', teamId: null, isActive: true },
  // Team member nested under the GA manager chip.
  { id: 'rd-asg-ga-member', userId: 'rd-ga-member', unitId: 'rd-ga', positionId: 'rd-pos-staff', teamId: 'rd-team-line', isActive: true },
  // Manager-ranked position on a unit whose persisted manager is None:
  // stays a people chip, never a MANAGER row.
  { id: 'rd-asg-qsec-staff', userId: 'rd-qsec-staff', unitId: 'rd-qsec', positionId: 'rd-pos-section-manager', teamId: null, isActive: true },
]

const teams: TeamNode[] = [
  { id: 'rd-team-line', name: 'GA Line Team', unitId: 'rd-ga', reportsToAssignmentId: 'rd-asg-ga-manager', isActive: true },
]

const users: WorkspaceSnapshot['users'] = [
  { id: 'rd-dana', name: 'Dana Manager', email: 'dana@example.com', role: 'general_dept', isActive: true },
  { id: 'rd-ga-manager', name: 'Mock Department Manager — GA', email: 'ga-manager@example.com', role: 'general_dept', isActive: true },
  { id: 'rd-ga-staff', name: 'Mock Staff 1 — GA', email: 'ga-staff@example.com', role: 'general_dept', isActive: true },
  { id: 'rd-ga-supervisor', name: 'Mock Supervisor — GA', email: 'ga-supervisor@example.com', role: 'general_dept', isActive: true },
  { id: 'rd-ga-member', name: 'Mock Member — GA', email: 'ga-member@example.com', role: 'general_dept', isActive: true },
  { id: 'rd-qsec-staff', name: 'Mock Section Manager — QSEC', email: 'qsec-staff@example.com', role: 'general_dept', isActive: true },
  { id: 'rd-unassigned', name: 'Pat Unassigned — Temp', email: 'pat-unassigned@example.com', role: 'general_dept', isActive: true },
]

const snapshot: WorkspaceSnapshot = {
  units,
  positions,
  assignments,
  teams,
  users,
  unassignedUsers: [{ id: 'rd-unassigned', name: 'Pat Unassigned — Temp', email: 'pat-unassigned@example.com' }],
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

function cssRule(source: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = source.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{[^}]*\\}`))
  assert.ok(match, `missing CSS rule for ${selector}`)
  return match[0]
}

let compiledCssPromise: Promise<string> | null = null

async function compiledApplicationCss(): Promise<string> {
  if (!compiledCssPromise) {
    compiledCssPromise = postcss([tailwindcss(), autoprefixer])
      .process(readFileSync('src/app/globals.css', 'utf8'), { from: 'src/app/globals.css' })
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

describe('flowchart card readability', () => {
  it('widens unit cards and keeps unit titles on one line with a full-name tooltip', async () => {
    const html = renderWorkspace()
    const css = readFileSync('src/app/globals.css', 'utf8')

    // Desktop cards grow past the old 22rem so the one-line title has real
    // space (30rem fits "Engineering Department" without truncation).
    const card = cssRule(css, '.organization-unit-card')
    assert.match(card, /width:\s*30rem/)
    assert.match(card, /max-width:\s*30rem/)
    assert.match(cssRule(css, '.organization-unit-child'), /min-width:\s*30rem/)

    // Compact-card mode (overflow "…" actions, no reserved hover strip) now
    // covers the standard card width, matching the widened cards.
    assert.match(css, /@container organization-unit-card \(max-width: 30rem\)[\s\S]*?organization-unit-hover-actions[\s\S]*?display:\s*none/)
    assert.match(css, /@container organization-unit-card \(max-width: 30rem\)[\s\S]*?organization-unit-header-overflow[\s\S]*?display:\s*flex/)

    // The title stays on ONE line: never a mid-word break ("Engineeri ng"),
    // never a multi-line wrap. Overflow ends in an ellipsis and the full unit
    // name remains available as the header tooltip.
    const displaySpanRule = cssRule(css, '.organization-unit-name [data-testid="inline-name-edit"] > span')
    assert.match(displaySpanRule, /white-space:\s*nowrap/)
    assert.match(displaySpanRule, /text-overflow:\s*ellipsis/)
    assert.doesNotMatch(displaySpanRule, /white-space:\s*normal/)
    assert.doesNotMatch(displaySpanRule, /break-word/)

    // Slightly larger title type.
    assert.match(classOfTestId(html, 'unit-name-rd-admin'), /text-lg/)

    // Full unit name stays available as the tooltip.
    assert.match(openTag(html, 'unit-name-rd-admin'), /title="Admin Division"/)
    assert.match(openTag(html, 'unit-name-rd-ga'), /title="GA Department"/)
    assert.match(openTag(html, 'unit-name-rd-qsec'), /title="QSEC Department"/)
    assert.match(openTag(html, 'unit-name-rd-qc'), /title="QC Section"/)
    assert.match(openTag(html, 'unit-name-rd-eng'), /title="Engineering Department"/)
    assert.match(openTag(html, 'unit-name-rd-maint'), /title="Maintenance Section"/)
  })

  it('renders the target unit titles untruncated on one line at desktop card width', { timeout: 60_000 }, async () => {
    await withWorkspaceDom('760px', async (page) => {
      // No named inner functions here: page.evaluate serializes this source,
      // so it must be self-contained plain browser JS.
      const facts = await page.evaluate(() => {
        const ids = ['rd-admin', 'rd-ga', 'rd-qsec', 'rd-qc', 'rd-eng', 'rd-maint']
        const out: Array<{
          id: string
          text: string
          title: string
          cardWidth: number
          clientWidth: number
          scrollWidth: number
          lineHeight: number
        }> = []
        for (const id of ids) {
          const el = document.querySelector(`[data-testid="unit-name-${id}"]`) as HTMLElement | null
          if (!el) continue
          const inner = el.querySelector('[data-testid="inline-name-edit"] > span') as HTMLElement | null
          if (!inner) continue
          const card = el.closest('[data-testid^="unit-card-"]') as HTMLElement | null
          out.push({
            id,
            text: inner.textContent?.trim() ?? '',
            title: el.getAttribute('title') ?? '',
            cardWidth: card ? card.getBoundingClientRect().width : 0,
            clientWidth: inner.clientWidth,
            scrollWidth: inner.scrollWidth,
            lineHeight: Math.round(inner.getBoundingClientRect().height),
          })
        }
        return out
      })
      assert.equal(facts.length, 6, 'every measured unit must render a name span')
      for (const fact of facts) {
        assert.equal(fact.text, fact.title, `${fact.id} tooltip must carry the full name`)
        assert.ok(
          fact.scrollWidth <= fact.clientWidth + 1,
          `${fact.id} title is truncated (scroll ${fact.scrollWidth} > client ${fact.clientWidth})`,
        )
        // One line only: a wrapped or mid-word-broken title renders as
        // multiple 28px line boxes (text-lg).
        assert.ok(
          fact.lineHeight <= 32,
          `${fact.id} title must stay on one line, got line height ${fact.lineHeight}px`,
        )
        assert.ok(fact.cardWidth >= 479, `${fact.id} card must be at least 30rem wide, got ${fact.cardWidth}`)
      }
      const names = new Set(facts.map((fact) => fact.text))
      for (const expected of ['Admin Division', 'GA Department', 'QSEC Department', 'QC Section', 'Engineering Department', 'Maintenance Section']) {
        assert.ok(names.has(expected), `${expected} must be one of the measured full titles`)
      }
    })
  })

  it('renders the persisted manager alone under Manager; other assignees under People', { timeout: 60_000 }, async () => {
    await withWorkspaceDom('760px', async (page) => {
      const facts = await page.evaluate(() => {
        const managerRow = document.querySelector('[data-testid="unit-manager-rd-ga"]')
        const people = document.querySelector('[data-testid="unit-people-rd-ga"]')
        const staffChip = document.querySelector('[data-testid="person-chip-rd-ga-staff"]')
        const supervisorChip = document.querySelector('[data-testid="person-chip-rd-ga-supervisor"]')
        const staffList = people ? people.querySelector('.organization-staff-list') : null
        const qsecManagerRow = document.querySelector('[data-testid="unit-manager-rd-qsec"]')
        const qsecChip = document.querySelector('[data-testid="person-chip-rd-qsec-staff"]')
        const qsecStaffList = qsecChip ? qsecChip.closest('.organization-staff-list') : null
        const heading = people ? (people.textContent ?? '') : ''
        return {
          hasManagerRow: Boolean(managerRow),
          managerChipCount: managerRow ? managerRow.querySelectorAll('.organization-manager-person').length : 0,
          staffUnderManager: staffChip && managerRow ? managerRow.contains(staffChip) : null,
          supervisorUnderManager: supervisorChip && managerRow ? managerRow.contains(supervisorChip) : null,
          staffInList: staffChip && staffList ? staffList.contains(staffChip) : null,
          supervisorInList: supervisorChip && staffList ? staffList.contains(supervisorChip) : null,
          hasPeopleHeading: /People/.test(heading),
          hasManagerHeading: /Manager/.test(heading),
          qsecHasManagerRow: Boolean(qsecManagerRow),
          qsecChipInStaffList: Boolean(qsecStaffList),
        }
      })
      assert.equal(facts.hasManagerRow, true, 'GA Department must render its persisted manager row')
      assert.equal(facts.managerChipCount, 1, 'MANAGER row must hold exactly one person')
      assert.equal(facts.staffUnderManager, false, 'staff chip must not sit under MANAGER')
      assert.equal(facts.supervisorUnderManager, false, 'supervisor chip must not sit under MANAGER')
      assert.equal(facts.staffInList, true, 'staff chip must be listed separately')
      assert.equal(facts.supervisorInList, true, 'supervisor chip must be listed separately')
      assert.equal(facts.hasManagerHeading, true, 'manager heading must stay labeled')
      assert.equal(facts.hasPeopleHeading, true, 'non-manager assignees need their own People heading')
      assert.equal(facts.qsecHasManagerRow, false, 'null persisted manager must not produce a MANAGER row')
      assert.equal(facts.qsecChipInStaffList, true, 'manager-ranked assignee on a None unit stays in the people list')
    })
  })

  it('lays each people row out on one line: name left, position right', { timeout: 60_000 }, async () => {
    const html = renderWorkspace()
    // Source contract: the chip button is a non-wrapping flex row with
    // space-between; the visible name truncates instead of wrapping.
    const managerChip = innerByTestId(html, 'person-chip-rd-ga-manager')
    assert.match(managerChip, /justify-between/)
    assert.match(managerChip, /flex-nowrap/)
    assert.match(managerChip, /w-full/)
    assert.match(managerChip, /truncate/)
    assert.match(managerChip, /data-testid="person-name-rd-ga-manager"/)

    await withWorkspaceDom('760px', async (page) => {
      // Anonymous inline expressions only: page.evaluate serializes this
      // source, so named inner functions are not allowed here.
      const facts = await page.evaluate(() => {
        const manager = document.querySelector('[data-testid="person-chip-rd-ga-manager"] > button') as HTMLElement | null
        const staff = document.querySelector('[data-testid="person-chip-rd-ga-staff"] > button') as HTMLElement | null
        const team = document.querySelector('[data-testid="team-member-rd-ga-member"]') as HTMLElement | null
        const name = document.querySelector('[data-testid="person-name-rd-ga-manager"]') as HTMLElement | null
        const badge = document.querySelector('[data-testid="person-position-rd-ga-manager"]') as HTMLElement | null
        if (!manager || !staff || !team || !name || !badge) return null
        return {
          managerDisplay: getComputedStyle(manager).display,
          managerJustify: getComputedStyle(manager).justifyContent,
          managerWrap: getComputedStyle(manager).flexWrap,
          staffWrap: getComputedStyle(staff).flexWrap,
          teamWrap: getComputedStyle(team).flexWrap,
          managerHeight: Math.round(manager.getBoundingClientRect().height),
          nameRight: name.getBoundingClientRect().right,
          nameHeight: Math.round(name.getBoundingClientRect().height),
          badgeLeft: badge.getBoundingClientRect().left,
        }
      })
      assert.ok(facts, 'manager chip, staff chip, team chip, name and badge must render')
      assert.equal(facts.managerDisplay, 'flex')
      assert.equal(facts.managerJustify, 'space-between')
      assert.equal(facts.managerWrap, 'nowrap')
      assert.equal(facts.staffWrap, 'nowrap', 'staff rows share the one-line chip layout')
      assert.equal(facts.teamWrap, 'nowrap', 'team member chips never wrap mid-name')
      assert.ok(
        facts.nameRight <= facts.badgeLeft + 1,
        'name must sit left of the position badge on the same row',
      )
      assert.ok(facts.nameHeight <= 24, 'name must stay on one line')
      assert.ok(facts.managerHeight >= 32, 'manager chip must keep its row height')
    })
  })

  it('draws the child stem from the parent card bottom edge to the child card top', { timeout: 60_000 }, async () => {
    await withWorkspaceDom('760px', async (page) => {
      // Anonymous inline expressions only: page.evaluate serializes this
      // source, so named inner functions are not allowed here.
      const facts = await page.evaluate(() => {
        const card = document.querySelector('[data-testid="unit-card-rd-qsec"]') as HTMLElement | null
        const children = document.querySelector('[data-testid="unit-children-rd-qsec"]') as HTMLElement | null
        const connector = document.querySelector('[data-testid="unit-connector-rd-qc"]') as HTMLElement | null
        const childCard = document.querySelector('[data-testid="unit-card-rd-qc"]') as HTMLElement | null
        if (!card || !children || !connector || !childCard) return null
        return {
          cardBottom: card.getBoundingClientRect().bottom,
          childrenTop: children.getBoundingClientRect().top,
          connectorTop: connector.getBoundingClientRect().top,
          connectorBottom: connector.getBoundingClientRect().bottom,
          childCardTop: childCard.getBoundingClientRect().top,
        }
      })
      assert.ok(facts, 'single-child chain must render')
      // The children box must sit a full stem-height (1.5rem) below the parent
      // card so the CSS stem (top:-1.5rem) starts AT the bottom edge instead
      // of punching through the card body over the people list.
      const gap = facts.childrenTop - facts.cardBottom
      assert.ok(
        gap >= 23,
        `children box must sit ~24px below the parent card bottom (stem starts at the edge), got gap ${gap}px`,
      )
      assert.ok(
        facts.connectorTop >= facts.cardBottom - 1,
        `stem must not start inside the parent card body (stub top ${facts.connectorTop} vs card bottom ${facts.cardBottom})`,
      )
      assert.ok(
        Math.abs(facts.connectorTop - facts.childrenTop) <= 1,
        'connector stub must continue the stem from the children-box top',
      )
      assert.ok(
        Math.abs(facts.connectorBottom - facts.childCardTop) <= 1,
        'connector must meet the child card top',
      )
    })
  })

  it('shows short people labels with position badges and full-name tooltips', () => {
    const html = renderWorkspace()

    // GA staff chip: qualifier suffix (" — GA") dropped from the visible
    // label; position moves into a small badge; full label on title.
    const staffChip = innerByTestId(html, 'person-chip-rd-ga-staff')
    assert.match(staffChip, /title="Mock Staff 1 — GA — Staff"/)
    assert.match(staffChip, />Mock Staff 1<\/span>/)
    assert.doesNotMatch(staffChip, />Mock Staff 1 — GA</)
    assert.match(staffChip, /data-testid="person-position-rd-ga-staff"[^>]*>\s*Staff\s*</)

    // A plain two-part name without an em dash stays whole.
    const danaChip = innerByTestId(html, 'person-chip-rd-dana')
    assert.match(danaChip, /title="Dana Manager — Department manager"/)
    assert.match(danaChip, />Dana Manager<\/span>/)
    assert.match(danaChip, /data-testid="person-position-rd-dana"[^>]*>\s*Department manager\s*</)

    // Supervisor chip (non-manager): short label + badge.
    const supervisorChip = innerByTestId(html, 'person-chip-rd-ga-supervisor')
    assert.match(supervisorChip, /title="Mock Supervisor — GA — Supervisor"/)
    assert.match(supervisorChip, />Mock Supervisor<\/span>/)
    assert.match(supervisorChip, /data-testid="person-position-rd-ga-supervisor"[^>]*>\s*Supervisor\s*</)

    // Team member chips follow the same chip language.
    const teamGroup = innerByTestId(html, 'team-group-rd-team-line')
    assert.match(teamGroup, /title="Mock Member — GA — Staff"/)
    assert.match(teamGroup, />Mock Member<\/span>/)
    assert.match(teamGroup, /data-testid="team-member-position-rd-ga-member"[^>]*>\s*Staff\s*</)

    // Unassigned dock chips also collapse qualifier suffixes; tooltip keeps
    // the full name.
    const unassignedChip = innerByTestId(html, 'unassigned-person-rd-unassigned')
    assert.match(unassignedChip, /title="Pat Unassigned — Temp"/)
    assert.match(unassignedChip, />Pat Unassigned<\/span>/)
  })

  it('darkens the flowchart connectors', () => {
    const css = readFileSync('src/app/globals.css', 'utf8')
    assert.match(css, /--organization-flowchart-line:\s*#64748b/)
    assert.doesNotMatch(css, /--organization-flowchart-line:\s*#94a3b8/)
  })
})

describe('organization page tabs', () => {
  it('renders header tabs with a single active canvas link', () => {
    const organization = renderToStaticMarkup(createElement(OrganizationTabs, { active: 'organization' }))
    assert.match(organization, /data-testid="header-organization"[^>]*aria-current="page"/)
    assert.match(organization, /data-testid="header-organization"[^>]*href="\/admin\/organization"/)
    assert.doesNotMatch(organization, /data-testid="header-positions"[^>]*aria-current/)
    assert.doesNotMatch(organization, /data-testid="header-approval-chains"[^>]*aria-current/)
    assert.match(organization, /data-testid="header-positions"[^>]*href="\/admin\/organization\?panel=positions"/)
    assert.match(organization, /data-testid="header-approval-chains"[^>]*href="\/admin\/organization\?panel=chains"/)

    const chains = renderToStaticMarkup(createElement(OrganizationTabs, { active: 'chains' }))
    assert.match(chains, /data-testid="header-approval-chains"[^>]*aria-current="page"/)
    assert.doesNotMatch(chains, /data-testid="header-organization"[^>]*aria-current/)
  })

  it('renders exactly one canvas per panel on the organization page', () => {
    const page = readFileSync('src/app/admin/organization/page.tsx', 'utf8')
    assert.match(page, /params\.panel === 'positions' \? 'positions' : params\.panel === 'chains' \? 'chains' : null/)
    assert.match(page, /<OrganizationTabs active=\{panel \?\? 'organization'\} \/>/)
    assert.match(page, /panel === 'positions' \? <PositionAdminPanel/)
    assert.match(page, /panel === 'chains' \? \(\s*<ApprovalChainsPanel/)
    assert.match(page, /panel === null \? \(\s*<>\s*<CreateUnitDialog/)

    const workspaceCount = page.split('<OrganizationWorkspace').length - 1
    assert.equal(workspaceCount, 1, 'OrganizationWorkspace must render exactly once (Organization tab only)')

    // The old stacked header buttons are gone; tabs replace them. Unit
    // View/Customize deep links to chains keep working via panel=chains.
    assert.match(page, /panel === 'chains'/)
    assert.match(page, /chainsEditor/)
    assert.doesNotMatch(page, /data-testid="header-approval-chains"|data-testid="header-positions"/)
  })
})

describe('flowchart zoom', () => {
  it('clamps manual zoom, never lets Fit upscale a narrow tree, and lets Fit drop below the manual minimum', () => {
    assert.equal(clampZoom(0.1), 0.25)
    assert.equal(clampZoom(5), 2)
    assert.equal(clampZoom(Number.NaN), 1)
    assert.equal(clampZoom(1.1), 1.1)
    assert.ok(Math.abs(fitScaleFor(1400, 500) - 500 / 1400) < 1e-9)
    // Fit is NOT clamped to the manual +/- band: a >4:1 width ratio must
    // produce a scale below the 25% manual minimum so the tree really fits.
    assert.ok(Math.abs(fitScaleFor(2400, 500) - 500 / 2400) < 1e-9)
    assert.ok(fitScaleFor(2400, 500) < ZOOM_MIN, `Fit must drop below the manual minimum, got ${fitScaleFor(2400, 500)}`)
    assert.equal(fitScaleFor(300, 500), 1)
    assert.equal(fitScaleFor(0, 500), 1)
    assert.equal(fitScaleFor(500, 0), 1)
  })

  it('renders accessible zoom controls with the canvas at 100% initially', () => {
    const markup = renderToStaticMarkup(
      createElement(
        ZoomableFlowchart,
        null,
        createElement(OrganizationTree, { snapshot }),
      ),
    )
    assert.match(markup, /data-testid="flowchart-zoom-in"[^>]*aria-label="Zoom in"/)
    assert.match(markup, /data-testid="flowchart-zoom-out"[^>]*aria-label="Zoom out"/)
    assert.match(markup, /data-testid="flowchart-zoom-fit"[^>]*aria-label="Fit"/)
    assert.match(markup, /data-testid="flowchart-zoom-label"[^>]*>\s*100%\s*</)
    assert.match(markup, /data-testid="flowchart-zoom-canvas"[^>]*transform:\s*scale\(1\)/)
    // Top-left scaling inside a scaled-size layout wrapper: a top-center
    // origin on a natural-width canvas shifts the fitted tree right and clips.
    assert.match(markup, /data-testid="flowchart-zoom-canvas"[^>]*transform-origin:\s*top left/)
    assert.match(markup, /data-testid="flowchart-zoom-sizer"/)
  })

  it('scales the canvas with +/-; Fit contains both tree edges below the manual minimum; collapse updates the shim', { timeout: 180_000 }, async () => {
    const css = await compiledApplicationCss()
    // The +/- and Fit behaviors are client state transitions, so this test
    // hydrates the REAL ZoomableFlowchart in chromium via the esbuild harness
    // (offline: no dev server, no database).
    await esbuild.build({
      entryPoints: ['tests/regression/fixtures/zoom-harness.ts'],
      bundle: true,
      format: 'iife',
      platform: 'browser',
      outfile: 'test-results/flowchartread-zoom-harness.js',
      alias: {
        '@': `${process.cwd()}/src`,
        '@/server-actions/organization': `${process.cwd()}/tests/regression/fixtures/server-actions-browser-stub.ts`,
      },
      define: { 'process.env.NODE_ENV': '"production"' },
      logLevel: 'silent',
    })
    const browser = await chromium.launch({ headless: true })
    try {
      const page = await browser.newPage({ viewport: { width: 900, height: 900 } })
      await page.setContent(`<!DOCTYPE html><html><head><style>${css}</style></head><body>
        <div data-testid="zoom-harness-root" style="width:500px;max-width:500px;"></div>
      </body></html>`)
      await page.addScriptTag({ path: 'test-results/flowchartread-zoom-harness.js' })
      await page.waitForSelector('[data-testid="flowchart-zoom-in"]', { timeout: 30_000 })

      const natural = await page.evaluate(() => {
        const tree = document.querySelector('[data-testid="organization-tree"]') as HTMLElement
        return { width: tree.getBoundingClientRect().width, height: tree.getBoundingClientRect().height }
      })
      assert.ok(natural.width > 500, `fixture tree must exceed the 500px frame, got ${natural.width}`)
      // >4:1 width ratio: the fitted scale must land BELOW the manual 25%
      // minimum (P1-2 regression: Fit clamped to 25% and still overflowed).
      assert.ok(natural.width / 500 > 4, `fixture tree must exceed a 4:1 width ratio, got ${natural.width}`)

      const toolbarBefore = await page.evaluate(() => {
        const button = document.querySelector('[data-testid="flowchart-zoom-in"]') as HTMLElement
        return button.getBoundingClientRect().width
      })

      await page.getByTestId('flowchart-zoom-in').click()
      assert.match(await page.getByTestId('flowchart-zoom-label').innerText(), /110%/)
      const zoomed = await page.evaluate(() => {
        const tree = document.querySelector('[data-testid="organization-tree"]') as HTMLElement
        return tree.getBoundingClientRect().width
      })
      assert.ok(Math.abs(zoomed - natural.width * 1.1) <= 3, `zoom-in must scale the canvas (${zoomed} vs ${natural.width * 1.1})`)
      const toolbarAfter = await page.evaluate(() => {
        const button = document.querySelector('[data-testid="flowchart-zoom-in"]') as HTMLElement
        return button.getBoundingClientRect().width
      })
      assert.ok(Math.abs(toolbarBefore - toolbarAfter) <= 1, 'zoom controls must not scale with the canvas')

      await page.getByTestId('flowchart-zoom-out').click()
      await page.getByTestId('flowchart-zoom-out').click()
      assert.match(await page.getByTestId('flowchart-zoom-label').innerText(), /90%/)

      await page.getByTestId('flowchart-zoom-fit').click()
      const fit = await page.evaluate(() => {
        const tree = document.querySelector('[data-testid="organization-tree"]') as HTMLElement
        const canvas = document.querySelector('[data-testid="flowchart-zoom-canvas"]') as HTMLElement
        const frame = document.querySelector('[data-testid="flowchart-zoom-frame"]') as HTMLElement
        const frameBox = frame.getBoundingClientRect()
        const treeBox = tree.getBoundingClientRect()
        return {
          label: (document.querySelector('[data-testid="flowchart-zoom-label"]') as HTMLElement).textContent?.trim(),
          frameLeft: frameBox.left,
          frameRight: frameBox.right,
          frameWidth: frameBox.width,
          frameHeight: Math.round(frameBox.height),
          treeLeft: treeBox.left,
          treeRight: treeBox.right,
          treeWidth: treeBox.width,
          frameScrollWidth: frame.scrollWidth,
          frameClientWidth: frame.clientWidth,
          transform: getComputedStyle(canvas).transform,
        }
      })
      const fitPercent = Number((fit.label ?? '').replace('%', ''))
      assert.ok(fitPercent > 0 && fitPercent < 25, `Fit must drop below the 25% manual minimum for a >4:1 tree, got ${fit.label}`)
      // Containment means BOTH tree edges inside the frame edges — fitting the
      // width alone allowed a top-center origin to shift the tree right and
      // clip the far edge.
      assert.ok(fit.treeLeft >= fit.frameLeft - 2, `fitted tree LEFT edge must be inside the frame (tree ${fit.treeLeft} vs frame ${fit.frameLeft})`)
      assert.ok(fit.treeRight <= fit.frameRight + 2, `fitted tree RIGHT edge must be inside the frame (tree ${fit.treeRight} vs frame ${fit.frameRight})`)
      assert.ok(fit.treeWidth <= fit.frameWidth + 2, `fitted tree width must fit the frame, got ${fit.treeWidth} vs ${fit.frameWidth}`)
      assert.ok(fit.frameScrollWidth <= fit.frameClientWidth + 1, 'Fit must not leave dead horizontal scroll space')
      assert.notEqual(fit.transform, 'none')

      // P2: the height shim must track the natural tree size. Collapsing a
      // branch resizes the tree WITHOUT touching zoom, so the frame must
      // shrink via ResizeObserver while the zoom label stays put.
      const labelBefore = fit.label
      await page.getByTestId('unit-toggle-zh-company').click()
      await page.waitForTimeout(250)
      const collapsed = await page.evaluate(() => {
        const frame = document.querySelector('[data-testid="flowchart-zoom-frame"]') as HTMLElement
        return {
          frameHeight: Math.round(frame.getBoundingClientRect().height),
          label: (document.querySelector('[data-testid="flowchart-zoom-label"]') as HTMLElement).textContent?.trim(),
        }
      })
      assert.ok(
        collapsed.frameHeight < fit.frameHeight - 10,
        `collapse must shrink the height shim without a zoom change (${collapsed.frameHeight} vs ${fit.frameHeight})`,
      )
      assert.equal(collapsed.label, labelBefore, 'collapse must not change the zoom scale')
    } finally {
      await browser.close()
    }
  })
})
