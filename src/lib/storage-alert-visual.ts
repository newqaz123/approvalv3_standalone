export type StorageAlertTone = 'slate' | 'amber' | 'destructive'

export type StorageAlertVisualState = {
  alertsOff: boolean
  currentPct: number | null
  wouldAlertNow: boolean
  tone: StorageAlertTone
  markerPct: number | null
  meterRole: 'meter' | undefined
  meterValue: number | undefined
  ariaValueText: string
}

/** Client-safe state resolver for the disk alert rail and its semantics. */
export function resolveStorageAlertVisualState(input: {
  usedPercent: number | null
  thresholdPct: number
}): StorageAlertVisualState {
  const alertsOff = input.thresholdPct <= 0
  const currentPct =
    input.usedPercent == null
      ? null
      : Math.min(100, Math.max(0, Math.round(input.usedPercent)))
  const markerPct = alertsOff
    ? null
    : Math.min(95, Math.max(50, Math.round(input.thresholdPct)))
  const wouldAlertNow =
    markerPct != null && currentPct != null && currentPct >= markerPct
  const approachingLimit =
    markerPct != null &&
    currentPct != null &&
    !wouldAlertNow &&
    currentPct >= markerPct - 10
  const tone: StorageAlertTone = wouldAlertNow
    ? 'destructive'
    : approachingLimit
      ? 'amber'
      : 'slate'

  let ariaValueText: string
  if (currentPct == null) {
    ariaValueText = alertsOff
      ? 'Disk usage unknown. Alerts off.'
      : `Disk usage unknown. Alert threshold ${markerPct}%.`
  } else if (alertsOff) {
    ariaValueText = `Disk ${currentPct}% full. Alerts off.`
  } else {
    ariaValueText = `Disk ${currentPct}% full. Alert threshold ${markerPct}%${
      wouldAlertNow ? '; would alert now' : ''
    }.`
  }

  return {
    alertsOff,
    currentPct,
    wouldAlertNow,
    tone,
    markerPct,
    meterRole: currentPct == null ? undefined : 'meter',
    meterValue: currentPct ?? undefined,
    ariaValueText,
  }
}
