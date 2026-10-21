'use server'

// Client-callable organization admin actions. Thin wrappers only: the
// test-injectable cores live in '@/lib/organization/workspace-admin' (not a
// server-action module). Wrappers never accept or forward a db argument, so
// every call runs the production store factory and its requireAdmin check.

import * as core from '@/lib/organization/workspace-admin'

export type {
  OrganizationAssignmentMutationDb,
  OrganizationMutationDb,
  OrganizationPositionMutationDb,
  OrganizationTeamDeactivationDb,
  OrganizationTeamMutationDb,
  OrganizationUnitDeactivationDb,
  OrganizationUnitMutationDb,
  OrganizationWorkspaceDb,
  RankChangeImpact,
  RouteSourceKind,
  WorkspaceRouteStep,
  WorkspaceRouteVersion,
  WorkspaceSnapshot,
  WorkspaceUser,
} from '@/lib/organization/workspace-admin'

export async function getOrganizationWorkspaceData() {
  return core.getOrganizationWorkspaceData()
}

export async function renameOrganizationUnit(input: Parameters<typeof core.renameOrganizationUnit>[0]) {
  return core.renameOrganizationUnit(input)
}

export async function renameTeam(input: Parameters<typeof core.renameTeam>[0]) {
  return core.renameTeam(input)
}

export async function createOrganizationUnit(input: Parameters<typeof core.createOrganizationUnit>[0]) {
  return core.createOrganizationUnit(input)
}

export async function updateUnitSettings(input: Parameters<typeof core.updateUnitSettings>[0]) {
  return core.updateUnitSettings(input)
}

export async function setUnitManager(input: Parameters<typeof core.setUnitManager>[0]) {
  return core.setUnitManager(input)
}

export async function deactivateOrganizationUnit(input: Parameters<typeof core.deactivateOrganizationUnit>[0]) {
  return core.deactivateOrganizationUnit(input)
}

export async function deactivateTeam(input: Parameters<typeof core.deactivateTeam>[0]) {
  return core.deactivateTeam(input)
}

export async function assignPerson(input: Parameters<typeof core.assignPerson>[0]) {
  return core.assignPerson(input)
}

export async function moveAssignment(input: Parameters<typeof core.moveAssignment>[0]) {
  return core.moveAssignment(input)
}

export async function removeAssignment(input: Parameters<typeof core.removeAssignment>[0]) {
  return core.removeAssignment(input)
}

export async function createTeam(input: Parameters<typeof core.createTeam>[0]) {
  return core.createTeam(input)
}

export async function updateTeam(input: Parameters<typeof core.updateTeam>[0]) {
  return core.updateTeam(input)
}

export async function createPosition(input: Parameters<typeof core.createPosition>[0]) {
  return core.createPosition(input)
}

export async function renamePosition(input: Parameters<typeof core.renamePosition>[0]) {
  return core.renamePosition(input)
}

export async function changePositionRank(input: Parameters<typeof core.changePositionRank>[0]) {
  return core.changePositionRank(input)
}

export async function deactivatePosition(input: Parameters<typeof core.deactivatePosition>[0]) {
  return core.deactivatePosition(input)
}

export async function reactivatePosition(input: Parameters<typeof core.reactivatePosition>[0]) {
  return core.reactivatePosition(input)
}

export async function deletePosition(input: Parameters<typeof core.deletePosition>[0]) {
  return core.deletePosition(input)
}
