// Browser-test double for '@/server-actions/organization'. The zoom hydration
// harness only RENDERS the tree; the rename server actions are never invoked
// there. Throwing keeps that guarantee loud if a future test starts calling
// them through this bundle.
export async function renameOrganizationUnit(): Promise<{ ok: true }> {
  throw new Error('renameOrganizationUnit is not available in the browser zoom harness')
}

export async function renameTeam(): Promise<{ ok: true }> {
  throw new Error('renameTeam is not available in the browser zoom harness')
}
