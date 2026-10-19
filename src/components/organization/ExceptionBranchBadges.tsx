'use client'

import React from 'react'
import type { ApprovalPhase } from '@/lib/approval-routes/definition'
import type { WorkspaceSnapshot } from '@/server-actions/organization'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

const PHASE_ORDER: readonly ApprovalPhase[] = ['REQUEST', 'SOLUTION', 'FINAL']
const PHASE_LABEL: Record<ApprovalPhase, string> = {
  REQUEST: 'Request',
  SOLUTION: 'Solution',
  FINAL: 'Final',
}

type RouteSource = WorkspaceSnapshot['routeSources'][number]
type ExceptionKind = 'local' | 'inherited'

export function exceptionSourcesForUnit(
  sources: readonly RouteSource[],
  unitId: string,
): ReadonlyArray<RouteSource> {
  return sources
    .filter((source) => (
      source.unitId === unitId
      && (source.source === 'CUSTOM' || source.source === 'INHERITED')
    ))
    .slice()
    .sort((left, right) => PHASE_ORDER.indexOf(left.phase) - PHASE_ORDER.indexOf(right.phase))
}

function sourceLabel(
  source: RouteSource,
  unitsById: ReadonlyMap<string, OrganizationSnapshotUnit>,
): string {
  if (source.source === 'CUSTOM') return 'Custom at this unit'
  const ancestorName = source.sourceUnitId ? unitsById.get(source.sourceUnitId)?.name : undefined
  return `Inherited from ${ancestorName ?? 'ancestor'}`
}

type OrganizationSnapshotUnit = WorkspaceSnapshot['units'][number]

function branchIcon(kind: ExceptionKind): React.JSX.Element {
  const local = kind === 'local'
  return (
    <svg
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="4.5" cy="3.5" r="1.75" fill={local ? 'currentColor' : 'none'} />
      <circle cx="4.5" cy="12.5" r="1.75" fill={local ? 'currentColor' : 'none'} />
      <circle cx="11.5" cy="3.5" r="1.75" fill={local ? 'currentColor' : 'none'} />
      <path d="M4.5 5.25v5.5" />
      <path d="M11.5 5.5V6A2.5 2.5 0 0 1 9 8.5H5.6" />
    </svg>
  )
}

function ExceptionBadge({
  kind,
  label,
  testId,
  compact,
}: {
  kind: ExceptionKind
  label: string
  testId: string
  compact: boolean
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          data-testid={testId}
          role="img"
          tabIndex={0}
          aria-label={label}
          title={label}
          className={`inline-flex shrink-0 items-center justify-center rounded-md border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 ${compact ? 'h-7 w-7' : 'h-6 w-6'} ${kind === 'local' ? 'border-foreground/30 bg-foreground/5 text-foreground' : 'border-muted-foreground/40 bg-transparent text-muted-foreground'}`}
        >
          {branchIcon(kind)}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs leading-5">{label}</TooltipContent>
    </Tooltip>
  )
}

/**
 * Read-only branch marks for the organization tree and unit dialog header.
 * Root-default rows are deliberately excluded: only a published route at the
 * unit or a non-root ancestor is an exception. Spans are focusable tooltip
 * triggers instead of buttons so they never become nested interactive controls
 * inside the existing unit-header interaction surface.
 */
export function ExceptionBranchBadges({
  snapshot,
  unitId,
  unitName,
  compact = false,
}: {
  snapshot: Pick<WorkspaceSnapshot, 'routeSources' | 'units'>
  unitId: string
  unitName: string
  compact?: boolean
}): React.JSX.Element | null {
  const sources = exceptionSourcesForUnit(snapshot.routeSources, unitId)
  if (sources.length === 0) return null
  const unitsById = new Map(snapshot.units.map((unit) => [unit.id, unit]))
  const grouped: Record<ExceptionKind, RouteSource[]> = { local: [], inherited: [] }
  for (const source of sources) {
    grouped[source.source === 'CUSTOM' ? 'local' : 'inherited'].push(source)
  }

  return (
    <TooltipProvider delayDuration={200}>
      <span
        data-testid={`unit-exception-badges-${unitId}`}
        className="inline-flex shrink-0 items-center gap-1"
        aria-label={`${unitName} approval-chain exceptions`}
      >
        {(['local', 'inherited'] as const).map((kind) => {
        const rows = grouped[kind]
        if (rows.length === 0) return null
        const label = rows
          .map((source) => `${PHASE_LABEL[source.phase]} · ${sourceLabel(source, unitsById)}`)
          .join('; ')
          return (
            <ExceptionBadge
              key={kind}
              kind={kind}
              compact={compact}
              testId={`unit-exception-badge-${unitId}-${kind}`}
              label={label}
            />
          )
        })}
      </span>
    </TooltipProvider>
  )
}

export function exceptionSourceLabel(
  source: RouteSource,
  units: readonly OrganizationSnapshotUnit[],
): string {
  return sourceLabel(source, new Map(units.map((unit) => [unit.id, unit])))
}
