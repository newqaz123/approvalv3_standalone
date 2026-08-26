import React from 'react'
import { cn } from '@/lib/utils'
import { resolveStorageAlertVisualState } from '@/lib/storage-alert-visual'

export function StorageAlertRail({
  usedPercent,
  thresholdPct,
}: {
  usedPercent: number | null
  thresholdPct: number
}) {
  const visualState = resolveStorageAlertVisualState({
    usedPercent,
    thresholdPct,
  })
  const meterAttributes = visualState.meterRole
    ? {
        role: visualState.meterRole,
        'aria-label': 'Current disk usage',
        'aria-valuemin': 0,
        'aria-valuemax': 100,
        'aria-valuenow': visualState.meterValue,
        'aria-valuetext': visualState.ariaValueText,
      }
    : {}

  return (
    <div className="min-w-0">
      <div
        className="relative h-2.5 overflow-visible rounded-full bg-muted"
        {...meterAttributes}
      >
        {visualState.currentPct != null ? (
          <span
            className={cn(
              'block h-full rounded-full transition-[width] motion-reduce:transition-none',
              visualState.tone === 'destructive'
                ? 'bg-destructive'
                : visualState.tone === 'amber'
                  ? 'bg-amber-500'
                  : 'bg-slate-800'
            )}
            style={{ width: `${visualState.currentPct}%` }}
          />
        ) : null}
        {visualState.markerPct != null ? (
          <span
            className="absolute -top-1 h-[18px] w-0.5 rounded-full bg-foreground"
            style={{ left: `calc(${visualState.markerPct}% - 1px)` }}
            aria-hidden="true"
          />
        ) : null}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted-foreground">
        <span>
          Current disk{' '}
          <strong className="font-mono font-semibold tabular-nums text-foreground">
            {visualState.currentPct == null
              ? 'unknown'
              : `${visualState.currentPct}%`}
          </strong>
        </span>
        <span>
          Alert threshold{' '}
          <strong className="font-mono font-semibold tabular-nums text-foreground">
            {visualState.alertsOff ? 'off' : `${visualState.markerPct}%`}
          </strong>
        </span>
      </div>
    </div>
  )
}
