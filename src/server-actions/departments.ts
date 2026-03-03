'use server'

import prisma from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth'
import { revalidatePath } from 'next/cache'
import { DepartmentType } from '@prisma/client'

export interface CreateDepartmentInput {
  id: string
  name: string
  type: DepartmentType
  levelNames?: Record<string, string>
}

export interface UpdateDepartmentInput {
  id: string
  name: string
  type: DepartmentType
  levelNames?: Record<string, string>
}

/**
 * Get all departments with active user count (members + external approvers)
 */
export async function getDepartments() {
  await requireAdmin()

  const departments = await prisma.departments.findMany({
    include: {
      _count: {
        select: { users: { where: { isActive: true } } },
      },
      departmentApprovers: {
        select: { id: true },
      },
    },
    orderBy: {
      name: 'asc',
    },
  })

  // Include external approvers in user count and levelNames
  return departments.map(dept => ({
    ...dept,
    levelNames: dept.levelNames as Record<string, string> | null,
    _count: {
      users: dept._count.users + dept.departmentApprovers.length,
    },
  }))
}

/**
 * Get a single department by ID
 */
export async function getDepartment(id: string) {
  await requireAdmin()

  const department = await prisma.departments.findUnique({
    where: { id },
    include: {
      users: {
        where: { isActive: true },
      },
    },
  })

  return department
}

/**
 * Create a new department
 */
export async function createDepartment(input: CreateDepartmentInput) {
  await requireAdmin()

  // Check if department ID already exists
  const existingId = await prisma.departments.findUnique({
    where: { id: input.id },
  })

  if (existingId) {
    throw new Error('Department with this ID already exists')
  }

  // Check if department name already exists (case-insensitive)
  const existingName = await prisma.departments.findFirst({
    where: {
      name: {
        equals: input.name,
        mode: 'insensitive', // Case-insensitive comparison
      },
    },
  })

  if (existingName) {
    throw new Error('Department with this name already exists')
  }

  const department = await prisma.departments.create({
    data: {
      id: input.id,
      name: input.name,
      type: input.type,
      levelNames: input.levelNames ?? undefined,
    },
  })

  revalidatePath('/admin/departments')
  return department
}

/**
 * Update an existing department
 */
export async function updateDepartment(input: UpdateDepartmentInput) {
  await requireAdmin()

  // Get existing department
  const existingDepartment = await prisma.departments.findUnique({
    where: { id: input.id },
  })

  if (!existingDepartment) {
    throw new Error('Department not found')
  }

  // Check name uniqueness (case-insensitive)
  if (input.name && input.name.toLowerCase() !== existingDepartment.name.toLowerCase()) {
    const conflictingDepartment = await prisma.departments.findFirst({
      where: {
        name: {
          equals: input.name,
          mode: 'insensitive', // Case-insensitive comparison
        },
        id: {
          not: input.id, // Exclude current department from check
        },
      },
    })

    if (conflictingDepartment) {
      throw new Error('Department name already exists')
    }
  }

  const department = await prisma.departments.update({
    where: { id: input.id },
    data: {
      name: input.name,
      type: input.type,
      levelNames: input.levelNames ?? undefined,
    },
  })

  revalidatePath('/admin/departments')
  return department
}

/**
 * Seed initial departments (11 general + 1 engineering)
 */
export async function seedInitialDepartments() {
  await requireAdmin()

  const departments = [
    // General departments (11)
    { id: 'QC', name: 'Quality Control', type: 'GENERAL' as DepartmentType },
    { id: 'OSEC', name: 'OSEC', type: 'GENERAL' as DepartmentType },
    { id: 'PD1', name: 'Production Department 1', type: 'GENERAL' as DepartmentType },
    { id: 'PD2', name: 'Production Department 2', type: 'GENERAL' as DepartmentType },
    { id: 'PD3', name: 'Production Department 3', type: 'GENERAL' as DepartmentType },
    { id: 'WWT', name: 'WWT', type: 'GENERAL' as DepartmentType },
    { id: 'UTILITY', name: 'Utility', type: 'GENERAL' as DepartmentType },
    { id: 'BM', name: 'BM', type: 'GENERAL' as DepartmentType },
    { id: 'TTEC', name: 'TTEC', type: 'GENERAL' as DepartmentType },
    { id: 'ADMIN', name: 'Administration', type: 'GENERAL' as DepartmentType },
    { id: 'MAINTENANCE', name: 'Maintenance', type: 'GENERAL' as DepartmentType },
    // Engineering department (1)
    { id: 'ENGINEERING', name: 'Engineering', type: 'ENGINEERING' as DepartmentType },
  ]

  for (const dept of departments) {
    await prisma.departments.upsert({
      where: { id: dept.id },
      update: {},
      create: dept,
    })
  }

  revalidatePath('/admin/departments')
  return { success: true, count: departments.length }
}

/**
 * Delete a department (only if no users assigned)
 */
export async function deleteDepartment(id: string) {
  await requireAdmin()

  const userCount = await prisma.user.count({
    where: { departmentId: id },
  })

  if (userCount > 0) {
    throw new Error(`Cannot delete department with ${userCount} assigned users`)
  }

  await prisma.departments.delete({
    where: { id },
  })

  revalidatePath('/admin/departments')
  return { success: true }
}
