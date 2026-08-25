import { shouldRunDailyArchive } from '@/lib/retention-policy'
import { applyRetentionArchive, getResolvedRetentionPolicy, readRetentionSettingsRow } from '@/lib/retention-archive'

const CHECK_EVERY_MS = 60_000

let started = false

export function startRetentionArchiveClock() {
  if (started || process.env.NEXT_RUNTIME === 'edge') return
  started = true

  const tick = async () => {
    try {
      const policy = await getResolvedRetentionPolicy()
      const row = await readRetentionSettingsRow()

      if (!shouldRunDailyArchive({
        archiveEnabled: policy.archiveEnabled,
        hour: policy.archiveHour,
        minute: policy.archiveMinute,
        lastRunOn: row?.lastArchiveRunOn ?? null,
        now: new Date(),
      })) {
        return
      }

      const result = await applyRetentionArchive('clock')
      console.log(`[retention-clock] Archived ${result.archived} requests`)
    } catch (error) {
      console.error('[retention-clock] Failed to run daily archive', error)
    }
  }

  void tick()
  setInterval(() => {
    void tick()
  }, CHECK_EVERY_MS)
}
