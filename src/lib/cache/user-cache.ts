'use server'

import { cache } from 'react'
import { auth } from '@/lib/auth-config'
import prisma from '@/lib/prisma'

const assignmentInclude = {
  organizationAssignments: {
    where: { isActive: true },
    select: {
      unit: {
        select: {
          id: true,
          name: true,
        },
      },
    },
    take: 1,
  },
} as const

function withAssignmentDepartment<T extends {
  organizationAssignments: Array<{ unit: { id: string; name: string } }>
}>(user: T | null) {
  if (!user) return null
  const { organizationAssignments, ...rest } = user
  const unit = organizationAssignments[0]?.unit ?? null
  return {
    ...rest,
    department: unit,
  }
}

/**
 * Get current authenticated user with caching
 * Multiple calls within the same request execute the query only once
 *
 * Uses React.cache() for per-request deduplication.
 * If called multiple times in a single request, the database query executes only once.
 *
 * @returns User with department aliased from the active organization assignment, or null if not authenticated
 */
export const getCurrentUser = cache(async () => {
  const session = await auth()

  if (!session?.user?.id) {
    return null
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: assignmentInclude,
  })
  return withAssignmentDepartment(user)
})

/**
 * Get user by ID with caching
 * Uses primitive argument for proper cache hits (not inline objects)
 *
 * React.cache() uses shallow equality (Object.is) for cache hits.
 * Using primitive string argument ensures cache works correctly.
 *
 * @param userId - User ID (primitive string for proper cache hits)
 * @returns User with department aliased from the active organization assignment, or null if not found
 */
export const getUserById = cache(async (userId: string) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: assignmentInclude,
  })
  return withAssignmentDepartment(user)
})
