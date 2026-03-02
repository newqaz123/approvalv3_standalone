'use server'

import { auth } from '@clerk/nextjs/server'
import { clerkClient } from '@clerk/nextjs/server'
import prisma from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth'
import { revalidatePath } from 'next/cache'
import type { Prisma } from '@prisma/client'

export type UserRole = 'admin' | 'general_dept' | 'engineering'

export interface CreateUserInput {
  name: string
  email: string
  departmentId: string
  role: UserRole
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
  _count?: { departmentApproverRoles: number }
}

/**
 * Get all users with their department information
 */
export async function getUsers() {
  await requireAdmin()

  const users = await prisma.user.findMany({
    include: {
      department: true,
      _count: {
        select: { departmentApproverRoles: true },
      },
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
 * Create a new user (creates both Clerk user and Prisma record)
 */
export async function createUser(input: CreateUserInput) {
  const adminUserId = await requireAdmin()

  // Check if department exists
  const department = await prisma.department.findUnique({
    where: { id: input.departmentId },
  })

  if (!department) {
    throw new Error('Department not found')
  }

  // Automatically determine role based on department
  const autoRole: UserRole = input.departmentId === 'ENG' ? 'engineering' : 'general_dept'

  let clerkUser: any

  try {
    // Step 1: Create Clerk user with random password (user will reset via email)
    const clerk = await clerkClient()

    // Generate a secure random password (user won't use this - they'll reset it)
    const tempPassword = Math.random().toString(36).slice(-12) + Math.random().toString(36).slice(-12) + 'A1!'

    // Generate username from email (before @)
    const username = input.email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '')

    clerkUser = await clerk.users.createUser({
      emailAddress: [input.email],
      password: tempPassword,
      username: username,
      firstName: input.name.split(' ')[0],
      lastName: input.name.split(' ').slice(1).join(' '),
      skipPasswordChecks: true, // Skip password requirements since it's temporary
      publicMetadata: {
        role: autoRole,
        departmentId: input.departmentId,
      },
    })

    // Step 1.5: User receives Clerk welcome email automatically
    console.log(`✅ User created: ${input.email}`)
    console.log(`   They can sign in at your app and will be prompted to verify email`)

  } catch (error) {
    console.error('❌ Failed to create Clerk user:', error)
    throw new Error(`Failed to create Clerk user: ${error}`)
  }

  try {
    // Step 2: Create Prisma record
    const user = await prisma.user.create({
      data: {
        id: clerkUser.id,
        email: input.email,
        name: input.name,
        departmentId: input.departmentId,
        role: autoRole,
        isActive: true,
      },
    })

    revalidatePath('/admin/users')
    return user

  } catch (error) {
    // Step 3: Rollback Clerk user if Prisma fails
    console.error('❌ Prisma create failed, rolling back Clerk user:', clerkUser.id, error)
    const clerk = await clerkClient()
    await clerk.users.deleteUser(clerkUser.id)
    throw new Error(`Failed to create user record: ${error}`)
  }
}

/**
 * Update an existing user (updates both Clerk and Prisma)
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

  const clerk = await clerkClient()

  // Track original values for rollback and audit logging
  const originalName = existingUser.name
  const originalEmail = existingUser.email
  const originalRole = existingUser.role
  const originalDepartmentId = existingUser.departmentId
  const originalLevel = existingUser.level

  // Check for pending approvals before changing department
  if (input.departmentId && input.departmentId !== originalDepartmentId) {
    // Check for pending request approvals
    const pendingRequestApprovals = await prisma.requestApproval.findMany({
      where: {
        requiredApproverId: input.id,
        status: 'pending',
      },
    })

    // Check for pending solution approvals
    const pendingSolutionApprovals = await prisma.solutionApproval.findMany({
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

  // Email synchronization: Check if email changed
  let emailWasChanged = false
  let oldEmailAddressId: string | undefined = undefined
  if (input.email && input.email !== originalEmail) {
    emailWasChanged = true

    // Add new email address as verified and primary
    await clerk.emailAddresses.createEmailAddress({
      userId: input.id,
      emailAddress: input.email,
      verified: true,
      primary: true,
    })

    // Get old email ID for potential rollback
    try {
      const oldEmailObj = await clerk.emailAddresses.getEmailAddress(originalEmail)
      if (oldEmailObj) {
        oldEmailAddressId = oldEmailObj.id
      }
    } catch {
      // Old email might not exist
    }
  }

  // Name & Metadata synchronization
  await clerk.users.updateUser(input.id, {
    firstName: input.name.split(' ')[0],
    lastName: input.name.split(' ').slice(1).join(' '),
    publicMetadata: {
      role: finalRole,
      departmentId: input.departmentId,
    },
  })

  // Update Prisma record with rollback protection
  try {
    const user = await prisma.user.update({
      where: { id: input.id },
      data: {
        name: input.name,
        email: input.email,
        departmentId: input.departmentId,
        role: finalRole,
        level: input.level ?? null,
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
      await prisma.requestActivity.create({
        data: {
          requestId: undefined, // System-level activity (no associated request)
          action: 'user_admin_changed',
          comments: `Updated user ${input.id}: ${changes.join(', ')}`,
          userId: adminUserId,
        },
      })
    }

    revalidatePath('/admin/users')

    // Return warning if role changed
    if (finalRole !== originalRole) {
      // Note: Return user object with warning embedded in return value
      // The UI will check if user has a warning property
      return {
        ...user,
        _warning: 'User must re-login for role change to take effect.',
      } as any
    }

    return user
  } catch (prismaError) {
    console.error('Prisma update failed, rolling back Clerk changes:', prismaError)

    // Rollback Clerk name and metadata
    try {
      await clerk.users.updateUser(input.id, {
        firstName: originalName.split(' ')[0],
        lastName: originalName.split(' ').slice(1).join(' '),
        publicMetadata: {
          role: originalRole,
          departmentId: originalDepartmentId,
        },
      })
    } catch (rollbackError) {
      console.error('Rollback failed for name/metadata:', rollbackError)
    }

    // Rollback email if it was changed
    if (emailWasChanged && oldEmailAddressId) {
      try {
        // Delete the new email
        try {
          const newEmailObj = await clerk.emailAddresses.getEmailAddress(input.email)
          if (newEmailObj) {
            await clerk.emailAddresses.deleteEmailAddress(newEmailObj.id)
          }
        } catch {
          // Continue if new email doesn't exist
        }

        // Recreate old email as primary/verified
        await clerk.emailAddresses.createEmailAddress({
          userId: input.id,
          emailAddress: originalEmail,
          verified: true,
          primary: true,
        })
      } catch (rollbackEmailError) {
        console.error('Rollback failed for email:', rollbackEmailError)
      }
    }

    throw new Error(
      `Failed to update user record: ${prismaError instanceof Error ? prismaError.message : String(prismaError)}`
    )
  }
}

/**
 * Deactivate a user (soft delete - updates both Clerk and Prisma)
 */
export async function deactivateUser(userId: string) {
  await requireAdmin()

  // Update Prisma
  await prisma.user.update({
    where: { id: userId },
    data: { isActive: false },
  })

  // Update Clerk metadata
  const clerk = await clerkClient()
  await clerk.users.updateUser(userId, {
    publicMetadata: {
      isActive: false,
    },
  })

  revalidatePath('/admin/users')
  return { success: true }
}

/**
 * Reactivate a user
 */
export async function activateUser(userId: string) {
  await requireAdmin()

  // Update Prisma
  await prisma.user.update({
    where: { id: userId },
    data: { isActive: true },
  })

  // Update Clerk metadata
  const clerk = await clerkClient()
  await clerk.users.updateUser(userId, {
    publicMetadata: {
      isActive: true,
    },
  })

  revalidatePath('/admin/users')
  return { success: true }
}
