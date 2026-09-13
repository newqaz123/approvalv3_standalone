// Flowchart organization UI contracts. Pure render/source assertions only:
// no Prisma, database, env, or write actions.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { AssignmentNode, OrganizationUnitNode, PositionNode, TeamNode } from '@/lib/organization/model'
import type { WorkspaceSnapshot } from '@/server-actions/organization'
import { OrganizationWorkspace } from '@/components/organization/OrganizationWorkspace'
import { UnitSidePanel } from '@/components/organization/UnitSidePanel'

const units: OrganizationUnitNode[] = [
  { id: 'flow-root', name: 'Flow Root', parentId: null, isActive: true, shareRequests: false, canWorkOnSolutions: false, managerUserId: null },
  { id: 'flow-child-a', name: 'Flow Child A', parentId: 'flow-root', isActive: true, shareRequests: true, canWorkOnSolutions: false, managerUserId: 'flow-manager' },
  { id: 'flow-child-b', name: 'Flow Child B', parentId: 'flow-root', isActive: true, shareRequests: false, canWorkOnSolutions: true, managerUserId: null },
]

const positions: PositionNode[] = [
  { id: 'flow-manager-position', name: 'Department manager', rank: 3, isActive: true },
  { id: 'flow-staff-position', name: 'Staff', rank: 1, isActive: true },
]

const assignments: AssignmentNode[] = [
  { id: 'flow-manager-assignment', userId: 'flow-manager', unitId: 'flow-child-a', positionId: 'flow-manager-position', teamId: null, isActive: true },
  { id: 'flow-staff-assignment', userId: 'flow-staff', unitId: 'flow-child-a', positionId: 'flow-staff-position', teamId: null, isActive: true },
]

const teams: TeamNode[] = []

const users: WorkspaceSnapshot['users'] = [
  { id: 'flow-manager', name: 'Dana Manager', email: 'dana@example.com', role: 'general_dept', isActive: true },
  { id: 'flow-staff', name: 'Pat Staff', email: 'pat@example.com', role: 'general_dept', isActive: true },
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

describe('flowchart organization UI', () => {
  it('renders white unit cards with parent-child flowchart connectors and wrapping siblings', () => {
    const html = renderWorkspace()
    assert.match(html, /data-testid="unit-card-flow-root"[^>]*organization-unit-card/)
    assert.match(html, /data-testid="unit-card-flow-child-a"[^>]*organization-unit-card/)
    assert.match(html, /data-testid="unit-card-flow-child-b"[^>]*organization-unit-card/)
    assert.match(html, /data-testid="unit-card-flow-root"[^>]*bg-white/)
    assert.match(html, /data-testid="unit-children-flow-root"[^>]*organization-unit-children/)
    assert.match(html, /data-testid="unit-children-flow-root"[^>]*flex-wrap/)
    assert.match(html, /data-testid="unit-connector-flow-child-a"[^>]*organization-flowchart-connector/)
    assert.match(html, /data-testid="unit-connector-flow-child-b"[^>]*organization-flowchart-connector/)
  })

  it('renders a manager row with initials, name, and position, plus an unassigned initials dock', () => {
    const html = renderWorkspace()
    assert.match(html, /data-testid="unit-manager-flow-child-a"/)
    assert.match(html, /data-testid="manager-avatar-flow-manager"[^>]*>DM<\//)
    assert.match(html, /Dana Manager — Department manager/)
    assert.match(html, /data-testid="unassigned-people-list"[^>]*organization-unassigned-dock/)
    assert.match(html, /data-testid="unassigned-avatar-flow-unassigned"[^>]*>AU<\//)
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
})
