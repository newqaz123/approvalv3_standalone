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
import { useTranslations } from '@/lib/i18n/client'

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
  const t = useTranslations()
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
        toast.error(t(result.errorKey, result.errorValues))
        return
      }
      toast.success(
        result.thresholdPct === 0
          ? t('admin.alertDisabled')
          : t('admin.diskThresholdSaved', { percent: result.thresholdPct })
      )
      router.refresh()
    })
  }

  return (
    <section className="rounded-lg border bg-card p-5">
      <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
        <BellRing className="h-4 w-4" />
        <h2 className="text-xs font-medium uppercase tracking-[0.14em]">
          {t('admin.diskAlert')}
        </h2>
        <span role="status" aria-live="polite">
          {visualState.alertsOff ? (
            <Badge variant="secondary">{t('admin.off')}</Badge>
          ) : (
            <Badge variant={visualState.wouldAlertNow ? 'destructive' : 'default'}>
              {visualState.wouldAlertNow ? t('admin.wouldAlertNow') : t('admin.diskAlertAt', { percent: draftValue })}
            </Badge>
          )}
        </span>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        {t('admin.diskAlertHelp')}
      </p>

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <StorageAlertRail
          usedPercent={usedPercent}
          thresholdPct={draftValue}
        />

        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1.5">
            <Label htmlFor="alert-threshold">{t('admin.thresholdPercent')}</Label>
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
            {pending ? t('admin.savingEllipsis') : dirty ? t('admin.saveThreshold') : t('admin.saved')}
          </Button>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t pt-3 text-xs text-muted-foreground">
        <span>
          {t('admin.thresholdRange')}
          {rawDraftValue > 0 && rawDraftValue < 50 ? t('admin.thresholdClamp') : ''}
        </span>
        <span>
          {t('admin.checkDiskFrequency')}
          {lastAlertOn ? t('admin.lastDiskAlertAttempt', { date: lastAlertOn }) : t('admin.noAlertAttempt')}
        </span>
      </div>
    </section>
  )
}
