import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth-config'
import prisma from '@/lib/prisma'

/**
 * GET /api/actions/pending-count
 * Returns the count of pending approval actions for the current user
 */
export async function GET() {
  try {
    const { user: _authUser } = (await auth()) ?? {}; const userId = _authUser?.id

    if (!userId) {
      return NextResponse.json({ count: 0 }, { status: 401 })
    }

    // Get user's level and department
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { level: true, departmentId: true },
    })

    if (!user || user.level === null) {
      return NextResponse.json({ count: 0 })
    }

    // Count pending approvals where user can approve
    // User can approve if:
    // 1. The approval is for their level in their department (if they have one)
    // 2. OR they're a cross-department approver at that level

    const [departmentApprovals, crossDepartmentApprovals] = await Promise.all([
      // Approvals in user's own department at their level (only if user has a department)
      user.departmentId
        ? prisma.request_approvals.count({
            where: {
              status: 'pending',
              requiredLevel: user.level,
              request: {
                departmentId: user.departmentId,
              },
            },
          })
        : 0,
      // Cross-department approvals where user is listed as approver
      prisma.request_approvals.count({
        where: {
          status: 'pending',
          requiredApproverId: userId,
        },
      }),
    ])

    const count = departmentApprovals + crossDepartmentApprovals

    return NextResponse.json({ count })
  } catch (error) {
    console.error('Error fetching pending count:', error)
    return NextResponse.json({ count: 0 }, { status: 500 })
  }
}
