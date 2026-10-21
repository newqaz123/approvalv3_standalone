import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth-config'
import prisma from '@/lib/prisma'
import { unitPathNames } from '@/lib/unit-labels'
import type { OrganizationUnitNode } from '@/lib/organization/model'

export async function GET(request: Request) {
  try {
    const session = await auth()
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Parse query parameters
    const { searchParams } = new URL(request.url)
    const activeOnly = searchParams.get('active') === 'true'

    // Build where clause
    const where: any = {}
    if (activeOnly) {
      where.isActive = true
    }

    const [users, unitRows] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          organizationAssignments: {
            where: { isActive: true },
            select: {
              unitId: true,
              position: { select: { name: true } },
            },
            take: 1,
          },
        },
        orderBy: { name: 'asc' },
      }),
      prisma.organization_units.findMany({
        select: {
          id: true,
          name: true,
          parentId: true,
          isActive: true,
          shareRequests: true,
          canWorkOnSolutions: true,
          managerUserId: true,
        },
      }),
    ])
    const units = unitRows as OrganizationUnitNode[]

    return NextResponse.json(
      users.map((user) => {
        const assignment = user.organizationAssignments[0]
        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          positionName: assignment?.position.name ?? '',
          unitPathNames: assignment ? unitPathNames(units, assignment.unitId) : [],
        }
      })
    )
  } catch (error) {
    console.error('Failed to fetch users:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
