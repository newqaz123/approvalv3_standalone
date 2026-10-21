'use client'

import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { Info, Share2, Wrench } from 'lucide-react'
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import type { OrganizationUnitNode } from '@/lib/organization/model'
import { personShortName } from '@/lib/organization/person-name'
import { ExceptionBranchBadges } from '@/components/organization/ExceptionBranchBadges'
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
const PHASE_LABEL: Record<(typeof PHASES)[number], string> = {
  REQUEST: 'Request',
  SOLUTION: 'Solution',
  FINAL: 'Final',
}
const NONE_MANAGER = 'none'
export const SHARE_REQUESTS_LABEL = 'Share this unit’s requests with the rest of the department'
export const REQUEST_VISIBILITY_LABEL = 'Request visibility'
export const APPROVAL_CHAIN_LABEL = 'Approval chain — who must approve'
const REQUEST_VISIBILITY_HELP = 'On: people in this unit and sister units in the same department can see these requests. Off: only this unit and managers above it. Engineering can still see requests sent to Engineering. Does not grant approval rights.'
const SOLUTION_CAPABILITY_HELP = 'Grants people in this unit permission to submit and work on solutions; it does not grant approval rights.'

function SettingInfoTooltip({
  label,
  description,
  testId,
}: {
  label: string
  description: string
  testId: string
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const touchTapRef = React.useRef(false)
  const shouldOpenAfterTapRef = React.useRef(false)
  const suppressCloseRef = React.useRef(false)

  function resetTapState() {
    window.setTimeout(() => {
      touchTapRef.current = false
      shouldOpenAfterTapRef.current = false
      suppressCloseRef.current = false
    }, 0)
  }

  return (
    <Tooltip
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && suppressCloseRef.current) return
        setOpen(nextOpen)
      }}
    >
      <TooltipTrigger asChild>
        <button
          type="button"
          data-testid={testId}
          aria-label={`${label} information`}
          className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onPointerDown={(event) => {
            if (event.pointerType !== 'touch') return
            touchTapRef.current = true
            shouldOpenAfterTapRef.current = !open
            if (shouldOpenAfterTapRef.current) setOpen(true)
          }}
          onClick={(event) => {
            const isTouchTap = touchTapRef.current
            const shouldKeepOpen = isTouchTap
              ? shouldOpenAfterTapRef.current
              : event.detail === 0
            if (!isTouchTap && !shouldKeepOpen) return
            if (shouldKeepOpen) {
              suppressCloseRef.current = true
              setOpen(true)
            } else {
              setOpen(false)
            }
            resetTapState()
          }}
        >
          <Info className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-sm whitespace-normal leading-5">
        {description}
      </TooltipContent>
    </Tooltip>
  )
}

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

type RouteSource = WorkspaceSnapshot['routeSources'][number]

export function exceptionRouteSourcesForUnit(
  snapshot: WorkspaceSnapshot,
  unitId: string,
): ReadonlyArray<RouteSource> {
  return snapshot.routeSources
    .filter((row) => (
      row.unitId === unitId
      && (row.source === 'CUSTOM' || row.source === 'INHERITED')
    ))
    .slice()
    .sort((left, right) => PHASES.indexOf(left.phase) - PHASES.indexOf(right.phase))
}

function routeSourceText(
  row: RouteSource,
  unitsById: ReadonlyMap<string, OrganizationUnitNode>,
): string {
  const sourceName = row.sourceUnitId ? unitsById.get(row.sourceUnitId)?.name ?? null : null
  return formatRouteSourceLabel(row.source, sourceName)
}

function routeStepText(
  step: NonNullable<RouteSource['steps']>[number],
  positionsById: ReadonlyMap<string, { name: string }>,
): string {
  return step.positionName ?? positionsById.get(step.positionId)?.name ?? step.positionId
}

/** Read-only effective exception details; root defaults are intentionally absent. */
export function UnitExceptionChains({
  unit,
  snapshot,
}: {
  unit: OrganizationUnitNode
  snapshot: WorkspaceSnapshot
}): React.JSX.Element {
  const rows = exceptionRouteSourcesForUnit(snapshot, unit.id)
  const unitsById = new Map(snapshot.units.map((row) => [row.id, row]))
  const positionsById = new Map(snapshot.positions.map((row) => [row.id, row]))
  return (
    <section data-testid="unit-exception-chains" className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 data-testid="approval-chain-label" className="text-sm font-semibold">{APPROVAL_CHAIN_LABEL}</h3>
          <p className="text-xs text-muted-foreground">Approval chain exceptions are shown here. Read-only here — edit chains in Approval chains.</p>
          <p className="text-xs text-muted-foreground">Approval is independent of request visibility; this chain controls who must approve.</p>
        </div>
      </div>
      {rows.length === 0 ? (
        <p data-testid="unit-exception-chains-empty" className="rounded-md border bg-muted/20 px-3 py-3 text-sm text-muted-foreground">
          No unit-specific exceptions are configured.
        </p>
      ) : (
        <div className="space-y-2 rounded-md border bg-muted/20 p-2">
          {rows.map((row) => {
            const steps = row.steps ?? []
            const limitName = row.approvalLimitName
              ?? (row.approvalLimitPositionId
                ? positionsById.get(row.approvalLimitPositionId)?.name ?? row.approvalLimitPositionId
                : null)
            return (
              <div
                key={`${row.unitId}-${row.phase}`}
                data-testid={`unit-exception-chain-${row.phase}`}
                className="space-y-2 rounded-md border bg-card px-3 py-2.5"
              >
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                  <span className="font-semibold">{PHASE_LABEL[row.phase]}</span>
                  <span className="text-muted-foreground">•</span>
                  <span className={row.source === 'CUSTOM' ? 'font-medium' : 'text-muted-foreground'}>
                    {routeSourceText(row, unitsById)}
                  </span>
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Configured steps</p>
                  {steps.length > 0 ? (
                    <div
                      data-testid={`unit-exception-steps-${row.phase}`}
                      className="flex flex-wrap items-center gap-1 text-sm"
                      aria-label={`${PHASE_LABEL[row.phase]} configured approval steps`}
                    >
                      {steps.map((step, index) => (
                        <React.Fragment key={`${step.order}-${step.positionId}`}>
                          {index > 0 ? <span aria-hidden="true" className="px-0.5 text-muted-foreground">→</span> : null}
                          <span className="rounded-full border bg-background px-2 py-0.5">{routeStepText(step, positionsById)}</span>
                        </React.Fragment>
                      ))}
                    </div>
                  ) : (
                    <p data-testid={`unit-exception-steps-${row.phase}`} className="text-sm text-muted-foreground">None configured</p>
                  )}
                </div>
                <p data-testid={`unit-exception-limit-${row.phase}`} className="text-sm">
                  <span className="font-medium">Approval limit:</span>{' '}
                  {limitName ?? 'Not available'}
                </p>
              </div>
            )
          })}
        </div>
      )}
      <Link
        href="/admin/organization?panel=chains"
        data-testid="manage-in-approval-chains-link"
        className="inline-flex min-h-9 items-center gap-1 rounded-md px-1 text-sm font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Manage in Approval chains
        <span aria-hidden="true">→</span>
      </Link>
    </section>
  )
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
    <div
      data-testid="unit-deactivation-section"
      className={confirming ? 'space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3' : 'space-y-1'}
    >
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
          variant="ghost"
          data-testid="unit-deactivate"
          onClick={onStart}
          disabled={saving}
          className="px-1 text-sm text-destructive hover:bg-destructive/10 hover:text-destructive"
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
  showTitle = true,
  inModal = false,
}: {
  unit: OrganizationUnitNode
  snapshot: WorkspaceSnapshot
  onSettingsSaved?: (patch: { shareRequests: boolean; canWorkOnSolutions: boolean }) => void
  onManagerSaved?: (managerUserId: string | null) => void
  onCreateTeam?: (unitId: string) => void
  onDeactivated?: (unitId: string) => void
  /** Standalone harnesses keep the heading; the modal owns its title header. */
  showTitle?: boolean
  /** Modal content should not add a second card or competing scroll surface. */
  inModal?: boolean
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
      className={inModal
        ? 'w-full space-y-5 p-6'
        : 'max-h-[calc(100vh-2rem)] w-full shrink-0 space-y-6 overflow-y-auto overscroll-contain rounded-lg border bg-card p-4 lg:sticky lg:top-4'}
    >
      {/* The workspace modal owns the visible title header. Keep this heading
          for direct component consumers and the existing accessible seam. */}
      {showTitle !== false ? (
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="min-w-0 truncate text-lg font-semibold">{unit.name}</h2>
          <ExceptionBranchBadges snapshot={snapshot} unitId={unit.id} unitName={unit.name} compact />
        </div>
      ) : null}

      <div className={inModal ? 'grid gap-x-8 gap-y-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]' : 'space-y-5'}>
        <TooltipProvider delayDuration={200}>
          <section data-testid="unit-settings" aria-label="Unit settings" className="space-y-3">
            <h3 className="text-sm font-semibold">Unit settings</h3>
            <div className="flex items-start justify-between gap-4 rounded-md border px-3 py-2">
              <div className="flex min-w-0 flex-1 flex-wrap items-start gap-x-2 gap-y-1">
                {/* Same tone language as the tree header icons: sky when ON,
                    muted when OFF. aria-hidden: the Label carries the words. */}
                <span
                  aria-hidden="true"
                  className={`mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border ${shareRequests ? SHARING_FLAG_ON_CLASSES : FLAG_OFF_CLASSES}`}
                >
                  <Share2 className="h-3.5 w-3.5" />
                </span>
                <span className="flex min-w-0 flex-1 items-center gap-1">
                  <Label htmlFor="unit-share-requests" className="min-w-0 flex-1 text-sm font-medium leading-snug">
                    {REQUEST_VISIBILITY_LABEL}
                  </Label>
                  <SettingInfoTooltip
                    label={REQUEST_VISIBILITY_LABEL}
                    description={REQUEST_VISIBILITY_HELP}
                    testId="unit-share-requests-info"
                  />
                </span>
              </div>
              <Switch
                id="unit-share-requests"
                data-testid="unit-share-requests"
                checked={shareRequests}
                onCheckedChange={setShareRequests}
              />
            </div>

            <div className="flex items-start justify-between gap-4 rounded-md border px-3 py-2">
              <div className="flex min-w-0 flex-1 flex-wrap items-start gap-x-2 gap-y-1">
                <span
                  aria-hidden="true"
                  className={`mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border ${canWorkOnSolutions ? SOLUTIONS_FLAG_ON_CLASSES : FLAG_OFF_CLASSES}`}
                >
                  <Wrench className="h-3.5 w-3.5" />
                </span>
                <span className="flex min-w-0 flex-1 items-center gap-1">
                  <Label htmlFor="unit-can-work-on-solutions" className="min-w-0 flex-1 text-sm font-medium leading-snug">
                    Can work on solutions
                  </Label>
                  <SettingInfoTooltip
                    label="Solution capability"
                    description={SOLUTION_CAPABILITY_HELP}
                    testId="unit-can-work-on-solutions-info"
                  />
                </span>
              </div>
              <Switch
                id="unit-can-work-on-solutions"
                data-testid="unit-can-work-on-solutions"
                checked={canWorkOnSolutions}
                onCheckedChange={setCanWorkOnSolutions}
              />
            </div>
          </section>
        </TooltipProvider>

        <section data-testid="unit-manager" aria-label="Unit manager" className="space-y-2">
          <h3 className="text-sm font-semibold">Unit manager</h3>
          <Label htmlFor="unit-manager-select" className="text-xs text-muted-foreground">Manager</Label>
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
          <p className="text-xs text-muted-foreground">Must be assigned directly to this unit.</p>
        </section>

        <div className={inModal ? 'lg:col-span-2' : ''}>
          <UnitExceptionChains unit={unit} snapshot={snapshot} />
        </div>

        {error ? (
          <p role="alert" className={inModal ? 'lg:col-span-2 text-sm text-destructive' : 'text-sm text-destructive'}>{error}</p>
        ) : null}

        <div className={inModal ? 'lg:col-span-2' : ''}>
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
        </div>

        <div className={inModal ? 'lg:col-span-2' : ''}>
          <div data-testid="unit-actions" className="flex flex-wrap items-center justify-end gap-2 border-t pt-4">
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
          </div>
        </div>
      </div>
    </aside>
  )
}
