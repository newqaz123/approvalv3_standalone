import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { getAuditTrailForRequest } from '@/server-actions/audit'
import { generateCSVExport, generateJSONExport } from '@/lib/export'
import type { RequestSnapshot } from '@/lib/export'
import prisma from '@/lib/prisma'

/**
 * Export audit trail for a single request
 *
 * Route: GET /api/audit/export/request/[requestId]?format=csv|json
 *
 * Access: Admin-only
 * Returns: CSV or JSON file with download headers
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> }
) {
  try {
    // Await params to get requestId (Next.js 15 async params pattern)
    const { requestId } = await params

    // Admin-only access check
    const adminUserId = await requireAdmin()
    if (!adminUserId) {
      return NextResponse.json(
        { error: 'Unauthorized - Admin access required' },
        { status: 403 }
      )
    }

    // Get format from query params (default: csv)
    const { searchParams } = new URL(request.url)
    const format = searchParams.get('format') || 'csv'

    // Validate format
    if (format !== 'csv' && format !== 'json') {
      return NextResponse.json(
        { error: 'Invalid format. Must be csv or json' },
        { status: 400 }
      )
    }

    // Get audit trail activities for request
    const activities = await getAuditTrailForRequest(requestId)

    if (activities.length === 0) {
      return NextResponse.json(
        { error: 'Request not found or has no activities' },
        { status: 404 }
      )
    }

    // For JSON export, get full request snapshot with all related data
    if (format === 'json') {
      const requestSnapshot = await prisma.requests.findUnique({
        where: { id: requestId },
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

      if (!requestSnapshot) {
        return NextResponse.json(
          { error: 'Request not found' },
          { status: 404 }
        )
      }

      // Generate JSON export
      const jsonData = generateJSONExport([requestSnapshot as RequestSnapshot])

      // Return JSON with download headers
      return new Response(jsonData, {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': `attachment; filename="audit-trail-${requestId}.json"`,
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
        'Content-Disposition': `attachment; filename="audit-trail-${requestId}.csv"`,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    })
  } catch (error) {
    console.error('Error exporting audit trail:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
