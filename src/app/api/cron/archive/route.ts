import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

// Number of days after which completed/cancelled requests are archived
const ARCHIVE_AFTER_DAYS = parseInt(process.env.ARCHIVE_AFTER_DAYS || '90', 10)

/**
 * Archival cron endpoint - called by Vercel Cron
 * Marks old completed/cancelled requests as archived to keep active queries fast.
 *
 * Authorization: Vercel automatically sets Authorization header with CRON_SECRET.
 * In local dev, pass the header manually.
 */
export async function GET(request: NextRequest) {
  // Verify authorization
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
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - ARCHIVE_AFTER_DAYS)

    // Find requests that should be archived:
    // - Status is Completed or Cancelled
    // - Last updated more than ARCHIVE_AFTER_DAYS ago
    // - Not already archived
    // - Not deleted
    const result = await prisma.requests.updateMany({
      where: {
        status: { in: ['Completed', 'Cancelled'] },
        updatedAt: { lt: cutoffDate },
        isArchived: false,
        isDeleted: false,
      },
      data: {
        isArchived: true,
      },
    })

    console.log(`[cron/archive] Archived ${result.count} requests older than ${ARCHIVE_AFTER_DAYS} days`)

    return NextResponse.json({
      success: true,
      archived: result.count,
      cutoffDate: cutoffDate.toISOString(),
      archiveAfterDays: ARCHIVE_AFTER_DAYS,
    })
  } catch (error) {
    console.error('[cron/archive] Error during archival:', error)
    return NextResponse.json(
      { error: 'Failed to archive requests' },
      { status: 500 }
    )
  }
}
