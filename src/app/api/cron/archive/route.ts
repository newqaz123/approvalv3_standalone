import { NextRequest, NextResponse } from 'next/server'
import { applyRetentionArchive } from '@/lib/retention-archive'

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret) {
    console.error('CRON_SECRET environment variable is not set')
    return NextResponse.json(
      { error: 'Server misconfiguration: CRON_SECRET not set' },
      { status: 500 }
    )
  }

  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    )
  }

  try {
    const result = await applyRetentionArchive('cron')
    return NextResponse.json({
      success: true,
      archived: result.archived,
      skipped: result.skipped,
      archiveAfterDays: result.policy.archiveAfterDays,
      archiveStatuses: result.policy.archiveStatuses,
      cutoffDate: result.cutoffDate?.toISOString(),
    })
  } catch (error) {
    console.error('[cron/archive] Error during archival:', error)
    return NextResponse.json(
      { error: 'Failed to archive requests' },
      { status: 500 }
    )
  }
}
