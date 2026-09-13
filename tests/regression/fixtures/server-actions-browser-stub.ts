// Browser-test double for '@/server-actions/organization'. The browser
// hydration harnesses only RENDER components (zoom harness: the tree;
// unassigned-drawer harness: the whole workspace); the server actions are
// never invoked there. Throwing keeps that guarantee loud if a future test
// starts calling them through this bundle.
export async function renameOrganizationUnit(): Promise<{ ok: true }> {
  throw new Error('renameOrganizationUnit is not available in the browser organization harness')
}

export async function renameTeam(): Promise<{ ok: true }> {
  throw new Error('renameTeam is not available in the browser organization harness')
}

export async function updateUnitSettings(): Promise<{ ok: true }> {
  throw new Error('updateUnitSettings is not available in the browser organization harness')
}

export async function setUnitManager(): Promise<{ ok: true }> {
  throw new Error('setUnitManager is not available in the browser organization harness')
}

export async function deactivateOrganizationUnit(): Promise<{ ok: true }> {
  throw new Error('deactivateOrganizationUnit is not available in the browser organization harness')
}

export async function assignPerson(): Promise<{ ok: true }> {
  throw new Error('assignPerson is not available in the browser organization harness')
}

export async function moveAssignment(): Promise<{ ok: true }> {
  throw new Error('moveAssignment is not available in the browser organization harness')
}

export async function removeAssignment(): Promise<{ ok: true }> {
  throw new Error('removeAssignment is not available in the browser organization harness')
}

export async function createTeam(): Promise<{ ok: true }> {
  throw new Error('createTeam is not available in the browser organization harness')
}

export async function updateTeam(): Promise<{ ok: true }> {
  throw new Error('updateTeam is not available in the browser organization harness')
}

export async function deactivateTeam(): Promise<{ ok: true }> {
  throw new Error('deactivateTeam is not available in the browser organization harness')
}
