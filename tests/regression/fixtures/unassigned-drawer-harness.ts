// Client-side hydration harness for the exactly-one-management-drawer test.
// Bundled by esbuild at test time (see flowchart-visual-polish.test.ts) and
// mounted in headless chromium so the Unassigned chip and the unit/person/
// team drawers run the REAL OrganizationWorkspace state machine.
// The fixture mirrors the visual-polish shape: Factory -> Admin Division ->
// GA Department (manager, staff, supervisor, team member + team) plus one
// unassigned user so the Unassigned · N chip is live.
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { OrganizationWorkspace } from '@/components/organization/OrganizationWorkspace'
import type { AssignmentNode, OrganizationUnitNode, PositionNode, TeamNode } from '@/lib/organization/model'
import type { WorkspaceSnapshot } from '@/server-actions/organization'

const units: OrganizationUnitNode[] = [
  { id: 'udh-company', name: 'Factory', parentId: null, isActive: true, shareRequests: false, canWorkOnSolutions: false, managerUserId: 'udh-dana' },
  { id: 'udh-admin', name: 'Admin Division', parentId: 'udh-company', isActive: true, shareRequests: true, canWorkOnSolutions: false, managerUserId: null },
  { id: 'udh-ga', name: 'GA Department', parentId: 'udh-admin', isActive: true, shareRequests: false, canWorkOnSolutions: false, managerUserId: 'udh-ga-manager' },
  { id: 'udh-hr', name: 'HR Department', parentId: 'udh-admin', isActive: true, shareRequests: false, canWorkOnSolutions: false, managerUserId: null },
]

const positions: PositionNode[] = [
  { id: 'udh-pos-dept-manager', name: 'Department manager', rank: 3, isActive: true },
  { id: 'udh-pos-supervisor', name: 'Supervisor', rank: 2, isActive: true },
  { id: 'udh-pos-staff', name: 'Staff', rank: 1, isActive: true },
]

const assignments: AssignmentNode[] = [
  { id: 'udh-asg-dana', userId: 'udh-dana', unitId: 'udh-company', positionId: 'udh-pos-dept-manager', teamId: null, isActive: true },
  { id: 'udh-asg-ga-manager', userId: 'udh-ga-manager', unitId: 'udh-ga', positionId: 'udh-pos-dept-manager', teamId: null, isActive: true },
  { id: 'udh-asg-ga-staff', userId: 'udh-ga-staff', unitId: 'udh-ga', positionId: 'udh-pos-staff', teamId: null, isActive: true },
  { id: 'udh-asg-ga-supervisor', userId: 'udh-ga-supervisor', unitId: 'udh-ga', positionId: 'udh-pos-supervisor', teamId: null, isActive: true },
  { id: 'udh-asg-ga-member', userId: 'udh-ga-member', unitId: 'udh-ga', positionId: 'udh-pos-staff', teamId: 'udh-team-line', isActive: true },
  { id: 'udh-asg-hr-staff', userId: 'udh-hr-staff', unitId: 'udh-hr', positionId: 'udh-pos-staff', teamId: null, isActive: true },
]

const teams: TeamNode[] = [
  { id: 'udh-team-line', name: 'GA Line Team', unitId: 'udh-ga', reportsToAssignmentId: 'udh-asg-ga-manager', isActive: true },
]

const users: WorkspaceSnapshot['users'] = [
  { id: 'udh-dana', name: 'Dana Manager', email: 'dana@example.com', role: 'general_dept', isActive: true },
  { id: 'udh-ga-manager', name: 'Mock Department Manager — GA', email: 'ga-manager@example.com', role: 'general_dept', isActive: true },
  { id: 'udh-ga-staff', name: 'Mock Staff 1 — GA', email: 'ga-staff@example.com', role: 'general_dept', isActive: true },
  { id: 'udh-ga-supervisor', name: 'Mock Supervisor — GA', email: 'ga-supervisor@example.com', role: 'general_dept', isActive: true },
  { id: 'udh-ga-member', name: 'Mock Member — GA', email: 'ga-member@example.com', role: 'general_dept', isActive: true },
  { id: 'udh-hr-staff', name: 'Mock HR Staff — HR', email: 'hr-staff@example.com', role: 'general_dept', isActive: true },
]

const unassignedUsers: WorkspaceSnapshot['unassignedUsers'] = [
  { id: 'udh-unassigned', name: 'Mock Unassigned — Bench', email: 'unassigned@example.com' },
]

const snapshot: WorkspaceSnapshot = {
  units,
  positions,
  assignments,
  teams,
  users,
  unassignedUsers,
  routeSources: [],
  customChainExceptions: [],
  readiness: { ready: true, blockers: [] },
}

const container = document.querySelector('[data-testid="unassigned-drawer-harness-root"]')
if (!container) throw new Error('missing unassigned-drawer-harness-root')

createRoot(container).render(
  createElement(OrganizationWorkspace, { snapshot }),
)
