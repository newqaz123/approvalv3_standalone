'use server'

import { hash } from 'bcryptjs'
import prisma from '@/lib/prisma'
import { revalidatePath } from 'next/cache'

export interface SignUpInput {
  name: string
  email: string
  password: string
  departmentId?: string
}

/**
 * Sign up a new user (self-registration)
 */
export async function signUp(input: SignUpInput) {
  // Check if email already exists
  const existing = await prisma.user.findUnique({
    where: { email: input.email },
  })
  if (existing) {
    throw new Error('A user with this email already exists')
  }

  // Hash password
  const passwordHash = await hash(input.password, 12)

  const user = await prisma.user.create({
    data: {
      email: input.email,
      name: input.name,
      passwordHash,
      departmentId: null, // No department assigned yet - admin will assign later
      role: 'general_dept', // Default role, will be updated when department is assigned
      isActive: true,
      forcePasswordChange: false,
      updatedAt: new Date(),
    },
  })

  console.log(`User signed up: ${input.email} (pending department assignment)`)

  revalidatePath('/admin/users')
  return { success: true, userId: user.id }
}
