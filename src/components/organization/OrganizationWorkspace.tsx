'use client'

import React, { useMemo, useState } from 'react'
import { OrganizationTree } from '@/components/organization/OrganizationTree'
import { UnassignedPeopleList } from '@/components/organization/UnassignedPeopleList'
import { UnitSidePanel } from '@/components/organization/UnitSidePanel'
import type { OrganizationUnitNode } from '@/lib/organization/model'
import type { WorkspaceSnapshot } from '@/server-actions/organization'

type UnitPatch = Partial<Pick<OrganizationUnitNode, 'shareRequests' | 'canWorkOnSolutions' | 'managerUserId'>>

export function OrganizationWorkspace({ snapshot }: { snapshot: WorkspaceSnapshot }) {
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null)
  const [overrides, setOverrides] = useState<Record<string, UnitPatch>>({})

  const viewSnapshot = useMemo(() => {
    const units = snapshot.units.map((unit) => {
      const patch = overrides[unit.id]
      return patch ? { ...unit, ...patch } : unit
    })
    return { ...snapshot, units }
  }, [snapshot, overrides])

  const selected = viewSnapshot.units.find((unit) => unit.id === selectedUnitId) ?? null

  return (
    <div data-testid="organization-workspace" className="flex flex-col gap-8 lg:flex-row">
      <div className="min-w-0 flex-1 space-y-8">
        <OrganizationTree snapshot={viewSnapshot} onSelectUnit={setSelectedUnitId} />
        <UnassignedPeopleList users={viewSnapshot.unassignedUsers} />
      </div>
      {selected ? (
        <UnitSidePanel
          unit={selected}
          snapshot={viewSnapshot}
          onSettingsSaved={(patch) => {
            setOverrides((current) => ({
              ...current,
              [selected.id]: { ...current[selected.id], ...patch },
            }))
          }}
          onManagerSaved={(managerUserId) => {
            setOverrides((current) => ({
              ...current,
              [selected.id]: { ...current[selected.id], managerUserId },
            }))
          }}
        />
      ) : null}
    </div>
  )
}
