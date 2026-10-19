import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ApprovalPhase } from '@/lib/approval-routes/definition'
import type { OrganizationUnitNode, PositionNode } from '@/lib/organization/model'
import type { ApprovalChainsData } from '@/server-actions/approval-routes'
import {
  ApprovalChainsPanel,
  CreateExceptionDialog,
  resolveEditorVersion,
  resolveInheritedPublishedSourceVersion,
} from '@/components/organization/ApprovalChainsPanel'
import {
  APPROVAL_CHAIN_LABEL,
  REQUEST_VISIBILITY_LABEL,
  UnitSidePanel,
} from '@/components/organization/UnitSidePanel'
import type { WorkspaceSnapshot } from '@/server-actions/organization'

const positions: PositionNode[] = [
  { id: 'staff', name: 'Staff', rank: 1, isActive: true },
  { id: 'lead', name: 'Lead', rank: 2, isActive: true },
  { id: 'director', name: 'Director', rank: 4, isActive: true },
]

function unit(id: string, name: string, parentId: string | null, isActive = true): OrganizationUnitNode {
  return {
    id,
    name,
    parentId,
    isActive,
    shareRequests: id === 'company',
    canWorkOnSolutions: false,
    managerUserId: null,
  }
}

const units = [
  unit('company', 'Company', null),
  unit('ops', 'Operations', 'company'),
  unit('section', 'Section', 'ops'),
  unit('inactive', 'Inactive', 'company', false),
]

function route(
  versionId: string,
  scopeUnitId: string,
  phase: ApprovalPhase,
  status: 'DRAFT' | 'PUBLISHED' | 'RETIRED',
  version = 1,
) {
  return {
    versionId,
    scopeUnitId,
    phase,
    version,
    status,
    approvalLimitPositionId: 'director',
    steps: [
      { order: 1, positionId: 'lead' },
      { order: 2, positionId: 'director' },
    ],
  } as const
}

function chainsData(versions: ApprovalChainsData['versions'] = []): ApprovalChainsData {
  return {
    rootUnitId: 'company',
    units,
    positions,
    users: [],
    versions,
    strandedAttempts: [],
  }
}

function renderCreateDialog(versions: ApprovalChainsData['versions']) {
  return renderToStaticMarkup(createElement(CreateExceptionDialog, {
    units,
    rootUnitId: 'company',
    phaseVersions: versions,
    onClose: () => {},
    onCreate: () => {},
    onEdit: () => {},
  }))
}

describe('bounded create-exception entry point', () => {
  it('keeps one Create exception action in the empty Unit exceptions state', () => {
    const html = renderToStaticMarkup(createElement(ApprovalChainsPanel, { data: chainsData() }))
    assert.match(html, /data-testid="chains-exceptions-empty"/)
    assert.equal((html.match(/data-testid="chains-create-exception"/g) ?? []).length, 1)
    assert.match(html, />Create exception</)
  })

  it('keeps one Create exception action beside a non-empty list and relabels local editing', () => {
    const html = renderToStaticMarkup(createElement(ApprovalChainsPanel, {
      data: chainsData([
        route('root-request', 'company', 'REQUEST', 'PUBLISHED'),
        route('ops-request', 'ops', 'REQUEST', 'PUBLISHED'),
      ]),
    }))
    assert.equal((html.match(/data-testid="chains-create-exception"/g) ?? []).length, 1)
    assert.match(html, /data-testid="chains-exception-ops-REQUEST"/)
    assert.match(html, /data-action="edit-chain"[^>]*>Edit chain</)
    assert.match(html, /replaces the inherited chain.*descendants.*does not append/i)
  })

  it('offers only active non-root units and all three phases to the chooser', () => {
    const html = renderCreateDialog([route('root-request', 'company', 'REQUEST', 'PUBLISHED')])
    assert.match(html, /data-testid="chains-create-exception-unit-select"/)
    assert.match(html, /Operations/)
    assert.doesNotMatch(html, /Inactive/)
    assert.match(html, /data-testid="chains-create-exception-phase-select"/)
    // Radix Select options mount on interaction rather than in static SSR;
    // PHASES maps Request, Solution, and Final in the component.
  })

  it('seeds from the nearest inherited published route, excluding draft and retired rows', () => {
    const versions = [
      route('section-draft', 'section', 'REQUEST', 'DRAFT'),
      route('ops-retired', 'ops', 'REQUEST', 'RETIRED'),
      route('company-request', 'company', 'REQUEST', 'PUBLISHED'),
      route('ops-solution', 'ops', 'SOLUTION', 'PUBLISHED'),
    ]
    const source = resolveInheritedPublishedSourceVersion(versions, units, 'section', 'REQUEST')
    assert.equal(source?.versionId, 'company-request')
    const editorSource = resolveEditorVersion(versions, units, {
      scopeUnitId: 'section',
      phase: 'REQUEST',
      mode: 'create',
    })
    assert.equal(editorSource?.scopeUnitId, 'company')
    const html = renderToStaticMarkup(createElement(ApprovalChainsPanel, {
      data: chainsData(versions),
      initialEditor: { scopeUnitId: 'section', phase: 'REQUEST', mode: 'create' },
    }))
    assert.match(html, /data-testid="route-editor-section-REQUEST"/)
    assert.match(html, /data-editor-version="company-request"/)
    assert.match(html, /Seeded from the published REQUEST chain at Company/)
    // The destination is section even though the seed source is company.
    assert.match(html, /scopeUnitId|route-editor-section-REQUEST/)
  })

  it('uses an explicit blank state when no inherited published chain exists', () => {
    const dialog = renderCreateDialog([
      route('ops-draft', 'ops', 'REQUEST', 'DRAFT'),
      route('company-retired', 'company', 'REQUEST', 'RETIRED'),
    ])
    assert.match(dialog, /data-testid="chains-create-exception-no-inherited"/)
    const editor = renderToStaticMarkup(createElement(ApprovalChainsPanel, {
      data: chainsData([]),
      initialEditor: { scopeUnitId: 'section', phase: 'FINAL', mode: 'create' },
    }))
    assert.match(editor, /data-testid="route-editor-blank-seed"/)
    assert.match(editor, /no placeholder route is fabricated/i)
    assert.doesNotMatch(editor, /data-testid="route-editor-step-1"/)
  })

  it('routes an existing local published pair to Edit chain and never offers duplicate Create', () => {
    const html = renderCreateDialog([
      route('company-request', 'company', 'REQUEST', 'PUBLISHED'),
      route('ops-request', 'ops', 'REQUEST', 'PUBLISHED'),
    ])
    assert.match(html, /data-testid="chains-create-exception-existing"/)
    assert.match(html, /already has a published Request exception/i)
    assert.match(html, /data-testid="chains-create-exception-edit"/)
    assert.match(html, />Edit chain</)
    assert.doesNotMatch(html, /data-testid="chains-create-exception-submit"/)
    assert.match(html, /cannot be duplicated/i)
  })

  it('does not invoke route callbacks during static rendering; Cancel remains an explicit control', () => {
    let callbackCalls = 0
    const html = renderToStaticMarkup(createElement(CreateExceptionDialog, {
      units,
      rootUnitId: 'company',
      phaseVersions: [route('company-request', 'company', 'REQUEST', 'PUBLISHED')],
      onClose: () => { callbackCalls += 1 },
      onCreate: () => { callbackCalls += 1 },
      onEdit: () => { callbackCalls += 1 },
    }))
    assert.match(html, /data-testid="chains-create-exception-cancel"/)
    assert.equal(callbackCalls, 0)
  })
})

describe('organization dialog visibility and approval labels', () => {
  const snapshot: WorkspaceSnapshot = {
    units,
    positions,
    assignments: [],
    teams: [],
    users: [],
    unassignedUsers: [],
    routeSources: [],
    customChainExceptions: [],
    readiness: { ready: true, blockers: [] },
  }

  it('names visibility and approval independently without changing toggle semantics', () => {
    const html = renderToStaticMarkup(createElement(UnitSidePanel, {
      unit: units[1],
      snapshot,
    }))
    assert.match(html, new RegExp(REQUEST_VISIBILITY_LABEL))
    assert.match(html, new RegExp(APPROVAL_CHAIN_LABEL))
    assert.match(html, /data-testid="unit-share-requests-info"/)
    assert.match(html, /data-testid="unit-can-work-on-solutions-info"/)
    assert.match(html, /independent of request visibility/i)
    assert.match(html, /data-testid="unit-can-work-on-solutions"/)

    const panel = readFileSync('src/components/organization/UnitSidePanel.tsx', 'utf8')
    assert.match(panel, /Off: only this unit and managers above it/i)
    assert.match(panel, /Does not grant approval rights/i)
  })
})

// Static coverage intentionally stops at the server-rendered seams: this
// repository has no mounted component harness. Browser behavior (selection,
// Escape/cancel, publish-close, and refreshed list state) remains an E2E
// concern; the unit-level route action tests cover its publish transaction.
