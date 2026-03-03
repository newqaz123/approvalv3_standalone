'use server'

import { hash, compare } from 'bcryptjs'
import prisma from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth'
import { revalidatePath } from 'next/cache'
import { auth } from '@/lib/auth-config'

export type UserRole = 'admin' | 'general_dept' | 'engineering'

export interface CreateUserInput {
  name: string
  email: string
  departmentId: string
  role: UserRole
  password?: string
  level?: number | null
}

export interface UpdateUserInput {
  id: string
  name: string
  email: string
  departmentId: string
  role?: UserRole // Optional to allow manual override
  level?: number | null
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
      }
    },
    orderBy: {
      name: 'asc',
    },
  })

  return users
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

  // Check if department exists
  const department = await prisma.departments.findUnique({
    where: { id: input.departmentId },
  })

  if (!department) {
    throw new Error('Department not found')
  }

  // Check if email already exists
  const existing = await prisma.user.findUnique({
    where: { email: input.email },
  })
  if (existing) {
    throw new Error('A user with this email already exists')
  }

  // Automatically determine role based on department
  const autoRole: UserRole = input.departmentId === 'ENG' ? 'engineering' : 'general_dept'

  // Hash default password (admin sets it, or use default)
  const password = input.password || 'changeme'
  const passwordHash = await hash(password, 12)

  const user = await prisma.user.create({
    data: {
      email: input.email,
      name: input.name,
      passwordHash,
      departmentId: input.departmentId,
      role: autoRole,
      level: input.level ?? null,
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

  // Use provided role, or auto-determine based on department
  const autoRole: UserRole = input.departmentId === 'ENG' ? 'engineering' : 'general_dept'
  const finalRole: UserRole = input.role || autoRole

  // Track original values for audit logging
  const originalName = existingUser.name
  const originalEmail = existingUser.email
  const originalRole = existingUser.role
  const originalDepartmentId = existingUser.departmentId
  const originalLevel = existingUser.level

  // Check for pending approvals before changing department
  if (input.departmentId && input.departmentId !== originalDepartmentId) {
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

  const user = await prisma.user.update({
    where: { id: input.id },
    data: {
      name: input.name,
      email: input.email,
      departmentId: input.departmentId,
      role: finalRole,
      level: input.level ?? null,
      updatedAt: new Date(),
    },
  })

  // Audit logging: Track all admin changes
  const changes: string[] = []
  if (input.name !== originalName) changes.push(`name: "${originalName}" → "${input.name}"`)
  if (input.email !== originalEmail) changes.push(`email: "${originalEmail}" → "${input.email}"`)
  if (finalRole !== originalRole) changes.push(`role: "${originalRole}" → "${finalRole}"`)
  if (input.departmentId !== originalDepartmentId) changes.push(`departmentId: "${originalDepartmentId}" → "${input.departmentId}"`)
  if ((input.level ?? null) !== originalLevel) changes.push(`level: "${String(originalLevel ?? 'null')}" → "${String(input.level ?? 'null')}"`)

  if (changes.length > 0) {
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
