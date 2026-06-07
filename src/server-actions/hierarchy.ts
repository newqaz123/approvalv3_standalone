'use server'

import { auth } from '@/lib/auth-config'
import prisma from '@/lib/prisma'
import { revalidatePath } from 'next/cache'

/**
 * Unified representation of a hierarchy member (internal or external approver)
 */
export interface HierarchyMember {
  userId: string
  name: string
  email: string
  level: number
  isExternal: boolean
  departmentApproverId?: string // Set for external approvers
}

/**
 * Get full department hierarchy including both internal users and external DepartmentApprovers
 * Returns a unified list suitable for the hierarchy board
 */
export async function getDepartmentHierarchy(departmentId: string): Promise<{
  department: {
    id: string
    name: string
    type: string
    levelNames?: Record<string, string> | null
  }
  members: HierarchyMember[]
  maxLevel: number
}> {
  const { user: _authUser } = (await auth()) ?? {}; const userId = _authUser?.id
  if (!userId) throw new Error('Unauthorized')

  const admin = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  })
  if (admin?.role !== 'admin') throw new Error('Admin access required')

  const department = await prisma.departments.findUnique({
    where: { id: departmentId },
    include: {
      users: {
        where: { isActive: true, level: { not: null } },
        select: { id: true, name: true, email: true, level: true },
        orderBy: { name: 'asc' },
      },
      departmentApprovers: {
        include: {
          approver: {
            select: { id: true, name: true, email: true },
          },
        },
      },
    },
  })

  if (!department) throw new Error('Department not found')

  const members: HierarchyMember[] = []

  // Track all user IDs to avoid duplicates
  const processedUserIds = new Set<string>()

  // Add internal department users with levels
  for (const user of department.users) {
    members.push({
      userId: user.id,
      name: user.name,
      email: user.email,
      level: user.level!,
      isExternal: false,
    })
    processedUserIds.add(user.id)
  }

  // Add external DepartmentApprover users (only if not already added as internal user)
  for (const da of department.departmentApprovers) {
    // Skip if this user is already processed as an internal user
    if (processedUserIds.has(da.approver.id)) {
      continue
    }
    
    members.push({
      userId: da.approver.id,
      name: da.approver.name,
      email: da.approver.email,
      level: da.approverLevel,
      isExternal: true,
      departmentApproverId: da.id,
    })
  }

  const maxLevel = members.reduce((max, m) => Math.max(max, m.level), 0)

  return {
    department: {
      id: department.id,
      name: department.name,
      type: department.type,
      levelNames: department.levelNames as Record<string, string> | null,
    },
    members,
    maxLevel: Math.max(maxLevel, 3),
  }
}

/**
 * Validate hierarchy updates before persisting
 * Checks: hierarchy must have at least one approver
 * Note: Gaps between levels and non-Level-1 starts are allowed because
 * the approval engine (createApprovalChain) skips empty levels gracefully.
 */
function validateHierarchyUpdates(
  updates: Array<{ userId: string; level: number | null }>,
  allMembers: HierarchyMember[]
): { valid: boolean; error?: string } {
  // Build updated member map and track removals
  const updatedLevels = new Map<string, number | null>()
  let hasRemovals = false

  for (const update of updates) {
    if (update.level === null) {
      hasRemovals = true
    }
    updatedLevels.set(update.userId, update.level)
  }

  // Merge with existing members
  const finalLevels: number[] = []
  for (const member of allMembers) {
    const updatedLevel = updatedLevels.has(member.userId)
      ? updatedLevels.get(member.userId)
      : member.level
    if (updatedLevel !== null && updatedLevel !== undefined) {
      finalLevels.push(updatedLevel)
    }
  }

  // Prevent removing all users from hierarchy
  if (hasRemovals && finalLevels.length === 0) {
    return { valid: false, error: 'Cannot remove all approvers from the hierarchy. At least one approver must remain.' }
  }

  if (finalLevels.length === 0) {
    return { valid: false, error: 'Hierarchy must have at least one level with an approver.' }
  }

  return { valid: true }
}

/**
 * Update hierarchy for a department in batch
 * Handles both internal users (User.level) and external approvers (DepartmentApprover)
 */
export async function updateHierarchy(
  departmentId: string,
  updates: Array<{ userId: string; level: number | null; isExternal?: boolean }>
): Promise<{ success: boolean; error?: string }> {
  const { user: _authUser } = (await auth()) ?? {}; const adminId = _authUser?.id
  if (!adminId) throw new Error('Unauthorized')

  const admin = await prisma.user.findUnique({
    where: { id: adminId },
    select: { role: true, name: true },
  })
  if (admin?.role !== 'admin') throw new Error('Admin access required')

  // Validate no pending approvals
  const validation = await validateHierarchyChange(departmentId)
  if (!validation.allowed) {
    return { success: false, error: validation.error }
  }

  // Fetch current state for validation
  const currentHierarchy = await getDepartmentHierarchy(departmentId)

  // Validate the proposed updates
  const validationResult = validateHierarchyUpdates(updates, currentHierarchy.members)
  if (!validationResult.valid) {
    return { success: false, error: validationResult.error }
  }

  // Process each update
  const operations = []
  for (const update of updates) {
    const currentMember = currentHierarchy.members.find(m => m.userId === update.userId)

    if (update.isExternal || currentMember?.isExternal) {
      // External approver: update or delete DepartmentApprover record
      // Always delete existing records first to avoid duplicates when level changes.
      // The unique constraint is [departmentId, approverId, approverLevel], so an upsert
      // keyed on the NEW level would fail to find the OLD-level record and create a duplicate.
      operations.push(
        prisma.department_approvers.deleteMany({
          where: { departmentId, approverId: update.userId },
        })
      )

      if (update.level !== null) {
        // Re-create at the new level
        operations.push(
          prisma.department_approvers.create({
            data: {
              departmentId,
              approverId: update.userId,
              approverLevel: update.level,
            },
          })
        )
      }
    } else {
      // Internal user: update User.level
      operations.push(
        prisma.user.update({
          where: { id: update.userId },
          data: { level: update.level },
        })
      )

      // Log the change
      if (currentMember && currentMember.level !== update.level) {
        operations.push(
          prisma.hierarchy_change_logs.create({
            data: {
              departmentId,
              adminUserId: adminId,
              targetUserId: update.userId,
              oldLevel: currentMember.level,
              newLevel: update.level ?? 0,
              reason: `Batch hierarchy update: ${currentMember.name}'s level changed from ${currentMember.level} to ${update.level ?? 'none'}`,
            },
          })
        )
      }
    }
  }

  await prisma.$transaction(operations)

  revalidatePath(`/admin/hierarchy`)
  revalidatePath(`/admin/departments/${departmentId}/hierarchy`)
  revalidatePath('/admin/users')

  return { success: true }
}

/**
 * Extended user type that includes external approver info
 */
export interface HierarchyUser {
  id: string
  name: string
  email: string
  level: number | null
  isExternal?: boolean
}

/**
 * Get hierarchy data for a department
 * Returns users grouped by level, including external DepartmentApprovers
 */
export async function getHierarchyData(departmentId: string) {
  const { user: _authUser } = (await auth()) ?? {}; const userId = _authUser?.id
  if (!userId) {
    throw new Error('Unauthorized')
  }

  // Verify user is admin
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  })

  if (user?.role !== 'admin') {
    throw new Error('Admin access required')
  }

  // Get department with users and external approvers
  const department = await prisma.departments.findUnique({
    where: { id: departmentId },
    include: {
      users: {
        where: { isActive: true },
        select: {
          id: true,
          name: true,
          email: true,
          level: true,
        },
        orderBy: { name: 'asc' },
      },
      departmentApprovers: {
        include: {
          approver: {
            select: { id: true, name: true, email: true },
          },
        },
      },
    },
  })

  if (!department) {
    throw new Error('Department not found')
  }

  // Group users by level
  const usersByLevel: Record<number, HierarchyUser[]> = {}
  let maxLevel = 0

  // Track all user IDs to avoid duplicates
  const processedUserIds = new Set<string>()

  // Internal department users
  for (const user of department.users) {
    const level = user.level || 1
    if (!usersByLevel[level]) {
      usersByLevel[level] = []
    }
    usersByLevel[level].push({ ...user, isExternal: false })
    processedUserIds.add(user.id)
    if (level > maxLevel) {
      maxLevel = level
    }
  }

  // External DepartmentApprover users (only add if not already added as internal user)
  for (const da of department.departmentApprovers) {
    // Skip if this user is already processed as an internal user
    if (processedUserIds.has(da.approver.id)) {
      continue
    }
    
    const level = da.approverLevel
    if (!usersByLevel[level]) {
      usersByLevel[level] = []
    }
    usersByLevel[level].push({
      id: da.approver.id,
      name: da.approver.name,
      email: da.approver.email,
      level,
      isExternal: true,
    })
    if (level > maxLevel) {
      maxLevel = level
    }
  }

  // Ensure all levels from 1 to max exist (even if empty)
  for (let i = 1; i <= Math.max(maxLevel, 3); i++) {
    if (!usersByLevel[i]) {
      usersByLevel[i] = []
    }
  }

  return {
    department: {
      id: department.id,
      name: department.name,
      type: department.type,
      levelNames: department.levelNames as Record<string, string> | null,
    },
    usersByLevel,
    maxLevel: Math.max(maxLevel, 3),
  }
}

/**
 * Check if hierarchy can be modified
 * Returns error message if blocked, null if allowed
 */
export async function validateHierarchyChange(departmentId: string): Promise<{
  allowed: boolean
  pendingCount: number
  error?: string
}> {
  const { user: _authUser } = (await auth()) ?? {}; const userId = _authUser?.id
  if (!userId) {
    throw new Error('Unauthorized')
  }

  // Count pending approvals in this department
  const pendingApprovals = await prisma.request_approvals.count({
    where: {
      status: 'pending',
      request: {
        departmentId,
        status: 'ImprovementRequest',
      },
    },
  })

  if (pendingApprovals > 0) {
    return {
      allowed: false,
      pendingCount: pendingApprovals,
      error: `Cannot modify hierarchy - ${pendingApprovals} request(s) have pending approvals. Complete or cancel pending requests first.`,
    }
  }

  return {
    allowed: true,
    pendingCount: 0,
  }
}

/**
 * Get pending approval count for a department (for display)
 */
export async function getPendingApprovalsCount(departmentId: string): Promise<number> {
  return await prisma.request_approvals.count({
    where: {
      status: 'pending',
      request: {
        departmentId,
        status: 'ImprovementRequest',
      },
    },
  })
}

/**
 * Update a user's level in the hierarchy
 * Validates no pending approvals, logs change to audit trail
 */
export async function updateUserLevel(
  userId: string,
  newLevel: number,
  expectedUpdatedAt?: Date
): Promise<{ success: boolean; error?: string }> {
  const { user: _authUser } = (await auth()) ?? {}; const adminId = _authUser?.id
  if (!adminId) {
    throw new Error('Unauthorized')
  }

  // Verify admin role
  const admin = await prisma.user.findUnique({
    where: { id: adminId },
    select: { role: true, name: true },
  })

  if (admin?.role !== 'admin') {
    throw new Error('Admin access required')
  }

  // Get user with department
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      level: true,
      departmentId: true,
      updatedAt: true,
    },
  })

  if (!user) {
    return { success: false, error: 'User not found' }
  }

  if (!user.departmentId) {
    return { success: false, error: 'User must belong to a department' }
  }

  // Validate no pending approvals in department
  const validation = await validateHierarchyChange(user.departmentId)
  if (!validation.allowed) {
    return { success: false, error: validation.error }
  }

  // Optimistic locking - check updatedAt if provided
  if (expectedUpdatedAt && user.updatedAt > expectedUpdatedAt) {
    return {
      success: false,
      error: 'User was modified by another admin. Please refresh and try again.',
    }
  }

  const oldLevel = user.level || 1

  // Skip if no change
  if (oldLevel === newLevel) {
    return { success: true }
  }

  // Update user level and log to audit trail
  await prisma.$transaction([
    // Update user level
    prisma.user.update({
      where: { id: userId },
      data: { level: newLevel },
    }),
    // Log the hierarchy change
    prisma.hierarchy_change_logs.create({
      data: {
        departmentId: user.departmentId!,
        adminUserId: adminId,
        targetUserId: userId,
        oldLevel,
        newLevel,
        reason: `Changed ${user.name}'s approval level from ${oldLevel} to ${newLevel}`,
      },
    }),
  ])

  revalidatePath(`/admin/departments/${user.departmentId}/hierarchy`)
  revalidatePath('/admin/users')

  return { success: true }
}

/**
 * Get hierarchy change history for a department
 */
export async function getHierarchyChangeHistory(departmentId: string, limit = 10) {
  const { user: _authUser } = (await auth()) ?? {}; const userId = _authUser?.id
  if (!userId) {
    throw new Error('Unauthorized')
  }

  // Get recent hierarchy changes for this department
  const changes = await prisma.hierarchy_change_logs.findMany({
    where: {
      departmentId,
    },
    include: {
      adminUser: {
        select: {
          name: true,
          email: true,
        },
      },
      targetUser: {
        select: {
          name: true,
          email: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  })

  return changes.map(change => ({
    id: change.id,
    adminName: change.adminUser.name,
    targetUserName: change.targetUser.name,
    oldLevel: change.oldLevel,
    newLevel: change.newLevel,
    change: change.reason || `Level change from ${change.oldLevel} to ${change.newLevel}`,
    timestamp: change.createdAt,
  }))
}

/**
 * Get hierarchy data for a department - accessible to all authenticated users (read-only)
 * Used for the workflow view available to all users
 */
export async function getHierarchyDataForUser(departmentId: string) {
  const { user: _authUser } = (await auth()) ?? {}; const userId = _authUser?.id
  if (!userId) {
    throw new Error('Unauthorized')
  }

  // Get department with users
  const department = await prisma.departments.findUnique({
    where: { id: departmentId },
    include: {
      users: {
        where: { isActive: true },
        select: {
          id: true,
          name: true,
          email: true,
          level: true,
        },
        orderBy: { name: 'asc' },
      },
    },
  })

  if (!department) {
    throw new Error('Department not found')
  }

  // Group users by level
  const usersByLevel: Record<number, typeof department.users> = {}
  let maxLevel = 0

  for (const user of department.users) {
    const level = user.level || 1
    if (!usersByLevel[level]) {
      usersByLevel[level] = []
    }
    usersByLevel[level].push(user)
    if (level > maxLevel) {
      maxLevel = level
    }
  }

  // Ensure all levels from 1 to max exist (even if empty)
  for (let i = 1; i <= Math.max(maxLevel, 3); i++) {
    if (!usersByLevel[i]) {
      usersByLevel[i] = []
    }
  }

  return {
    department: {
      id: department.id,
      name: department.name,
      type: department.type,
      levelNames: department.levelNames as Record<string, string> | null,
    },
    usersByLevel,
    maxLevel: Math.max(maxLevel, 3),
  }
}

/**
 * Get the current user's default department approval chain.
 * Returns a read-only hierarchy including internal users and external approvers.
 */
export async function getCurrentUserApprovalChain() {
  const session = await auth()
  if (!session?.user?.id) {
    throw new Error('Unauthorized')
  }

  const currentUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      departmentId: true,
      isActive: true,
    },
  })

  if (!currentUser?.isActive) {
    throw new Error('User not found')
  }

  if (!currentUser.departmentId) {
    return null
  }

  const department = await prisma.departments.findUnique({
    where: { id: currentUser.departmentId },
    include: {
      users: {
        where: { isActive: true, level: { not: null } },
        select: {
          id: true,
          name: true,
          email: true,
          level: true,
        },
        orderBy: { name: 'asc' },
      },
      departmentApprovers: {
        include: {
          approver: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      },
    },
  })

  if (!department) {
    throw new Error('Department not found')
  }

  const usersByLevel: Record<number, HierarchyUser[]> = {}
  const processedUserIds = new Set<string>()
  let maxLevel = 0

  for (const user of department.users) {
    const level = user.level!
    if (!usersByLevel[level]) {
      usersByLevel[level] = []
    }
    usersByLevel[level].push({ ...user, isExternal: false })
    processedUserIds.add(user.id)
    maxLevel = Math.max(maxLevel, level)
  }

  for (const departmentApprover of department.departmentApprovers) {
    if (processedUserIds.has(departmentApprover.approver.id)) {
      continue
    }

    const level = departmentApprover.approverLevel
    if (!usersByLevel[level]) {
      usersByLevel[level] = []
    }
    usersByLevel[level].push({
      id: departmentApprover.approver.id,
      name: departmentApprover.approver.name,
      email: departmentApprover.approver.email,
      level,
      isExternal: true,
    })
    maxLevel = Math.max(maxLevel, level)
  }

  for (let level = 1; level <= Math.max(maxLevel, 3); level += 1) {
    if (!usersByLevel[level]) {
      usersByLevel[level] = []
    }
  }

  return {
    department: {
      id: department.id,
      name: department.name,
      type: department.type,
      levelNames: department.levelNames as Record<string, string> | null,
    },
    usersByLevel,
    maxLevel: Math.max(maxLevel, 3),
  }
}

/**
 * Get all departments accessible to a user for viewing hierarchy
 */
export async function getDepartmentsForHierarchyView() {
  const { user: _authUser } = (await auth()) ?? {}; const userId = _authUser?.id
  if (!userId) {
    throw new Error('Unauthorized')
  }

  // Get user's department and role
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { departmentId: true, role: true },
  })

  if (!user) {
    throw new Error('User not found')
  }

  // Admins and engineering can see all departments
  if (user.role === 'admin' || user.role === 'engineering') {
    return prisma.departments.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true, type: true },
    })
  }

  // General users see their own department
  if (user.departmentId) {
    return prisma.departments.findMany({
      where: { id: user.departmentId },
      select: { id: true, name: true, type: true },
    })
  }

  return []
}
