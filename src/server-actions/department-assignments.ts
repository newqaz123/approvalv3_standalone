'use server'

import prisma from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth'
import { revalidatePath } from 'next/cache'

/**
 * Get all additional department assignments for a user (DepartmentApprover records)
 */
export async function getUserAdditionalDepartments(userId: string) {
  const adminId = await requireAdmin()
  if (!adminId) throw new Error('Admin access required')

  const assignments = await prisma.department_approvers.findMany({
    where: { approverId: userId },
    include: {
      department: {
        select: { id: true, name: true, type: true },
      },
    },
    orderBy: { department: { name: 'asc' } },
  })

  // Calculate count for each assignment (how many depts user is assigned to)
  const assignmentsWithCount = assignments.map((a) => ({
    id: a.id,
    departmentId: a.department.id,
    departmentName: a.department.name,
    departmentType: a.department.type,
    level: a.approverLevel,
    _count: assignments.filter(x => x.departmentId === a.departmentId).length,
  }))
  return assignmentsWithCount
}

/**
 * Add a user to an additional department as a cross-department approver
 * Enforces engineering/general separation rules
 */
export async function addUserToDepartment(
  userId: string,
  departmentId: string,
  level: number
) {
  const adminId = await requireAdmin()
  if (!adminId) throw new Error('Admin access required')

  // Fetch user to get their home department and role
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { departmentId: true, role: true },
  })

  if (!user) throw new Error('User not found')

  // Fetch target department to get its type
  const targetDept = await prisma.departments.findUnique({
    where: { id: departmentId },
    select: { type: true },
  })

  if (!targetDept) throw new Error('Department not found')

  // Validation: Cannot add to home department
  if (departmentId === user.departmentId) {
    throw new Error('Cannot add user to their home department as an additional approver')
  }

  // Validation: Engineering/General separation (admin bypasses)
  if (user.role !== 'admin') {
    if (user.role === 'engineering' && targetDept.type === 'GENERAL') {
      throw new Error('Engineering users cannot be added to general departments')
    }
    if (user.role === 'general_dept' && targetDept.type === 'ENGINEERING') {
      throw new Error('General department users cannot be added to engineering department')
    }
  }

  // Validation: Check for existing assignment to same department (any level)
  const existing = await prisma.department_approvers.findFirst({
    where: { approverId: userId, departmentId },
  })

  if (existing) {
    throw new Error('User is already assigned to this department')
  }

  // Create DepartmentApprover record
  const created = await prisma.department_approvers.create({
    data: {
      departmentId,
      approverId: userId,
      approverLevel: level,
    },
  })

  revalidatePath('/admin/users')
  revalidatePath('/admin/hierarchy')

  return created
}

/**
 * Remove a user from an additional department (delete all DepartmentApprover records for that user+dept)
 */
export async function removeUserFromDepartment(
  userId: string,
  departmentId: string
) {
  const adminId = await requireAdmin()
  if (!adminId) throw new Error('Admin access required')

  await prisma.department_approvers.deleteMany({
    where: { approverId: userId, departmentId },
  })

  revalidatePath('/admin/users')
  revalidatePath('/admin/hierarchy')

  return { success: true }
}
