'use client'

import React, { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import type { OrganizationUnitNode } from '@/lib/organization/model'
import {
  setUnitManager,
  updateUnitSettings,
  type WorkspaceSnapshot,
} from '@/server-actions/organization'

const PHASES = ['REQUEST', 'SOLUTION', 'FINAL'] as const
const NONE_MANAGER = 'none'
export const SHARE_REQUESTS_LABEL = 'Share requests within this unit and all its descendants'

export function formatRouteSourceLabel(
  source: WorkspaceSnapshot['routeSources'][number]['source'],
  sourceUnitName: string | null,
): string {
  if (source === 'CUSTOM') return 'Custom at this unit'
  if (source === 'ROOT_DEFAULT') return 'Uses company default'
  return `Inherited from ${sourceUnitName ?? 'ancestor'}`
}

export function directManagerCandidates(
  snapshot: WorkspaceSnapshot,
  unitId: string,
): Array<{ userId: string; name: string }> {
  const usersById = new Map(snapshot.users.map((user) => [user.id, user]))
  const rows: Array<{ userId: string; name: string }> = []
  const seen = new Set<string>()
  for (const assignment of snapshot.assignments) {
    if (!assignment.isActive || assignment.unitId !== unitId) continue
    if (seen.has(assignment.userId)) continue
    seen.add(assignment.userId)
    const user = usersById.get(assignment.userId)
    if (!user || !user.isActive) continue
    rows.push({ userId: user.id, name: user.name })
  }
  rows.sort((left, right) => left.name.localeCompare(right.name))
  return rows
}

export function UnitSidePanel({
  unit,
  snapshot,
  onSettingsSaved,
  onManagerSaved,
  onCreateTeam,
}: {
  unit: OrganizationUnitNode
  snapshot: WorkspaceSnapshot
  onSettingsSaved?: (patch: { shareRequests: boolean; canWorkOnSolutions: boolean }) => void
  onManagerSaved?: (managerUserId: string | null) => void
  onCreateTeam?: (unitId: string) => void
}) {
  const [shareRequests, setShareRequests] = useState(unit.shareRequests)
  const [canWorkOnSolutions, setCanWorkOnSolutions] = useState(unit.canWorkOnSolutions)
  const [managerUserId, setManagerUserId] = useState(unit.managerUserId)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setShareRequests(unit.shareRequests)
    setCanWorkOnSolutions(unit.canWorkOnSolutions)
    setManagerUserId(unit.managerUserId)
    setError(null)
  }, [unit.id, unit.shareRequests, unit.canWorkOnSolutions, unit.managerUserId])

  const candidates = directManagerCandidates(snapshot, unit.id)
  const unitsById = new Map(snapshot.units.map((row) => [row.id, row]))

  async function handleSaveSettings() {
    setError(null)
    setSaving(true)
    try {
      await updateUnitSettings({
        id: unit.id,
        shareRequests,
        canWorkOnSolutions,
      })
      onSettingsSaved?.({ shareRequests, canWorkOnSolutions })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  async function handleManagerChange(value: string) {
    const next = value === NONE_MANAGER ? null : value
    setManagerUserId(next)
    setError(null)
    try {
      await setUnitManager({ unitId: unit.id, managerUserId: next })
      onManagerSaved?.(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <aside
      data-testid="unit-side-panel"
      className="w-full shrink-0 space-y-6 rounded-lg border bg-card p-4 lg:w-96"
    >
      <h2 className="text-lg font-semibold">{`Manage ${unit.name}`}</h2>

      <div className="flex items-start justify-between gap-4 rounded-md border px-3 py-2">
        <Label htmlFor="unit-share-requests" className="text-sm font-medium leading-snug">
          Share requests within this unit and all its descendants
        </Label>
        <Switch
          id="unit-share-requests"
          data-testid="unit-share-requests"
          checked={shareRequests}
          onCheckedChange={setShareRequests}
        />
      </div>

      <div className="flex items-start justify-between gap-4 rounded-md border px-3 py-2">
        <Label htmlFor="unit-can-work-on-solutions" className="text-sm font-medium leading-snug">
          Can work on solutions
        </Label>
        <Switch
          id="unit-can-work-on-solutions"
          data-testid="unit-can-work-on-solutions"
          checked={canWorkOnSolutions}
          onCheckedChange={setCanWorkOnSolutions}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="unit-manager-select">Unit manager</Label>
        <Select
          value={managerUserId ?? NONE_MANAGER}
          onValueChange={(value) => {
            void handleManagerChange(value)
          }}
        >
          <SelectTrigger id="unit-manager-select" data-testid="unit-manager-select">
            <SelectValue placeholder="Select manager" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE_MANAGER}>None</SelectItem>
            {candidates.map((candidate) => (
              <SelectItem key={candidate.userId} value={candidate.userId}>
                {candidate.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-medium">Effective route source</h3>
        {PHASES.map((phase) => {
          const row = snapshot.routeSources.find(
            (candidate) => candidate.unitId === unit.id && candidate.phase === phase,
          )
          const sourceName = row?.sourceUnitId
            ? unitsById.get(row.sourceUnitId)?.name ?? null
            : null
          const label = row
            ? formatRouteSourceLabel(row.source, sourceName)
            : 'No published route'
          return (
            <div key={phase} className="space-y-1 rounded-md border px-3 py-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {phase}
              </p>
              <p data-testid={`route-source-${phase}`} className="text-sm">
                {label}
              </p>
              <div className="flex gap-2">
                {/* C9: View/Customize will open the company-wide chains panel. Stubs only. */}
                <Button type="button" variant="outline" size="sm" data-testid={`route-view-${phase}`}>
                  View
                </Button>
                <Button type="button" variant="outline" size="sm" data-testid={`route-customize-${phase}`}>
                  Customize
                </Button>
              </div>
            </div>
          )
        })}
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">{error}</p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          data-testid="unit-settings-save"
          onClick={() => {
            void handleSaveSettings()
          }}
          disabled={saving}
        >
          Save
        </Button>
        {onCreateTeam ? (
          <Button
            type="button"
            variant="outline"
            data-testid="unit-create-team"
            onClick={() => onCreateTeam(unit.id)}
          >
            Create team
          </Button>
        ) : null}
      </div>
    </aside>
  )
}
