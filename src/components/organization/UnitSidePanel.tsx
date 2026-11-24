'use client'

import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { Eye, Info, Share2, Wrench } from 'lucide-react'
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
import { canWorkOnSolutions as hasSolutionWorkAccess } from '@/lib/solution-eligibility'
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
import type { Translator } from '@/lib/i18n/messages'
import { useTranslations } from '@/lib/i18n/client'

const PHASES = ['REQUEST', 'SOLUTION', 'FINAL'] as const
const PHASE_LABEL: Record<(typeof PHASES)[number], string> = {
  REQUEST: 'Request',
  SOLUTION: 'Solution',
  FINAL: 'Final',
}
const NONE_MANAGER = 'none'

function SettingInfoTooltip({
  label,
  description,
  testId,
}: {
  label: string
  description: string
  testId: string
}): React.JSX.Element {
  const t = useTranslations()
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
          aria-label={t('admin.settingInformation', { label })}
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
  t: Translator,
  source: WorkspaceSnapshot['routeSources'][number]['source'],
  sourceUnitName: string | null,
): string {
  if (source === 'CUSTOM') return t('admin.customAtUnit')
  if (source === 'ROOT_DEFAULT') return t('admin.usesCompanyDefault')
  return t('admin.inheritedFrom', { name: sourceUnitName ?? t('admin.ancestor') })
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
  t: Translator,
  row: RouteSource,
  unitsById: ReadonlyMap<string, OrganizationUnitNode>,
): string {
  const sourceName = row.sourceUnitId ? unitsById.get(row.sourceUnitId)?.name ?? null : null
  return formatRouteSourceLabel(t, row.source, sourceName)
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
  const t = useTranslations()
  const rows = exceptionRouteSourcesForUnit(snapshot, unit.id)
  const unitsById = new Map(snapshot.units.map((row) => [row.id, row]))
  const positionsById = new Map(snapshot.positions.map((row) => [row.id, row]))
  return (
    <section data-testid="unit-exception-chains" className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 data-testid="approval-chain-label" className="text-sm font-semibold">{t('admin.whoMustApprove')}</h3>
          <p className="text-xs text-muted-foreground">{t('admin.unitExceptionsHelp')}</p>
          <p className="text-xs text-muted-foreground">{t('admin.approvalIndependent')}</p>
        </div>
      </div>
      {rows.length === 0 ? (
        <p data-testid="unit-exception-chains-empty" className="rounded-md border bg-muted/20 px-3 py-3 text-sm text-muted-foreground">
          {t('admin.noUnitExceptions')}
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
                    {routeSourceText(t, row, unitsById)}
                  </span>
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('admin.configuredSteps')}</p>
                  {steps.length > 0 ? (
                    <div
                      data-testid={`unit-exception-steps-${row.phase}`}
                      className="flex flex-wrap items-center gap-1 text-sm"
                      aria-label={t('admin.configuredPhaseSteps', { phase: PHASE_LABEL[row.phase] })}
                    >
                      {steps.map((step, index) => (
                        <React.Fragment key={`${step.order}-${step.positionId}`}>
                          {index > 0 ? <span aria-hidden="true" className="px-0.5 text-muted-foreground">→</span> : null}
                          <span className="rounded-full border bg-background px-2 py-0.5">{routeStepText(step, positionsById)}</span>
                        </React.Fragment>
                      ))}
                    </div>
                  ) : (
                    <p data-testid={`unit-exception-steps-${row.phase}`} className="text-sm text-muted-foreground">{t('admin.noneConfigured')}</p>
                  )}
                </div>
                <p data-testid={`unit-exception-limit-${row.phase}`} className="text-sm">
                  <span className="font-medium">{t('admin.approvalLimitLabel')}</span>{' '}
                  {limitName ?? t('admin.notAvailable')}
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
        {t('admin.manageApprovalChains')}
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
  const t = useTranslations()
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
            {t('admin.deactivateUnitQuestion', { name: unitName })}
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="destructive"
              data-testid="unit-deactivate-confirm"
              onClick={onConfirm}
              disabled={saving}
            >
              {t('admin.deactivateUnit')}
            </Button>
            <Button
              type="button"
              variant="outline"
              data-testid="unit-deactivate-cancel"
              onClick={onCancel}
              disabled={saving}
            >
              {t('common.cancel')}
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
          {t('admin.deactivateUnit')}
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
  onSettingsSaved?: (patch: { shareRequests: boolean; canWorkOnSolutions: boolean; engineeringCanViewAllRequests: boolean }) => void
  onManagerSaved?: (managerUserId: string | null) => void
  onCreateTeam?: (unitId: string) => void
  onDeactivated?: (unitId: string) => void
  /** Standalone harnesses keep the heading; the modal owns its title header. */
  showTitle?: boolean
  /** Modal content should not add a second card or competing scroll surface. */
  inModal?: boolean
}) {
  const t = useTranslations()
  const [shareRequests, setShareRequests] = useState(unit.shareRequests)
  const [canWorkOnSolutions, setCanWorkOnSolutions] = useState(unit.canWorkOnSolutions)
  const [engineeringCanViewAllRequests, setEngineeringCanViewAllRequests] = useState(unit.engineeringCanViewAllRequests ?? false)
  const [managerUserId, setManagerUserId] = useState(unit.managerUserId)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirmingDeactivate, setConfirmingDeactivate] = useState(false)
  const [deactivating, setDeactivating] = useState(false)
  const [deactivateError, setDeactivateError] = useState<string | null>(null)

  useEffect(() => {
    setShareRequests(unit.shareRequests)
    setCanWorkOnSolutions(unit.canWorkOnSolutions)
    setEngineeringCanViewAllRequests(unit.engineeringCanViewAllRequests ?? false)
    setManagerUserId(unit.managerUserId)
    setError(null)
    setConfirmingDeactivate(false)
    setDeactivateError(null)
  }, [unit.id, unit.shareRequests, unit.canWorkOnSolutions, unit.engineeringCanViewAllRequests, unit.managerUserId])

  const candidates = directManagerCandidates(snapshot, unit.id)

  // The view-all grant only works with solution-work access (own or inherited),
  // so the switch is offered only then. The unsaved toggle above counts, and a
  // stored grant stays switchable so it can still be turned off.
  let solutionWorkAccess = false
  try {
    solutionWorkAccess = hasSolutionWorkAccess(
      snapshot.units.map((row) => (row.id === unit.id ? { ...row, canWorkOnSolutions } : row)),
      unit.id,
    )
  } catch {
    solutionWorkAccess = false
  }
  const viewAllUnavailable = !solutionWorkAccess && !engineeringCanViewAllRequests

  async function handleSaveSettings() {
    setError(null)
    setSaving(true)
    try {
      await updateUnitSettings({
        id: unit.id,
        shareRequests,
        canWorkOnSolutions,
        engineeringCanViewAllRequests,
      })
      onSettingsSaved?.({ shareRequests, canWorkOnSolutions, engineeringCanViewAllRequests })
    } catch (err) {
      setError(t('admin.saveUnitSettingsFailed'))
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
      setError(t('admin.setManagerFailed'))
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
      setDeactivateError(t('admin.unitDeactivateFailed'))
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
          <section data-testid="unit-settings" aria-label={t('admin.unitSettings')} className="space-y-3">
            <h3 className="text-sm font-semibold">{t('admin.unitSettings')}</h3>
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
                    {t('admin.requestVisibility')}
                  </Label>
                  <SettingInfoTooltip
                    label={t('admin.requestVisibility')}
                    description={t('admin.requestSharingHelp')}
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
                    {t('admin.canWorkOnSolutions')}
                  </Label>
                  <SettingInfoTooltip
                    label={t('admin.solutionCapability')}
                    description={t('admin.solutionWorkHelp')}
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

            <div className="flex items-start justify-between gap-4 rounded-md border px-3 py-2">
              <div className="flex min-w-0 flex-1 items-start gap-2">
                <span
                  aria-hidden="true"
                  className={`mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border ${engineeringCanViewAllRequests ? SOLUTIONS_FLAG_ON_CLASSES : FLAG_OFF_CLASSES}`}
                >
                  <Eye className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <Label htmlFor="unit-engineering-view-all-requests" className="text-sm font-medium leading-snug">
                    {t('admin.engineeringViewAll')}
                  </Label>
                  <p id="unit-engineering-view-all-requests-help" className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {t('admin.engineeringViewAllHelp')}
                    {solutionWorkAccess ? null : (
                      <span className="mt-1 block font-medium text-foreground">
                        {t('admin.engineeringViewAllRequirement')}
                      </span>
                    )}
                  </p>
                </div>
              </div>
              <Switch
                id="unit-engineering-view-all-requests"
                data-testid="unit-engineering-view-all-requests"
                aria-describedby="unit-engineering-view-all-requests-help"
                checked={engineeringCanViewAllRequests}
                onCheckedChange={setEngineeringCanViewAllRequests}
                disabled={saving || viewAllUnavailable}
                className="shrink-0"
              />
            </div>
          </section>
        </TooltipProvider>

        <section data-testid="unit-manager" aria-label={t('admin.unitManager')} className="space-y-2">
          <h3 className="text-sm font-semibold">{t('admin.unitManager')}</h3>
          <Label htmlFor="unit-manager-select" className="text-xs text-muted-foreground">{t('admin.manager')}</Label>
          <Select
            value={managerUserId ?? NONE_MANAGER}
            onValueChange={(value) => {
              void handleManagerChange(value)
            }}
          >
            <SelectTrigger id="unit-manager-select" data-testid="unit-manager-select">
              <SelectValue placeholder={t('admin.selectManager')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE_MANAGER}>{t('admin.none')}</SelectItem>
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
          <p className="text-xs text-muted-foreground">{t('admin.managerAssignmentHelp')}</p>
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
                {t('admin.createTeam')}
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
              {t('admin.save')}
            </Button>
          </div>
        </div>
      </div>
    </aside>
  )
}
