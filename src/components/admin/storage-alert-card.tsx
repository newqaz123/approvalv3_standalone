'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { BellRing } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { StorageAlertRail } from '@/components/admin/storage-alert-rail'
import { resolveStorageAlertVisualState } from '@/lib/storage-alert-visual'
import { saveStorageAlertThreshold } from '@/server-actions/storage-dashboard'

/**
 * Compact disk-alert control. The rail makes the relationship between current
 * usage and the draft threshold visible before the admin saves it.
 */
export function StorageAlertCard({
  thresholdPct,
  usedPercent,
  lastAlertOn,
}: {
  thresholdPct: number
  usedPercent: number | null
  lastAlertOn: string | null
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [draft, setDraft] = useState(String(thresholdPct))

  const rawDraftValue = Math.round(Number(draft) || 0)
  const draftValue =
    rawDraftValue <= 0 ? 0 : Math.min(95, Math.max(50, rawDraftValue))
  const dirty = draftValue !== thresholdPct
  const visualState = resolveStorageAlertVisualState({
    usedPercent,
    thresholdPct: draftValue,
  })

  function handleSave() {
    startTransition(async () => {
      const result = await saveStorageAlertThreshold(draftValue)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(
        result.thresholdPct === 0
          ? 'Disk alert turned off'
          : `Admins will be emailed when the disk is ${result.thresholdPct}% full`
      )
      router.refresh()
    })
  }

  return (
    <section className="rounded-lg border bg-card p-5">
      <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
        <BellRing className="h-4 w-4" />
        <h2 className="text-xs font-medium uppercase tracking-[0.14em]">
          Disk alert
        </h2>
        <span role="status" aria-live="polite">
          {visualState.alertsOff ? (
            <Badge variant="secondary">Off</Badge>
          ) : (
            <Badge variant={visualState.wouldAlertNow ? 'destructive' : 'default'}>
              {visualState.wouldAlertNow ? 'Would alert now' : `Alert at ${draftValue}%`}
            </Badge>
          )}
        </span>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        Email all admins when this disk reaches the saved threshold.
      </p>

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <StorageAlertRail
          usedPercent={usedPercent}
          thresholdPct={draftValue}
        />

        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1.5">
            <Label htmlFor="alert-threshold">Threshold (%)</Label>
            <Input
              id="alert-threshold"
              type="number"
              min={0}
              max={95}
              step={1}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              className="w-28 font-mono tabular-nums"
            />
          </div>
          <Button
            type="button"
            onClick={handleSave}
            disabled={pending || !dirty}
          >
            {pending ? 'Saving…' : dirty ? 'Save threshold' : 'Saved'}
          </Button>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t pt-3 text-xs text-muted-foreground">
        <span>
          0 turns alerts off · allowed 50–95
          {rawDraftValue > 0 && rawDraftValue < 50 ? ' · saves as 50' : ''}
        </span>
        <span>
          Checked every minute · at most one alert attempt per day.
          {lastAlertOn ? ` Last attempt: ${lastAlertOn}.` : ' No alert attempted yet.'}
        </span>
      </div>
    </section>
  )
}
