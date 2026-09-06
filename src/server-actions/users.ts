'use server'

import { hash, compare } from 'bcryptjs'
import prisma from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth'
import { revalidatePath } from 'next/cache'
import { auth } from '@/lib/auth-config'
import { validateApprovalLevel } from '@/lib/approval-levels'
import type { OrganizationPositionCode } from '@/lib/organization/types'
import { savePositionAssignment } from './organization'

export type UserRole = 'admin' | 'general_dept' | 'engineering'

export interface UserPositionAssignmentInput {
  unitId: string
  positionCode: OrganizationPositionCode
  reportingGroupId?: string | null
  isPrimary?: boolean
}

export interface CreateUserInput {
  name: string
  email: string
  departmentId?: string | null
  role: UserRole
  password?: string
  level?: number | null
  positionAssignment?: UserPositionAssignmentInput
}

export interface UpdateUserInput {
  id: string
  name: string
  email: string
  departmentId?: string | null
  role?: UserRole // Optional to allow manual override
  level?: number | null
  positionAssignment?: UserPositionAssignmentInput
}

export type UserWithDepartment = {
  id: string
  name: string
  email: string
  role: UserRole
  department: { id: string; name: string } | null
  level: number | null
  isActive: boolean
  createdAt: Date
  departmentApproverRoles?: { id: string; department: { id: string; name: string } }[]
  organizationAssignment?: {
    unitId: string
    unitName: string
    unitType: string
    positionCode: OrganizationPositionCode
  } | null
}

export type CurrentUserProfile = {
  id: string
  name: string
  email: string
  role: UserRole
  department: { id: string; name: string } | null
}

/**
 * Get all users with their department information
 */
export async function getUsers() {
  await requireAdmin()

  const users = await prisma.user.findMany({
    include: {
      department: true,
      departmentApproverRoles: {
        include: {
          department: {
            select: {
              id: true,
              name: true
            }
          }
        }
      },
      organizationPositionAssignments: {
        where: { isActive: true, isPrimary: true },
        include: {
          unit: {
            select: { id: true, name: true, unitType: true },
          },
        },
      },
    },
    orderBy: {
      name: 'asc',
    },
  })

  return users.map((user) => {
    const primary = user.organizationPositionAssignments[0]
    const { organizationPositionAssignments, ...rest } = user
    return {
      ...rest,
      organizationAssignment: primary
        ? {
            unitId: primary.unit.id,
            unitName: primary.unit.name,
            unitType: primary.unit.unitType,
            positionCode: primary.positionCode,
          }
        : null,
    }
  })
}

/**
 * Get a single user by ID
 */
export async function getUser(id: string) {
  await requireAdmin()

  const user = await prisma.user.findUnique({
    where: { id },
    include: {
      department: true,
    },
  })

  return user
}

/**
 * Create a new user (Prisma only — no external service)
 */
export async function createUser(input: CreateUserInput) {
  const adminUserId = await requireAdmin()
  if (!adminUserId) {
    throw new Error('Admin authorization is required for user actions')
  }
  const level = validateApprovalLevel(input.level, { allowNull: true })
  const departmentId = input.departmentId ?? null

  if (!departmentId && !input.positionAssignment) {
    throw new Error('Department or a valid organization position assignment is required')
  }

  if (departmentId) {
    const department = await prisma.departments.findUnique({
      where: { id: departmentId },
    })

    if (!department) {
      throw new Error('Department not found')
    }
  }

  // Check if email already exists
  const existing = await prisma.user.findUnique({
    where: { email: input.email },
  })
  if (existing) {
    throw new Error('A user with this email already exists')
  }

  // Automatically determine role based on department; NEW managers may supply a system role.
  const autoRole: UserRole = departmentId === 'ENG' ? 'engineering' : 'general_dept'
  const finalRole: UserRole = input.positionAssignment ? (input.role || autoRole) : autoRole

  // Hash default password (admin sets it, or use default)
  const password = input.password || 'changeme'
  const passwordHash = await hash(password, 12)

  const user = input.positionAssignment
    ? await prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            email: input.email,
            name: input.name,
            passwordHash,
            departmentId,
            role: finalRole,
            level,
            isActive: true,
            forcePasswordChange: true,
            updatedAt: new Date(),
          },
        })
        await savePositionAssignment({
          userId: created.id,
          unitId: input.positionAssignment!.unitId,
          positionCode: input.positionAssignment!.positionCode,
          reportingGroupId: input.positionAssignment!.reportingGroupId ?? null,
          isPrimary: input.positionAssignment!.isPrimary ?? true,
          isActive: true,
        }, tx)
        return created
      })
    : await prisma.user.create({
        data: {
          email: input.email,
          name: input.name,
          passwordHash,
          departmentId,
          role: finalRole,
          level,
          isActive: true,
          forcePasswordChange: true,
          updatedAt: new Date(),
        },
      })

  console.log(`User created: ${input.email} (password must be changed on first login)`)

  revalidatePath('/admin/users')
  return user
}

/**
 * Update an existing user (Prisma only — no external service)
 */
export async function updateUser(input: UpdateUserInput) {
  const adminUserId = await requireAdmin()
  const validatedLevel = validateApprovalLevel(input.level, { allowNull: true })

  // Verify admin authentication
  if (!adminUserId) {
    throw new Error('Admin authentication failed')
  }

  const existingUser = await prisma.user.findUnique({
    where: { id: input.id },
  })

  if (!existingUser) {
    throw new Error('User not found')
  }

  // Keep existing legacy department/level when omitted so in-flight attempts still resolve.
  const nextDepartmentId = input.departmentId === undefined ? existingUser.departmentId : input.departmentId
  const level = input.level === undefined ? existingUser.level : validatedLevel

  // Use provided role, or auto-determine based on department
  const autoRole: UserRole = nextDepartmentId === 'ENG' ? 'engineering' : 'general_dept'
  const finalRole: UserRole = input.role || autoRole

  // Track original values for audit logging
  const originalName = existingUser.name
  const originalEmail = existingUser.email
  const originalRole = existingUser.role
  const originalDepartmentId = existingUser.departmentId
  const originalLevel = existingUser.level

  // Check for pending approvals before changing department. Do not clear legacy
  // fields that still serve in-flight attempts.
  if (nextDepartmentId !== originalDepartmentId) {
    // Check for pending request approvals
    const pendingRequestApprovals = await prisma.request_approvals.findMany({
      where: {
        requiredApproverId: input.id,
        status: 'pending',
      },
    })

    // Check for pending solution approvals
    const pendingSolutionApprovals = await prisma.solution_approvals.findMany({
      where: {
        requiredApproverId: input.id,
        status: 'pending',
      },
    })

    const totalPending = pendingRequestApprovals.length + pendingSolutionApprovals.length

    if (totalPending > 0) {
      throw new Error(
        `User has ${totalPending} pending approval${totalPending > 1 ? 's' : ''}. Cannot change department. Please contact user to complete approvals or reassign manually.`
      )
    }
  }

  // Check if email is being changed to one that already exists
  if (input.email !== originalEmail) {
    const emailExists = await prisma.user.findUnique({
      where: { email: input.email },
    })
    if (emailExists) {
      throw new Error('A user with this email already exists')
    }
  }

  const changes: string[] = []
  if (input.name !== originalName) changes.push(`name: "${originalName}" → "${input.name}"`)
  if (input.email !== originalEmail) changes.push(`email: "${originalEmail}" → "${input.email}"`)
  if (finalRole !== originalRole) changes.push(`role: "${originalRole}" → "${finalRole}"`)
  if (nextDepartmentId !== originalDepartmentId) changes.push(`departmentId: "${originalDepartmentId}" → "${nextDepartmentId}"`)
  if (level !== originalLevel) changes.push(`level: "${String(originalLevel ?? 'null')}" → "${String(level ?? 'null')}"`)

  const user = input.positionAssignment
    ? await prisma.$transaction(async (tx) => {
        const updated = await tx.user.update({
          where: { id: input.id },
          data: {
            name: input.name,
            email: input.email,
            departmentId: nextDepartmentId,
            role: finalRole,
            level,
            updatedAt: new Date(),
          },
        })
        await savePositionAssignment({
          userId: input.id,
          unitId: input.positionAssignment!.unitId,
          positionCode: input.positionAssignment!.positionCode,
          reportingGroupId: input.positionAssignment!.reportingGroupId ?? null,
          isPrimary: input.positionAssignment!.isPrimary ?? true,
          isActive: true,
        }, tx)
        if (changes.length > 0) {
          await tx.request_activities.create({
            data: {
              action: 'user_admin_changed',
              comments: `Updated user ${input.id}: ${changes.join(', ')}`,
              userId: adminUserId,
              createdAt: new Date(),
            },
          })
        }
        return updated
      })
    : await prisma.user.update({
        where: { id: input.id },
        data: {
          name: input.name,
          email: input.email,
          departmentId: nextDepartmentId,
          role: finalRole,
          level,
          updatedAt: new Date(),
        },
      })

  if (!input.positionAssignment && changes.length > 0) {
    await prisma.request_activities.create({
      data: {
        action: 'user_admin_changed',
        comments: `Updated user ${input.id}: ${changes.join(', ')}`,
        userId: adminUserId,
        createdAt: new Date(),
      },
    })
  }

  revalidatePath('/admin/users')

  // Return warning if role changed
  if (finalRole !== originalRole) {
    return {
      ...user,
      _warning: 'User must re-login for role change to take effect.',
    } as any
  }

  return user
}

/**
 * Deactivate a user (soft delete — Prisma only)
 */
export async function deactivateUser(userId: string) {
  await requireAdmin()

  await prisma.user.update({
    where: { id: userId },
    data: { isActive: false, updatedAt: new Date() },
  })

  revalidatePath('/admin/users')
  return { success: true }
}

/**
 * Reactivate a user
 */
export async function activateUser(userId: string) {
  await requireAdmin()

  await prisma.user.update({
    where: { id: userId },
    data: { isActive: true, updatedAt: new Date() },
  })

  revalidatePath('/admin/users')
  return { success: true }
}

/**
 * Reset a user's password (admin action)
 */
export async function resetUserPassword(userId: string, newPassword: string) {
  await requireAdmin()

  const passwordHash = await hash(newPassword, 12)
  await prisma.user.update({
    where: { id: userId },
    data: {
      passwordHash,
      forcePasswordChange: true,
      updatedAt: new Date(),
    },
  })

  revalidatePath('/admin/users')
  return { success: true }
}

/**
 * Get the current user's self-service profile.
 */
export async function getCurrentUserProfile(): Promise<CurrentUserProfile> {
  const session = await auth()
  if (!session?.user?.id) {
    throw new Error('Not authenticated')
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      isActive: true,
      department: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  })

  if (!user?.isActive) {
    throw new Error('User not found')
  }

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    department: user.department,
  }
}

/**
 * Update only the current user's display name.
 */
export async function updateOwnDisplayName(displayName: string) {
  const session = await auth()
  if (!session?.user?.id) {
    throw new Error('Not authenticated')
  }

  const nextName = displayName.trim().replace(/\s+/g, ' ')
  if (nextName.length < 2) {
    throw new Error('Display name must be at least 2 characters')
  }
  if (nextName.length > 100) {
    throw new Error('Display name must be 100 characters or fewer')
  }

  const existingUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      name: true,
      isActive: true,
    },
  })

  if (!existingUser?.isActive) {
    throw new Error('User not found')
  }

  if (existingUser.name === nextName) {
    return {
      id: existingUser.id,
      name: existingUser.name,
    }
  }

  const user = await prisma.$transaction(async (tx) => {
    const updatedUser = await tx.user.update({
      where: { id: session.user.id },
      data: {
        name: nextName,
        updatedAt: new Date(),
      },
      select: {
        id: true,
        name: true,
      },
    })

    await tx.request_activities.create({
      data: {
        action: 'profile_display_name_changed',
        comments: `Display name changed from "${existingUser.name}" to "${nextName}"`,
        userId: session.user.id,
        createdAt: new Date(),
      },
    })

    return updatedUser
  })

  revalidatePath('/profile')
  return user
}

/**
 * Change own password (authenticated user action)
 */
export async function changePassword(currentPassword: string, newPassword: string) {
  const session = await auth()
  if (!session?.user?.id) {
    throw new Error('Not authenticated')
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { passwordHash: true },
  })

  if (!user?.passwordHash) {
    throw new Error('User not found')
  }

  const isValid = await compare(currentPassword, user.passwordHash)
  if (!isValid) {
    throw new Error('Current password is incorrect')
  }

  const passwordHash = await hash(newPassword, 12)
  await prisma.user.update({
    where: { id: session.user.id },
    data: {
      passwordHash,
      forcePasswordChange: false,
      updatedAt: new Date(),
    },
  })

  return { success: true }
}

/**
 * Get users from a specific department for custom approval hierarchy
 * Returns users with level >= specified minimum level
 */
export async function getUsersForCustomHierarchy(departmentId: string, minLevel: number = 1) {
  const session = await auth()
  if (!session?.user?.id) {
    throw new Error('Not authenticated')
  }

  const users = await prisma.user.findMany({
    where: {
      departmentId,
      isActive: true,
      level: {
        gte: minLevel,
      },
    },
    select: {
      id: true,
      name: true,
      email: true,
      level: true,
    },
    orderBy: [
      { level: 'desc' },
      { name: 'asc' },
    ],
  })

  return users
}
