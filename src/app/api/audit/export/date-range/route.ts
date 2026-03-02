import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { getAuditTrailForDateRange } from '@/server-actions/audit'
import { generateCSVExport, generateJSONExport } from '@/lib/export'
import type { RequestSnapshot } from '@/lib/export'
import prisma from '@/lib/prisma'

/**
 * Export audit trail for a date range
 *
 * Route: GET /api/audit/export/date-range?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&format=csv|json
 *
 * Access: Admin-only
 * Validation: Max 90 days to prevent timeout
 * Returns: CSV or JSON file with download headers
 */
export async function GET(request: NextRequest) {
  try {
    // Admin-only access check
    const adminUserId = await requireAdmin()
    if (!adminUserId) {
      return NextResponse.json(
        { error: 'Unauthorized - Admin access required' },
        { status: 403 }
      )
    }

    // Parse query parameters
    const { searchParams } = new URL(request.url)
    const startDateParam = searchParams.get('startDate')
    const endDateParam = searchParams.get('endDate')
    const format = searchParams.get('format') || 'csv'

    // Validate required parameters
    if (!startDateParam || !endDateParam) {
      return NextResponse.json(
        { error: 'Missing required parameters: startDate and endDate (YYYY-MM-DD)' },
        { status: 400 }
      )
    }

    // Validate format
    if (format !== 'csv' && format !== 'json') {
      return NextResponse.json(
        { error: 'Invalid format. Must be csv or json' },
        { status: 400 }
      )
    }

    // Parse dates
    const startDate = new Date(startDateParam)
    const endDate = new Date(endDateParam)

    // Validate dates
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return NextResponse.json(
        { error: 'Invalid date format. Use YYYY-MM-DD' },
        { status: 400 }
      )
    }

    // Set endDate to end of day (23:59:59.999) for inclusive filtering
    endDate.setHours(23, 59, 59, 999)

    // Validate date range (max 90 days per RESEARCH.md)
    const daysDiff = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))
    if (daysDiff > 90) {
      return NextResponse.json(
        { error: 'Date range too large. Maximum 90 days allowed' },
        { status: 400 }
      )
    }

    // Get audit trail activities for date range
    const activities = await getAuditTrailForDateRange(startDate, endDate, {
      take: 10000, // Large limit for exports
    })

    if (activities.length === 0) {
      return NextResponse.json(
        { error: 'No activities found in the specified date range' },
        { status: 404 }
      )
    }

    // For JSON export, get full request snapshots for all requests in the activities
    if (format === 'json') {
      // Get unique request IDs from activities (filter out system activities with null requests)
      const requestIds = [...new Set(activities.map((a) => a.request?.id).filter((id): id is string => id !== undefined))]

      // Fetch full snapshots for all requests
      const requestSnapshots = await prisma.request.findMany({
        where: {
          id: {
            in: requestIds,
          },
        },
        include: {
          requester: true,
          department: {
            select: {
              id: true,
              name: true,
            },
          },
          approvals: {
            include: {
              approver: true,
            },
            orderBy: {
              order: 'asc',
            },
          },
          fileAttachments: {
            include: {
              uploadedBy: true,
            },
            orderBy: {
              createdAt: 'desc',
            },
          },
          activities: {
            include: {
              user: true,
            },
            orderBy: {
              createdAt: 'desc',
            },
          },
        },
      })

      // Generate JSON export
      const jsonData = generateJSONExport(requestSnapshots as RequestSnapshot[])

      // Return JSON with download headers
      return new Response(jsonData, {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': `attachment; filename="audit-trail-${startDateParam}-to-${endDateParam}.json"`,
          'Cache-Control': 'no-cache, no-store, must-revalidate',
        },
      })
    }

    // For CSV export, use activities from audit query API
    const csvData = generateCSVExport(activities)

    // Return CSV with download headers
    return new Response(csvData, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="audit-trail-${startDateParam}-to-${endDateParam}.csv"`,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    })
  } catch (error) {
    console.error('Error exporting date range audit trail:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
