'use client'

import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { Share2, Wrench } from 'lucide-react'
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
import { personShortName } from '@/lib/organization/person-name'
import {
  FLAG_OFF_CLASSES,
  SHARING_FLAG_ON_CLASSES,
  SOLUTIONS_FLAG_ON_CLASSES,
} from '@/lib/organization/position-tone'
import {
  deactivateOrganizationUnit,
  setUnitManager,
  updateUnitSettings,
  type WorkspaceSnapshot,
} from '@/server-actions/organization'
import { formatOrganizationErrorForUser } from '@/lib/organization/error-formatting'

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
): Array<{ userId: string; name: string; positionName: string }> {
  const usersById = new Map(snapshot.users.map((user) => [user.id, user]))
  const positionsById = new Map(snapshot.positions.map((row) => [row.id, row]))
  const rows: Array<{ userId: string; name: string; positionName: string }> = []
  const seen = new Set<string>()
  for (const assignment of snapshot.assignments) {
    if (!assignment.isActive || assignment.unitId !== unitId) continue
    if (seen.has(assignment.userId)) continue
    seen.add(assignment.userId)
    const user = usersById.get(assignment.userId)
    if (!user || !user.isActive) continue
    // Person-once: the first active assignment carries the option's position
    // so the dropdown row can show "name left, position right" instead of the
    // stored "Name — Unit" qualifier string.
    const positionName = positionsById.get(assignment.positionId)?.name ?? ''
    rows.push({ userId: user.id, name: user.name, positionName })
  }
  rows.sort((left, right) => left.name.localeCompare(right.name))
  return rows
}

/**
 * Danger zone for unit deactivation (deactivate-not-delete). Exported for the
 * component harness: the confirmation step and the adjacent guard error are
 * state-driven variants tests render directly (PositionRankEditor pattern).
 */
export function UnitDeactivationSection({
  unitName,
  confirming,
  saving,
  error,
  onStart,
  onConfirm,
  onCancel,
}: {
  unitName: string
  confirming: boolean
  saving: boolean
  error: string | null
  onStart: () => void
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div data-testid="unit-deactivation-section" className="space-y-2 rounded-md border border-destructive/40 p-3">
      {error ? (
        <p role="alert" data-testid="unit-deactivate-error" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {confirming ? (
        <div data-testid="unit-deactivate-confirmation" className="space-y-2">
          <p className="text-sm">
            {`Deactivate "${unitName}"? The unit disappears from the tree. People, teams, and history are not removed; deactivate children and clear assignments first if the unit still has them.`}
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="destructive"
              data-testid="unit-deactivate-confirm"
              onClick={onConfirm}
              disabled={saving}
            >
              Deactivate unit
            </Button>
            <Button
              type="button"
              variant="outline"
              data-testid="unit-deactivate-cancel"
              onClick={onCancel}
              disabled={saving}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button
          type="button"
          variant="destructive"
          data-testid="unit-deactivate"
          onClick={onStart}
          disabled={saving}
        >
          Deactivate unit
        </Button>
      )}
    </div>
  )
}

export function UnitSidePanel({
  unit,
  snapshot,
  onSettingsSaved,
  onManagerSaved,
  onCreateTeam,
  onDeactivated,
}: {
  unit: OrganizationUnitNode
  snapshot: WorkspaceSnapshot
  onSettingsSaved?: (patch: { shareRequests: boolean; canWorkOnSolutions: boolean }) => void
  onManagerSaved?: (managerUserId: string | null) => void
  onCreateTeam?: (unitId: string) => void
  onDeactivated?: (unitId: string) => void
}) {
  const [shareRequests, setShareRequests] = useState(unit.shareRequests)
  const [canWorkOnSolutions, setCanWorkOnSolutions] = useState(unit.canWorkOnSolutions)
  const [managerUserId, setManagerUserId] = useState(unit.managerUserId)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirmingDeactivate, setConfirmingDeactivate] = useState(false)
  const [deactivating, setDeactivating] = useState(false)
  const [deactivateError, setDeactivateError] = useState<string | null>(null)

  useEffect(() => {
    setShareRequests(unit.shareRequests)
    setCanWorkOnSolutions(unit.canWorkOnSolutions)
    setManagerUserId(unit.managerUserId)
    setError(null)
    setConfirmingDeactivate(false)
    setDeactivateError(null)
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
      setError(err instanceof Error ? formatOrganizationErrorForUser(err.message, snapshot) : formatOrganizationErrorForUser(String(err), snapshot))
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
      setError(err instanceof Error ? formatOrganizationErrorForUser(err.message, snapshot) : formatOrganizationErrorForUser(String(err), snapshot))
    }
  }

  async function handleConfirmDeactivate() {
    setDeactivateError(null)
    setDeactivating(true)
    try {
      await deactivateOrganizationUnit({ unitId: unit.id })
      onDeactivated?.(unit.id)
    } catch (err) {
      // Adjacent error with the confirmation step retained (panel error pattern).
      setDeactivateError(err instanceof Error ? formatOrganizationErrorForUser(err.message, snapshot) : formatOrganizationErrorForUser(String(err), snapshot))
    } finally {
      setDeactivating(false)
    }
  }

  return (
    <aside
      data-testid="unit-side-panel"
      className="max-h-[calc(100vh-2rem)] w-full shrink-0 space-y-6 overflow-y-auto overscroll-contain rounded-lg border bg-card p-4 lg:sticky lg:top-4 lg:w-96"
    >
      {/* Title is the unit NAME: the drawer is titled by what it manages,
          matching the tree card header (no "Manage " prefix). */}
      <h2 className="text-lg font-semibold">{unit.name}</h2>

      <div className="flex items-start justify-between gap-4 rounded-md border px-3 py-2">
        <div className="flex min-w-0 items-start gap-2">
          {/* Same tone language as the tree header icons: sky when ON,
              muted when OFF. aria-hidden: the Label carries the words. */}
          <span
            aria-hidden="true"
            className={`mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border ${shareRequests ? SHARING_FLAG_ON_CLASSES : FLAG_OFF_CLASSES}`}
          >
            <Share2 className="h-3.5 w-3.5" />
          </span>
          <Label htmlFor="unit-share-requests" className="text-sm font-medium leading-snug">
            Share requests within this unit and all its descendants
          </Label>
        </div>
        <Switch
          id="unit-share-requests"
          data-testid="unit-share-requests"
          checked={shareRequests}
          onCheckedChange={setShareRequests}
        />
      </div>

      <div className="flex items-start justify-between gap-4 rounded-md border px-3 py-2">
        <div className="flex min-w-0 items-start gap-2">
          <span
            aria-hidden="true"
            className={`mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border ${canWorkOnSolutions ? SOLUTIONS_FLAG_ON_CLASSES : FLAG_OFF_CLASSES}`}
          >
            <Wrench className="h-3.5 w-3.5" />
          </span>
          <Label htmlFor="unit-can-work-on-solutions" className="text-sm font-medium leading-snug">
            Can work on solutions
          </Label>
        </div>
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
                {/* Name LEFT, position RIGHT (also in the closed trigger via
                    SelectValue): the stored "Name — Unit" qualifier string is
                    never the option label. */}
                <span className="flex w-full items-center justify-between gap-3">
                  <span className="min-w-0 truncate">{personShortName(candidate.name)}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{candidate.positionName}</span>
                </span>
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
                {/* C9: View/Customize open the company-wide Approval chains panel. */}
                <Button type="button" variant="outline" size="sm" asChild>
                  <Link
                    href={`/admin/organization?panel=chains&scope=${unit.id}&phase=${phase}&mode=view`}
                    data-testid={`route-view-${phase}`}
                  >
                    View
                  </Link>
                </Button>
                <Button type="button" variant="outline" size="sm" asChild>
                  <Link
                    href={`/admin/organization?panel=chains&scope=${unit.id}&phase=${phase}`}
                    data-testid={`route-customize-${phase}`}
                  >
                    Customize
                  </Link>
                </Button>
              </div>
            </div>
          )
        })}
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">{error}</p>
      ) : null}

      <UnitDeactivationSection
        unitName={unit.name}
        confirming={confirmingDeactivate}
        saving={deactivating}
        error={deactivateError}
        onStart={() => {
          setDeactivateError(null)
          setConfirmingDeactivate(true)
        }}
        onConfirm={() => {
          void handleConfirmDeactivate()
        }}
        onCancel={() => {
          setConfirmingDeactivate(false)
          setDeactivateError(null)
        }}
      />

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
