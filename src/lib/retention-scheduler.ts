import { shouldRunDailyArchive } from '@/lib/retention-policy'
import { applyRetentionArchive, getResolvedRetentionPolicy, readRetentionSettingsRow } from '@/lib/retention-archive'
import { runStorageAlertCheck } from '@/lib/storage-alert'

const CHECK_EVERY_MS = 60_000

let started = false

export function startRetentionArchiveClock() {
  if (started || process.env.NEXT_RUNTIME === 'edge') return
  started = true

  const tick = async () => {
    try {
      const policy = await getResolvedRetentionPolicy()
      const row = await readRetentionSettingsRow()

      if (shouldRunDailyArchive({
        archiveEnabled: policy.archiveEnabled,
        hour: policy.archiveHour,
        minute: policy.archiveMinute,
        lastRunOn: row?.lastArchiveRunOn ?? null,
        now: new Date(),
      })) {
        const result = await applyRetentionArchive('clock')
        console.log(`[retention-clock] Archived ${result.archived} requests`)
      }
    } catch (error) {
      console.error('[retention-clock] Failed to run daily archive', error)
    }

    // Disk-usage alert runs on its own once-per-day guard, independent of
    // the archive policy, so it fires even when auto-archive is off.
    try {
      const alert = await runStorageAlertCheck()
      if (alert.sent) {
        console.log(`[retention-clock] Storage alert emailed (disk ${alert.usedPercent}% full)`)
      }
    } catch (error) {
      console.error('[retention-clock] Failed to run storage alert check', error)
    }
  }

  void tick()
  setInterval(() => {
    void tick()
  }, CHECK_EVERY_MS)
}
