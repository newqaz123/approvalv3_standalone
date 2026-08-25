export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const { startRetentionArchiveClock } = await import('@/lib/retention-scheduler')
  startRetentionArchiveClock()
}
