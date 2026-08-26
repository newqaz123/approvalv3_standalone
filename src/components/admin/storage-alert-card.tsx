'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { BellRing } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { saveStorageAlertThreshold } from '@/server-actions/storage-dashboard'

/**
 * Disk-usage alert setting. The signature detail is the live consequence
 * readout: as the admin edits the threshold, the row shows whether the disk
 * would alert right now, against the numbers measured on this page load.
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
  const alertsOff = draftValue === 0

  const wouldAlertNow =
    !alertsOff && usedPercent != null && usedPercent >= draftValue

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
    <section className="rounded-lg border bg-card p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <BellRing className="h-4 w-4" />
            <p className="text-xs font-medium uppercase tracking-[0.14em]">Disk alert</p>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Email all admins when this disk is at or above a set percent full.
            Checked regularly; at most one alert attempt per day.
          </p>
        </div>
        <span role="status" aria-live="polite">
          {alertsOff ? (
            <Badge variant="secondary">Off</Badge>
          ) : (
            <Badge variant={wouldAlertNow ? 'destructive' : 'default'}>
              {wouldAlertNow ? 'Would alert now' : `Alert at ${draftValue}%`}
            </Badge>
          )}
        </span>
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="alert-threshold">Alert when disk is % full</Label>
          <Input
            id="alert-threshold"
            type="number"
            min={0}
            max={95}
            step={1}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            className="w-36"
          />
          <p className="text-xs text-muted-foreground">
            0 = off · allowed 50–95
            {rawDraftValue > 0 && rawDraftValue < 50 ? ' · saves as 50' : ''}
          </p>
        </div>
        <Button type="button" onClick={handleSave} disabled={pending || !dirty}>
          {pending ? 'Saving…' : 'Save threshold'}
        </Button>
        <p className="text-sm text-muted-foreground pb-2">
          Disk is {usedPercent == null ? 'unknown' : `${usedPercent}%`} full now
          {lastAlertOn ? ` · last alert attempt ${lastAlertOn}` : ' · no alert attempted yet'}
        </p>
      </div>
    </section>
  )
}
