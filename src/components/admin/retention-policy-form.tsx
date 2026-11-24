'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import { runArchiveNow, saveRetentionSettings, type RetentionSettingsView } from '@/server-actions/retention'
import { RETENTION_REQUEST_STATUSES } from '@/lib/retention-policy'
import { useTranslations } from '@/lib/i18n/client'

export function RetentionPolicyForm({ initial }: { initial: RetentionSettingsView }) {
  const t = useTranslations()
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [archiveEnabled, setArchiveEnabled] = useState(initial.archiveEnabled)
  const [archiveAfterDays, setArchiveAfterDays] = useState(String(initial.archiveAfterDays))
  const [archiveClock, setArchiveClock] = useState(initial.archiveClock)
  const [archiveStatuses, setArchiveStatuses] = useState<string[]>(initial.archiveStatuses)

  function toggleStatus(status: string, checked: boolean) {
    setArchiveStatuses((current) =>
      checked ? [...new Set([...current, status])] : current.filter((item) => item !== status)
    )
  }

  function handleSave() {
    startTransition(async () => {
      const result = await saveRetentionSettings({
        archiveEnabled,
        archiveAfterDays: Number(archiveAfterDays),
        archiveStatuses,
        archiveClock,
      }).catch(() => ({ success: false as const, errorKey: 'admin.savePolicyFailed' as const }))
      if (!result.success) {
        toast.error(t(result.errorKey))
        return
      }
      toast.success(t('admin.retentionSaved'))
      router.refresh()
    })
  }

  function handleRunNow() {
    startTransition(async () => {
      const result = await runArchiveNow()
      if (!result.success) {
        toast.error(t(result.errorKey))
        return
      }
      toast.success(
        result.archived === 0
          ? t('admin.nothingToArchive')
          : t(result.archived === 1 ? 'admin.retentionArchivedSingle' : 'admin.retentionArchivedMany', { count: result.archived })
      )
      router.refresh()
    })
  }

  return (
    <section className="rounded-lg border bg-card p-6 space-y-5">
      <div>
        <h2 className="text-lg font-semibold">{t('admin.archivePolicy')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('admin.retentionDescription')}
        </p>
      </div>

      <div className="flex items-center justify-between gap-4 rounded-md border px-3 py-2">
        <div>
          <p className="text-sm font-medium">{t('admin.autoArchive')}</p>
          <p className="text-xs text-muted-foreground">{t('admin.autoArchiveHelp')}</p>
        </div>
        <Switch checked={archiveEnabled} onCheckedChange={setArchiveEnabled} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="archive-days">{t('admin.archiveAfterDays')}</Label>
          <Input
            id="archive-days"
            type="number"
            min={7}
            max={3650}
            value={archiveAfterDays}
            onChange={(event) => setArchiveAfterDays(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="archive-clock">{t('admin.everyDayAt')}</Label>
          <Input
            id="archive-clock"
            type="time"
            value={archiveClock}
            onChange={(event) => setArchiveClock(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">{t('admin.serverTime')} {initial.timezone}</p>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">{t('admin.autoArchiveStatuses')}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {RETENTION_REQUEST_STATUSES.map((status) => (
            <label key={status} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={archiveStatuses.includes(status)}
                onCheckedChange={(value) => toggleStatus(status, value === true)}
              />
              {status}
            </label>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {t('admin.readyNow', { count: initial.eligibleCount })}
          {initial.lastArchiveRunOn ? t('admin.lastArchiveRun', { date: initial.lastArchiveRunOn }) : t('admin.notRunYet')}
        </p>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={handleRunNow} disabled={pending}>
            {t('admin.runArchiveNow')}
          </Button>
          <Button type="button" onClick={handleSave} disabled={pending}>
            {pending ? t('admin.savingEllipsis') : t('admin.savePolicy')}
          </Button>
        </div>
      </div>
    </section>
  )
}
