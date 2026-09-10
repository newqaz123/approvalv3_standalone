'use client'

import React from 'react'
import { OrganizationTree } from '@/components/organization/OrganizationTree'
import { UnassignedPeopleList } from '@/components/organization/UnassignedPeopleList'
import type { WorkspaceSnapshot } from '@/server-actions/organization'

export function OrganizationWorkspace({ snapshot }: { snapshot: WorkspaceSnapshot }) {
  return (
    <div data-testid="organization-workspace" className="space-y-8">
      <OrganizationTree snapshot={snapshot} />
      <UnassignedPeopleList users={snapshot.unassignedUsers} />
    </div>
  )
}
