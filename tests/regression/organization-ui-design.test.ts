import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { AssignmentNode, OrganizationUnitNode, PositionNode, TeamNode } from '@/lib/organization/model'
import type { WorkspaceSnapshot } from '@/lib/organization/workspace-admin'
import { OrganizationTree } from '@/components/organization/OrganizationTree'
import { UnitSidePanel } from '@/components/organization/UnitSidePanel'
import { InTreeModal } from '@/components/organization/InTreeModal'

const read = (path: string) => readFileSync(path, 'utf8')

const units: OrganizationUnitNode[] = [
  { id: 'company', name: 'Company', parentId: null, isActive: true, shareRequests: true, canWorkOnSolutions: false, managerUserId: null },
  { id: 'parent', name: 'Parent Unit', parentId: 'company', isActive: true, shareRequests: false, canWorkOnSolutions: false, managerUserId: null },
  { id: 'child', name: 'Child Unit', parentId: 'parent', isActive: true, shareRequests: false, canWorkOnSolutions: true, managerUserId: null },
  { id: 'defaults', name: 'Defaults Only', parentId: 'company', isActive: true, shareRequests: false, canWorkOnSolutions: false, managerUserId: null },
]

const positions: PositionNode[] = [
  { id: 'p-one', name: 'First reviewer', rank: 1, isActive: true },
  { id: 'p-two', name: 'Division lead', rank: 2, isActive: true },
  { id: 'p-three', name: 'Executive approver', rank: 3, isActive: true },
]

const assignments: AssignmentNode[] = []
const teams: TeamNode[] = []
const users: WorkspaceSnapshot['users'] = []

const routeSources = [
  {
    unitId: 'parent',
    phase: 'REQUEST',
    source: 'CUSTOM',
    sourceUnitId: 'parent',
    publishedVersionId: 'route-parent-request',
    hasDraft: false,
    steps: [
      { order: 1, positionId: 'p-one', positionName: 'First reviewer' },
      { order: 2, positionId: 'p-two', positionName: 'Division lead' },
    ],
    approvalLimitPositionId: 'p-two',
    approvalLimitName: 'Division lead',
  },
  {
    unitId: 'child',
    phase: 'REQUEST',
    source: 'INHERITED',
    sourceUnitId: 'parent',
    publishedVersionId: 'route-parent-request',
    hasDraft: false,
    steps: [
      { order: 1, positionId: 'p-one', positionName: 'First reviewer' },
      { order: 2, positionId: 'p-two', positionName: 'Division lead' },
    ],
    approvalLimitPositionId: 'p-two',
    approvalLimitName: 'Division lead',
  },
  {
    unitId: 'child',
    phase: 'SOLUTION',
    source: 'CUSTOM',
    sourceUnitId: 'child',
    publishedVersionId: 'route-child-solution',
    hasDraft: false,
    steps: [{ order: 1, positionId: 'p-three', positionName: 'Executive approver' }],
    approvalLimitPositionId: 'p-three',
    approvalLimitName: 'Executive approver',
  },
  {
    unitId: 'child',
    phase: 'FINAL',
    source: 'ROOT_DEFAULT',
    sourceUnitId: 'company',
    publishedVersionId: 'route-company-final',
    hasDraft: true,
    steps: [{ order: 1, positionId: 'p-one', positionName: 'First reviewer' }],
    approvalLimitPositionId: 'p-one',
    approvalLimitName: 'First reviewer',
  },
  {
    unitId: 'defaults',
    phase: 'REQUEST',
    source: 'ROOT_DEFAULT',
    sourceUnitId: 'company',
    publishedVersionId: 'route-company-request',
    hasDraft: false,
    steps: [{ order: 1, positionId: 'p-one', positionName: 'First reviewer' }],
    approvalLimitPositionId: 'p-one',
    approvalLimitName: 'First reviewer',
  },
] as unknown as WorkspaceSnapshot['routeSources']

const snapshot: WorkspaceSnapshot = {
  units,
  positions,
  assignments,
  teams,
  users,
  unassignedUsers: [],
  routeSources,
  customChainExceptions: [],
  readiness: { ready: true, blockers: [] },
}

describe('approved organization UI design', () => {
  it('shows local and inherited branch badges, including both for mixed scopes, but not root defaults', () => {
    const html = renderToStaticMarkup(createElement(OrganizationTree, { snapshot }))
    assert.match(html, /data-testid="unit-exception-badge-parent-local"/)
    assert.match(html, /data-testid="unit-exception-badge-child-inherited"/)
    assert.match(html, /data-testid="unit-exception-badge-child-local"/)
    assert.doesNotMatch(html, /unit-exception-badge-company/)
    assert.doesNotMatch(html, /unit-exception-badge-defaults/)
    assert.match(html, /Inherited from Parent Unit/)
    assert.match(html, /Request · Custom at this unit/)
  })

  it('keeps unit exception details read-only and sends one manage link to Approval chains', () => {
    const html = renderToStaticMarkup(createElement(UnitSidePanel, {
      unit: units.find((unit) => unit.id === 'child')!,
      snapshot,
      showTitle: true,
    }))
    assert.doesNotMatch(html, /Effective route source/)
    assert.doesNotMatch(html, /data-testid="route-view-/)
    assert.doesNotMatch(html, /data-testid="route-customize-/)
    assert.equal((html.match(/data-testid="manage-in-approval-chains-link"/g) ?? []).length, 1)
    assert.match(html, /Approval chain exceptions/)
    assert.match(html, /REQUEST/)
    assert.match(html, /SOLUTION/)
    assert.match(html, /First reviewer/)
    assert.match(html, /Division lead/)
    assert.match(html, /→/)
    assert.match(html, /Approval limit:/)
    assert.match(html, /Division lead/)
    assert.match(html, /Custom at this unit/)
    assert.match(html, /Inherited from Parent Unit/)
  })

  it('uses a compact title-header close instead of a giant reserved close lane', () => {
    const html = renderToStaticMarkup(createElement(InTreeModal, {
      open: true,
      onClose: () => {},
      ariaLabel: 'Manage unit',
      titleId: 'unit-modal-title',
      title: 'Child Unit',
      children: createElement('div', { 'data-testid': 'modal-content' }, 'Content'),
    }))
    assert.match(html, /data-testid="modal-header"/)
    assert.ok(html.indexOf('data-testid="modal-header"') < html.indexOf('aria-label="Close"'))
    assert.match(html, /Child Unit/)
    assert.doesNotMatch(html, /sticky top-0/)
    assert.doesNotMatch(html, /h-14/)
    assert.match(html, /data-testid="modal-content"/)
  })

  it('keeps the implementation responsive and preserves modal defaultPrevented Escape handling', () => {
    const modal = read('src/components/organization/InTreeModal.tsx')
    assert.match(modal, /max-h-\[calc\(100dvh-2rem\)\]/)
    assert.match(modal, /overflow-y-auto/)
    assert.match(modal, /event\.defaultPrevented/)
    assert.match(modal, /restoreFocusRef/)
  })
})
