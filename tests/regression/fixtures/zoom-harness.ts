// Client-side hydration harness for the flowchart zoom behavioral test.
// Bundled by esbuild at test time (see flowchart-readability.test.ts) and
// mounted in headless chromium so +/- and Fit clicks run the REAL component.
// The fixture mirrors the wide multi-root tree used by the readability tests.
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { OrganizationTree } from '@/components/organization/OrganizationTree'
import { ZoomableFlowchart } from '@/components/organization/ZoomableFlowchart'
import type { AssignmentNode, OrganizationUnitNode, PositionNode, TeamNode } from '@/lib/organization/model'
import type { WorkspaceSnapshot } from '@/server-actions/organization'

const units: OrganizationUnitNode[] = [
  { id: 'zh-company', name: 'Factory', parentId: null, isActive: true, shareRequests: false, canWorkOnSolutions: false, managerUserId: null },
  // Sibling units render in one horizontal row, so six children make the
  // subtree far wider than the 500px test frame (6 x 30rem + gaps): the
  // width ratio exceeds 4:1 so Fit must drop below the 25% manual minimum.
  { id: 'zh-site-a', name: 'Site A Warehouse', parentId: 'zh-company', isActive: true, shareRequests: false, canWorkOnSolutions: false, managerUserId: null },
  { id: 'zh-site-b', name: 'Site B Depot', parentId: 'zh-company', isActive: true, shareRequests: false, canWorkOnSolutions: false, managerUserId: null },
  { id: 'zh-site-c', name: 'Site C Plant', parentId: 'zh-company', isActive: true, shareRequests: false, canWorkOnSolutions: false, managerUserId: null },
  { id: 'zh-site-d', name: 'Site D Mill', parentId: 'zh-company', isActive: true, shareRequests: false, canWorkOnSolutions: false, managerUserId: null },
  { id: 'zh-site-e', name: 'Site E Yard', parentId: 'zh-company', isActive: true, shareRequests: false, canWorkOnSolutions: false, managerUserId: null },
  { id: 'zh-site-f', name: 'Site F Pier', parentId: 'zh-company', isActive: true, shareRequests: false, canWorkOnSolutions: false, managerUserId: null },
]

const positions: PositionNode[] = [
  { id: 'zh-pos-staff', name: 'Staff', rank: 1, isActive: true },
]

const assignments: AssignmentNode[] = []

const teams: TeamNode[] = []

const snapshot: WorkspaceSnapshot = {
  units,
  positions,
  assignments,
  teams,
  users: [],
  unassignedUsers: [],
  routeSources: [],
  customChainExceptions: [],
  readiness: { ready: true, blockers: [] },
}

const container = document.querySelector('[data-testid="zoom-harness-root"]')
if (!container) throw new Error('missing zoom harness root')

createRoot(container).render(
  createElement(
    ZoomableFlowchart,
    null,
    createElement(OrganizationTree, { snapshot }),
  ),
)
