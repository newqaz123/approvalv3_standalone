'use client'

import type { WorkspaceSnapshot } from '@/server-actions/organization'

/**
 * Minimal C1 stub. Plan C Task 2 replaces this with the tree workspace.
 */
export function OrganizationWorkspace({ snapshot }: { snapshot: WorkspaceSnapshot }) {
  const blockerCount = snapshot.readiness.blockers.length
  return (
    <div data-testid="organization-workspace-stub" className="rounded-lg border bg-card p-6">
      <p className="text-sm text-muted-foreground">
        Organization workspace ({snapshot.units.length} units, {snapshot.unassignedUsers.length} unassigned
        {blockerCount > 0 ? `, ${blockerCount} readiness blocker(s)` : ', ready'}). Tree UI lands in Task 2.
      </p>
    </div>
  )
}
