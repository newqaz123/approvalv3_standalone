import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth-config'
import prisma from '@/lib/prisma'
import { CURRENT_INSTANCE_ROW_FILTER } from '@/lib/approval-engine/current-instance'
import { snapshotGroupActionWhere } from '@/lib/approval-engine/transactions'

/**
 * GET /api/actions/pending-count
 * Returns the count of pending approval actions for the current user.
 * Action counts stay on Task 9 eligibility + current-instance filters.
 * Ordinary request visibility is not applied here.
 */
export async function GET() {
  try {
    const { user: _authUser } = (await auth()) ?? {}; const userId = _authUser?.id

    if (!userId) {
      return NextResponse.json({ count: 0 }, { status: 401 })
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    })

    if (!user) {
      return NextResponse.json({ count: 0 })
    }

    const requestOrConditions: any[] = [
      { requiredApproverId: userId },
      snapshotGroupActionWhere(userId),
    ]

    const solutionOrConditions: any[] = [
      { requiredApproverId: userId },
      snapshotGroupActionWhere(userId),
    ]

    const [requestApprovalCount, solutionApprovalCount] = await Promise.all([
      prisma.request_approvals.count({
        where: {
          OR: requestOrConditions,
          status: 'pending',
          AND: [{ OR: [...CURRENT_INSTANCE_ROW_FILTER] }],
          request: { isDeleted: false, isArchived: false },
        },
      }),
      prisma.solution_approvals.count({
        where: {
          OR: solutionOrConditions,
          status: 'pending',
          AND: [{ OR: [...CURRENT_INSTANCE_ROW_FILTER] }],
          solution: { request: { isDeleted: false, isArchived: false } },
        },
      }),
    ])

    const count = requestApprovalCount + solutionApprovalCount

    return NextResponse.json({ count })
  } catch (error) {
    console.error('Error fetching pending count:', error)
    return NextResponse.json({ count: 0 }, { status: 500 })
  }
}
