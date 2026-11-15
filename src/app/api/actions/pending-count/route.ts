import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth-config'
import prisma from '@/lib/prisma'
import { CURRENT_INSTANCE_ROW_FILTER, snapshotGroupActionWhere } from '@/lib/approval-engine/current-instance'
import { actionableParentIds } from '@/lib/approval-engine/actionable'

/**
 * GET /api/actions/pending-count
 * Returns how many requests are waiting on the current user right now.
 * Matches the My Actions list: steps blocked by an earlier pending step are
 * not counted, and each request counts once.
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

    const [myRequestRows, mySolutionRows] = await Promise.all([
      prisma.request_approvals.findMany({
        where: {
          OR: requestOrConditions,
          status: 'pending',
          AND: [{ OR: [...CURRENT_INSTANCE_ROW_FILTER] }],
          request: { isDeleted: false, isArchived: false },
        },
        select: { requestId: true, order: true },
      }),
      prisma.solution_approvals.findMany({
        where: {
          OR: solutionOrConditions,
          status: 'pending',
          AND: [{ OR: [...CURRENT_INSTANCE_ROW_FILTER] }],
          solution: { request: { isDeleted: false, isArchived: false } },
        },
        select: { solutionId: true, order: true, solution: { select: { requestId: true } } },
      }),
    ])

    // A step is actionable only when no earlier step of the same document is
    // still pending — the same rule getMyActionItems applies to the list.
    const requestIds = [...new Set(myRequestRows.map((row) => row.requestId))]
    const solutionIds = [...new Set(mySolutionRows.map((row) => row.solutionId))]
    const [pendingRequestRows, pendingSolutionRows] = await Promise.all([
      requestIds.length === 0
        ? []
        : prisma.request_approvals.findMany({
            where: {
              requestId: { in: requestIds },
              status: 'pending',
              OR: [...CURRENT_INSTANCE_ROW_FILTER],
            },
            select: { requestId: true, order: true },
          }),
      solutionIds.length === 0
        ? []
        : prisma.solution_approvals.findMany({
            where: {
              solutionId: { in: solutionIds },
              status: 'pending',
              OR: [...CURRENT_INSTANCE_ROW_FILTER],
            },
            select: { solutionId: true, order: true },
          }),
    ])

    const actionableRequestIds = actionableParentIds(
      myRequestRows.map((row) => ({ parentId: row.requestId, order: row.order })),
      pendingRequestRows.map((row) => ({ parentId: row.requestId, order: row.order })),
    )
    const actionableSolutionIds = actionableParentIds(
      mySolutionRows.map((row) => ({ parentId: row.solutionId, order: row.order })),
      pendingSolutionRows.map((row) => ({ parentId: row.solutionId, order: row.order })),
    )

    // The list shows one row per request, so the badge counts requests too.
    const countedRequestIds = new Set(actionableRequestIds)
    for (const row of mySolutionRows) {
      if (actionableSolutionIds.has(row.solutionId)) countedRequestIds.add(row.solution.requestId)
    }
    const count = countedRequestIds.size

    return NextResponse.json({ count })
  } catch (error) {
    console.error('Error fetching pending count:', error)
    return NextResponse.json({ count: 0 }, { status: 500 })
  }
}
