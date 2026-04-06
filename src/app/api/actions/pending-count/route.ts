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

    // Get user's level, department, and role
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { level: true, departmentId: true, role: true },
    })

    if (!user || user.level === null) {
      return NextResponse.json({ count: 0 })
    }

    // Build request_approvals OR conditions (department-aware)
    const requestOrConditions: any[] = [
      { requiredApproverId: userId },
    ]
    if (user.level && user.departmentId) {
      requestOrConditions.push({
        requiredLevel: user.level,
        request: { departmentId: user.departmentId },
      })
    }
    // Add cross-department approver assignments
    const crossDeptApprovals = await prisma.department_approvers.findMany({
      where: { approverId: userId },
      select: { departmentId: true, approverLevel: true },
    })
    for (const cda of crossDeptApprovals) {
      requestOrConditions.push({
        requiredLevel: cda.approverLevel,
        request: { departmentId: cda.departmentId },
      })
    }

    // Build solution_approvals OR conditions (engineering-role-aware)
    const solutionOrConditions: any[] = [
      { requiredApproverId: userId },
    ]
    if (user.level && user.role === 'engineering') {
      solutionOrConditions.push({ requiredLevel: user.level })
    }

    const [requestApprovalCount, solutionApprovalCount] = await Promise.all([
      prisma.request_approvals.count({
        where: {
          OR: requestOrConditions,
          status: 'pending',
          request: { isDeleted: false },
        },
      }),
      prisma.solution_approvals.count({
        where: {
          OR: solutionOrConditions,
          status: 'pending',
          solution: { request: { isDeleted: false } },
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
