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

export function RetentionPolicyForm({ initial }: { initial: RetentionSettingsView }) {
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
      })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success('Retention policy saved')
      router.refresh()
    })
  }

  function handleRunNow() {
    startTransition(async () => {
      const result = await runArchiveNow()
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(
        result.archived === 0
          ? 'No requests were ready to archive'
          : `Archived ${result.archived} request${result.archived === 1 ? '' : 's'}`
      )
      router.refresh()
    })
  }

  return (
    <section className="rounded-lg border bg-card p-6 space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Archive policy</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Archive hides a request. Unarchive brings it back. Hard-delete is only for archived rows and cannot be undone.
        </p>
      </div>

      <div className="flex items-center justify-between gap-4 rounded-md border px-3 py-2">
        <div>
          <p className="text-sm font-medium">Auto-archive</p>
          <p className="text-xs text-muted-foreground">When off, the daily clock does nothing.</p>
        </div>
        <Switch checked={archiveEnabled} onCheckedChange={setArchiveEnabled} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="archive-days">Archive after (days)</Label>
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
          <Label htmlFor="archive-clock">Every day at</Label>
          <Input
            id="archive-clock"
            type="time"
            value={archiveClock}
            onChange={(event) => setArchiveClock(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">Server time: {initial.timezone}</p>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">Statuses that auto-archive</p>
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
          {initial.eligibleCount} ready now
          {initial.lastArchiveRunOn ? ` · last run ${initial.lastArchiveRunOn}` : ' · not run yet'}
        </p>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={handleRunNow} disabled={pending}>
            Run archive now
          </Button>
          <Button type="button" onClick={handleSave} disabled={pending}>
            {pending ? 'Saving…' : 'Save policy'}
          </Button>
        </div>
      </div>
    </section>
  )
}
