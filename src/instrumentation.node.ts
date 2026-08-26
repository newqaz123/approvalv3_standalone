import { startRetentionArchiveClock } from '@/lib/retention-scheduler'

export function registerNodeInstrumentation() {
  startRetentionArchiveClock()
}
