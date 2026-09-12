'use client'

import React from 'react'
import { Badge } from '@/components/ui/badge'
import { TreeNodeRow } from '@/components/organization/TreeNodeRow'
import type { OrganizationUnitNode } from '@/lib/organization/model'
import type { WorkspaceSnapshot } from '@/server-actions/organization'

function childrenByParentId(units: readonly OrganizationUnitNode[]): Map<string, OrganizationUnitNode[]> {
  const byParent = new Map<string, OrganizationUnitNode[]>()
  for (const unit of units) {
    if (unit.parentId === null) continue
    const list = byParent.get(unit.parentId) ?? []
    list.push(unit)
    byParent.set(unit.parentId, list)
  }
  return byParent
}

export function OrganizationTree({
  snapshot,
  onSelectUnit,
  onSelectPerson,
  onSelectTeam,
}: {
  snapshot: WorkspaceSnapshot
  onSelectUnit?: (unitId: string) => void
  onSelectPerson?: (assignmentId: string) => void
  onSelectTeam?: (teamId: string) => void
}) {
  const byParent = childrenByParentId(snapshot.units)
  const roots = snapshot.units
    .filter((unit) => unit.parentId === null && unit.isActive)
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name))

  return (
    <div data-testid="organization-tree" className="space-y-6">
      {snapshot.customChainExceptions.length > 0 ? (
        <div data-testid="custom-chain-exceptions" className="flex flex-wrap gap-1">
          {snapshot.customChainExceptions.map((exception) => (
            <Badge
              key={exception.requestId}
              variant="outline"
              data-testid={`custom-chain-exception-${exception.requestId}`}
              className="text-xs font-normal"
            >
              {exception.title}
            </Badge>
          ))}
        </div>
      ) : null}
      {roots.map((unit) => (
        <TreeNodeRow
          key={unit.id}
          unit={unit}
          snapshot={snapshot}
          childrenByParentId={byParent}
          onSelectUnit={onSelectUnit}
          onSelectPerson={onSelectPerson}
          onSelectTeam={onSelectTeam}
        />
      ))}
    </div>
  )
}
