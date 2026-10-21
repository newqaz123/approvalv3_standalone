import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth-config'
import prisma from '@/lib/prisma'
import type { OrganizationUnitNode } from '@/lib/organization/model'
import { createRequestVisibilityDb } from '@/lib/request-visibility/scope'
import {
  authorizeUnitUsersQuery,
  listActiveUnitSubtreeUsers,
  type UnitUsersQueryDb,
} from '@/lib/unit-users'

async function loadUnitUsersQueryDb(): Promise<UnitUsersQueryDb> {
  const [unitRows, assignmentRows] = await Promise.all([
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
    prisma.organization_assignments.findMany({
      where: { isActive: true },
      select: {
        userId: true,
        unitId: true,
        isActive: true,
        position: { select: { name: true } },
        user: { select: { id: true, name: true, email: true, isActive: true } },
      },
    }),
  ])
  const units: OrganizationUnitNode[] = unitRows.map((unit) => ({
    id: unit.id,
    name: unit.name,
    parentId: unit.parentId,
    isActive: unit.isActive,
    shareRequests: unit.shareRequests,
    canWorkOnSolutions: unit.canWorkOnSolutions,
    managerUserId: unit.managerUserId,
  }))
  return {
    units,
    assignments: assignmentRows.map((row) => ({
      userId: row.userId,
      unitId: row.unitId,
      isActive: row.isActive,
      positionName: row.position.name,
      user: row.user,
    })),
  }
}

export async function GET(request: NextRequest) {
  const { user: authUser } = (await auth()) ?? {}
  const userId = authUser?.id
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const unitId = request.nextUrl.searchParams.get('unitId')
  if (!unitId) {
    return NextResponse.json({ error: 'unitId is required' }, { status: 400 })
  }

  try {
    const visibilityDb = createRequestVisibilityDb(prisma)
    const actor = await visibilityDb.findActor(userId)
    const authz = authorizeUnitUsersQuery(actor, unitId)
    if (authz === 'unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (authz === 'forbidden') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const db = await loadUnitUsersQueryDb()
    if (!db.units.some((unit) => unit.id === unitId)) {
      return NextResponse.json({ error: 'Unit not found' }, { status: 404 })
    }

    // Rows: { id, name, email, positionName, unitPathNames }
    return NextResponse.json(listActiveUnitSubtreeUsers(db, unitId))
  } catch (error) {
    console.error('Failed to fetch unit users:', error)
    return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 })
  }
}
