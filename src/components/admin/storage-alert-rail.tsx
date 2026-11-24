'use client'

import React from 'react'
import { cn } from '@/lib/utils'
import { resolveStorageAlertVisualState } from '@/lib/storage-alert-visual'
import { useTranslations } from '@/lib/i18n/client'

export function StorageAlertRail({
  usedPercent,
  thresholdPct,
}: {
  usedPercent: number | null
  thresholdPct: number
}) {
  const t = useTranslations()
  const visualState = resolveStorageAlertVisualState({
    usedPercent,
    thresholdPct,
  })
  const meterAttributes = visualState.meterRole
    ? {
        role: visualState.meterRole,
        'aria-label': t('admin.currentDiskUsage'),
        'aria-valuemin': 0,
        'aria-valuemax': 100,
        'aria-valuenow': visualState.meterValue,
        'aria-valuetext': visualState.alertsOff
          ? t('admin.diskFullAlertsOff', { percent: visualState.currentPct! })
          : t(visualState.wouldAlertNow ? 'admin.diskFullWouldAlert' : 'admin.diskFullThreshold', {
              percent: visualState.currentPct!, threshold: visualState.markerPct!,
            }),
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
          {t('admin.currentDisk')}{' '}
          <strong className="font-mono font-semibold tabular-nums text-foreground">
            {visualState.currentPct == null
              ? t('admin.unknownLower')
              : `${visualState.currentPct}%`}
          </strong>
        </span>
        <span>
          {t('admin.alertThreshold')}{' '}
          <strong className="font-mono font-semibold tabular-nums text-foreground">
            {visualState.alertsOff ? t('admin.offLower') : `${visualState.markerPct}%`}
          </strong>
        </span>
      </div>
    </div>
  )
}
