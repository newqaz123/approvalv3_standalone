'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { OrganizationUnitNode, OrganizationUnitType } from '@/lib/organization/types'
import { updateOrganizationUnit } from '@/server-actions/organization'

const EXPECTED_PARENT: Record<OrganizationUnitType, OrganizationUnitType | null> = {
  FACTORY: null,
  DIVISION: 'FACTORY',
  DEPARTMENT: 'DIVISION',
  SECTION: 'DEPARTMENT',
}

const NONE_PARENT = '__none__'

export interface OrganizationUnitTreeProps {
  units: OrganizationUnitNode[]
  pendingInstanceCounts: Record<string, number>
  onSaved: () => void
}

function childrenOf(units: OrganizationUnitNode[], parentId: string | null): OrganizationUnitNode[] {
  return units
    .filter((unit) => unit.parentId === parentId)
    .sort((a, b) => a.name.localeCompare(b.name))
}

function UnitRow({
  unit,
  units,
  pendingInstanceCounts,
  onSaved,
}: {
  unit: OrganizationUnitNode
  units: OrganizationUnitNode[]
  pendingInstanceCounts: Record<string, number>
  onSaved: () => void
}) {
  const [pending, startTransition] = useTransition()
  const [name, setName] = useState(unit.name)
  const [parentId, setParentId] = useState(unit.parentId ?? NONE_PARENT)
  const [isActive, setIsActive] = useState(unit.isActive)
  const [error, setError] = useState<string | null>(null)
  const expectedParent = EXPECTED_PARENT[unit.unitType]
  const parentOptions = expectedParent
    ? units.filter((candidate) => candidate.unitType === expectedParent && candidate.id !== unit.id)
    : []
  const pendingCount = pendingInstanceCounts[unit.id] ?? 0

  function save() {
    startTransition(async () => {
      setError(null)
      try {
        await updateOrganizationUnit({
          id: unit.id,
          name,
          parentId: parentId === NONE_PARENT ? null : parentId,
          isActive,
        })
        onSaved()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to update unit')
      }
    })
  }

  return (
    <li className="space-y-3">
      <div className="rounded-md border bg-background p-3 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="font-medium">{unit.name}</p>
            <p className="text-xs text-muted-foreground">
              {unit.unitType} · pending instances {pendingCount}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor={`active-${unit.id}`}>Active</Label>
            <Switch
              id={`active-${unit.id}`}
              checked={isActive}
              onCheckedChange={setIsActive}
              disabled={pending}
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Deactivation is explicit and does not activate a replacement.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor={`name-${unit.id}`}>Name</Label>
            <Input id={`name-${unit.id}`} value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`parent-${unit.id}`}>Parent unit</Label>
            <Select
              value={parentId}
              onValueChange={setParentId}
              disabled={expectedParent === null}
            >
              <SelectTrigger id={`parent-${unit.id}`}>
                <SelectValue placeholder="Select parent" />
              </SelectTrigger>
              <SelectContent>
                {expectedParent === null ? (
                  <SelectItem value={NONE_PARENT}>None (factory)</SelectItem>
                ) : (
                  parentOptions.map((candidate) => (
                    <SelectItem key={candidate.id} value={candidate.id}>
                      {candidate.name}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="button" size="sm" onClick={save} disabled={pending}>
          {pending ? 'Saving...' : 'Save unit'}
        </Button>
      </div>
      <UnitBranch
        units={units}
        parentId={unit.id}
        pendingInstanceCounts={pendingInstanceCounts}
        onSaved={onSaved}
      />
    </li>
  )
}

function UnitBranch({
  units,
  parentId,
  pendingInstanceCounts,
  onSaved,
}: {
  units: OrganizationUnitNode[]
  parentId: string | null
  pendingInstanceCounts: Record<string, number>
  onSaved: () => void
}) {
  const children = childrenOf(units, parentId)
  if (children.length === 0) return null
  return (
    <ul className="space-y-3 border-l pl-4">
      {children.map((unit) => (
        <UnitRow
          key={unit.id}
          unit={unit}
          units={units}
          pendingInstanceCounts={pendingInstanceCounts}
          onSaved={onSaved}
        />
      ))}
    </ul>
  )
}

export function OrganizationUnitTree({ units, pendingInstanceCounts, onSaved }: OrganizationUnitTreeProps) {
  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">Organization units</h2>
        <p className="text-sm text-muted-foreground">
          Edit typed unit parents and active state only. Positions stay independent of system roles.
        </p>
      </div>
      <UnitBranch
        units={units}
        parentId={null}
        pendingInstanceCounts={pendingInstanceCounts}
        onSaved={onSaved}
      />
    </div>
  )
}
