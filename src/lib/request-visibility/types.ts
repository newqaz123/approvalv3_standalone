import type { Prisma } from '@prisma/client'

export interface RequestVisibilityDb {
  findActor(userId: string): Promise<RequestVisibilityActor | null>
  findRequest(where: Prisma.requestsWhereInput): Promise<{ id: string } | null>
}

export interface RequestVisibilityActor {
  id: string
  role: 'admin' | 'general_dept' | 'engineering'
  isActive: boolean
  departmentId: string | null
  departmentType: 'GENERAL' | 'ENGINEERING' | null
  managedUnitIds: readonly string[]
}

export interface RequestVisibilityOptions {
  userId: string
  includeArchived: boolean
}
