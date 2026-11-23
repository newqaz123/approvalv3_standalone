import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { it } from 'node:test'
import { runInNewContext } from 'node:vm'
import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import type { PersonalApprovalChain } from '@/lib/approval-routes/chains-admin'

function renderChain(chain: PersonalApprovalChain): string {
  const { ApprovalChainView } = require('@/components/profile/approval-chain-view') as typeof import('@/components/profile/approval-chain-view')
  return renderToStaticMarkup(createElement(ApprovalChainView, { chain }))
}

it('shows the phase assumptions, route unit, and ordered steps with eligible names', () => {
  const html = renderChain({
    kind: 'assigned',
    unitPath: ['Section A', 'Operations', 'Company'],
    phases: [{
      phase: 'REQUEST', kind: 'ready', routeUnitName: 'Operations',
      preview: {
        source: 'INHERITED', routeVersionId: 'private-route', scopeUnitId: 'private-unit',
        autoApproved: false, noEligibleSteps: false,
        steps: [
          { order: 1, requiredPositionId: 'private-lead', positionName: 'Lead', skipped: false,
            candidates: [{ id: 'private-casey', name: 'Casey' }, { id: 'private-quinn', name: 'Quinn' }] },
          { order: 2, requiredPositionId: 'private-manager', positionName: 'Manager', skipped: true,
            skipReason: 'VACANT_POSITION', candidates: [] },
        ],
      },
    }, {
      phase: 'SOLUTION', kind: 'unavailable',
    }, {
      phase: 'FINAL', kind: 'ready', routeUnitName: 'Company',
      preview: {
        source: 'ROOT_DEFAULT', routeVersionId: 'private-final', scopeUnitId: 'private-company',
        autoApproved: true, noEligibleSteps: false, steps: [],
      },
    }],
  })
  assert.match(html, /<h2[^>]*>Request approval<\/h2>[\s\S]*<h2[^>]*>Solution approval<\/h2>[\s\S]*<h2[^>]*>Final approval<\/h2>/)
  assert.match(html, /Section A \/ Operations \/ Company/)
  assert.match(html, /Route from Operations/)
  assert.match(html, /<ol[\s\S]*Lead[\s\S]*Casey[\s\S]*Quinn[\s\S]*Manager[\s\S]*<\/ol>/)
  assert.match(html, /Any one of these people can approve/)
  assert.match(html, /No active approver/)
  assert.match(html, /No usable published route/)
  assert.match(html, /Automatically approved/)
  assert.match(html, /The person who starts final approval can change which steps are required/)
  assert.doesNotMatch(html, /private-|VACANT_POSITION/)
})

it('shows the Solution section with a permission message instead of a route', () => {
  const html = renderChain({
    kind: 'assigned', unitPath: ['Company'],
    phases: [{ phase: 'SOLUTION', kind: 'not-permitted' }],
  })
  assert.match(html, /<h2[^>]*>Solution approval<\/h2>/)
  assert.match(html, /You don.t have permission to submit solutions/)
  assert.doesNotMatch(html, /If you submit a solution|Route from|<ol|No usable published route/)
})

it('explains no eligible steps without claiming automatic approval', () => {
  const html = renderChain({
    kind: 'assigned', unitPath: ['Company'],
    phases: [{
      phase: 'REQUEST', kind: 'ready', routeUnitName: 'Company',
      preview: {
        source: 'CUSTOM', routeVersionId: 'route', scopeUnitId: 'company',
        autoApproved: false, noEligibleSteps: true, steps: [],
      },
    }],
  })
  assert.match(html, /No eligible approval steps/)
  assert.doesNotMatch(html, /Automatically approved/)
})

it('gives unassigned users guidance rather than route previews', () => {
  const html = renderChain({ kind: 'unassigned' })
  assert.match(html, /contact your administrator/i)
  assert.doesNotMatch(html, /Route from|Request approval/)
})

function loadPage(sessionUserId: string | null) {
  const output = ts.transpileModule(readFileSync('src/app/(dashboard)/approval-chain/page.tsx', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  const exports = {} as { default: (props?: unknown) => Promise<ReactElement> }
  const lookups: unknown[] = []
  const signInRedirect = new Error('redirect to /sign-in')
  runInNewContext(output, {
    exports,
    require(name: string) {
      if (name === '@/lib/auth-config') return { auth: async () => sessionUserId ? { user: { id: sessionUserId } } : null }
      if (name === 'next/navigation') return { redirect: (path: string) => {
        assert.equal(path, '/sign-in')
        throw signInRedirect
      } }
      if (name === '@/lib/approval-routes/chains-admin') return { loadPersonalApprovalChain: async (...args: unknown[]) => {
        lookups.push(args)
        return { kind: 'unassigned' }
      } }
      return require(name)
    },
  })
  return { page: exports.default, lookups, signInRedirect }
}

it('redirects signed-out visitors before doing any preview lookup', async () => {
  const { page, lookups, signInRedirect } = loadPage(null)
  await assert.rejects(page, signInRedirect)
  assert.deepEqual(lookups, [])
})

it('previews only the authenticated user, ignoring a query-supplied user ID', async () => {
  const { page, lookups } = loadPage('alice')
  const element = await page({ searchParams: Promise.resolve({ userId: 'other-user' }) })
  assert.match(renderToStaticMarkup(element), /contact your administrator/i)
  assert.deepEqual(lookups, [['alice']])
})
