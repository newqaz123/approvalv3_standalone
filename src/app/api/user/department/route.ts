import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth-config'
import prisma from '@/lib/prisma'
import { unitPathNames } from '@/lib/unit-labels'
import type { OrganizationUnitNode } from '@/lib/organization/model'

export async function GET() {
  try {
    const session = await auth()

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const assignment = await prisma.organization_assignments.findFirst({
      where: { userId: session.user.id, isActive: true },
      select: { unitId: true },
    })

    if (!assignment) {
      return NextResponse.json({
        id: null,
        name: null,
        unitPathNames: [],
      })
    }

    const units = await prisma.organization_units.findMany({
      select: {
        id: true,
        name: true,
        parentId: true,
        isActive: true,
        shareRequests: true,
        canWorkOnSolutions: true,
        managerUserId: true,
      },
    }) as OrganizationUnitNode[]
    const names = unitPathNames(units, assignment.unitId)

    return NextResponse.json({
      id: assignment.unitId,
      name: names[0] ?? null,
      unitPathNames: names,
    })
  } catch (error) {
    console.error('Failed to fetch user unit:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
