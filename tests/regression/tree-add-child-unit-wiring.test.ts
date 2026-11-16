// Add sub-unit from the organization tree: static markup wiring.
// Render harness: renderToStaticMarkup (sibling UI pattern:
// tests/regression/clean-start-ui-tree.test.ts). Hover reveal, the popover and
// the overflow-menu entry are exercised in a real browser by
// tree-add-child-unit-clicks.test.ts.
// Pure props snapshot only: NO Prisma, NO database, NO env, NO schema/server ops.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { OrganizationUnitNode } from '@/lib/organization/model'
import type { WorkspaceSnapshot } from '@/lib/organization/workspace-admin'
import { OrganizationTree } from '@/components/organization/OrganizationTree'

function unit(id: string, name: string, parentId: string | null, isActive = true): OrganizationUnitNode {
  return { id, name, parentId, isActive, shareRequests: false, canWorkOnSolutions: false, managerUserId: null }
}

const snapshot: WorkspaceSnapshot = {
  units: [
    unit('company', 'Company', null),
    unit('ops', 'Operations', 'company'),
    unit('section-a', 'Section A', 'ops'),
    unit('section-b', 'Section B', 'ops'),
    unit('retired', 'Retired Line', 'ops', false),
  ],
  positions: [],
  assignments: [],
  teams: [],
  users: [],
  unassignedUsers: [],
  routeSources: [],
  customChainExceptions: [],
  readiness: { ready: true, blockers: [] },
}

const html = renderToStaticMarkup(createElement(OrganizationTree, { snapshot }))

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

/** Inner HTML of the element carrying the test id (same-tag nesting aware). */
function innerByTestId(source: string, testId: string): string {
  const marker = `data-testid="${testId}"`
  const attr = source.indexOf(marker)
  assert.ok(attr >= 0, `missing data-testid="${testId}"`)
  const open = source.lastIndexOf('<', attr)
  const tag = /^<([a-zA-Z0-9]+)/.exec(source.slice(open))?.[1]
  assert.ok(tag, `could not parse tag for ${testId}`)
  let depth = 1
  const start = source.indexOf('>', attr) + 1
  let i = start
  while (depth > 0) {
    const nextOpen = source.indexOf(`<${tag}`, i)
    const nextClose = source.indexOf(`</${tag}>`, i)
    assert.ok(nextClose >= 0, `unclosed ${testId}`)
    if (nextOpen >= 0 && nextOpen < nextClose) {
      depth += 1
      i = nextOpen + tag.length + 1
    } else {
      depth -= 1
      if (depth === 0) return source.slice(start, nextClose)
      i = nextClose + tag.length + 3
    }
  }
  throw new Error(`unclosed ${testId}`)
}

describe('organization tree + Add unit wiring', () => {
  const activeIds = ['company', 'ops', 'section-a', 'section-b']

  it('renders one + Add unit button per active unit, inside that unit\'s own card', () => {
    for (const id of activeIds) {
      assert.equal(count(html, `data-testid="unit-add-child-${id}"`), 1, `one add button for ${id}`)
      const card = innerByTestId(html, `unit-card-${id}`)
      assert.equal(count(card, `data-testid="unit-add-child-${id}"`), 1, `${id} button sits in its own card`)
      // A card never carries another unit's button: hovering a child must
      // not be able to reveal its parent's control.
      assert.equal(count(card, 'data-testid="unit-add-child-slot-'), 1, `${id} card holds exactly one add slot`)
    }
  })

  it('offers no + Add unit button for an inactive unit', () => {
    assert.doesNotMatch(html, /unit-add-child-retired/)
    assert.doesNotMatch(html, /unit-add-child-slot-retired/)
  })

  it('keeps the button out of the unit header, whose click opens Manage', () => {
    for (const id of activeIds) {
      assert.doesNotMatch(innerByTestId(html, `unit-header-${id}`), /unit-add-child-/)
    }
  })

  it('does not put a bare group class on the unit card (it would reveal the header hover strip on any card hover)', () => {
    for (const id of activeIds) {
      const cardClass = new RegExp(`data-testid="unit-card-${id}"[^>]*class="([^"]*)"`).exec(html)?.[1]
      assert.ok(cardClass, `unit-card-${id} class`)
      assert.doesNotMatch(cardClass, /(^|\s)group(\s|$)/)
    }
  })
})
