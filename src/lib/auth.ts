import { auth } from '@/lib/auth-config'
import prisma from '@/lib/prisma'

/**
 * Verifies the current user is authenticated and returns their userId.
 * Returns null if not authenticated.
 */
export async function requireUser() {
  const session = await auth()

  if (!session?.user?.id) {
    return null
  }

  return session.user.id
}

/**
 * Verifies the current user is an admin using database-backed role check.
 * Returns null if not authenticated or not an admin.
 *
 * This approach checks Prisma directly,
 * ensuring role changes take effect immediately.
 */
export async function requireAdmin() {
  const session = await auth()

  if (!session?.user?.id) {
    return null
  }

  // Check Prisma for current role (always reflects latest changes)
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true, isActive: true },
  })

  // Verify user exists, is active, and has admin role
  if (!user || !user.isActive || user.role !== 'admin') {
    return null
  }

  return session.user.id
}

/**
 * Gets the current user's role from session.
 * Returns null if not authenticated.
 */
export async function getUserRole(): Promise<string | null> {
  const session = await auth()
  return session?.user?.role || null
}

/**
 * Checks if the current user has a specific role.
 * Returns false if not authenticated or role doesn't match.
 */
export async function hasRole(role: string): Promise<boolean> {
  const userRole = await getUserRole()
  return userRole === role
}

/**
 * Gets the current authenticated user's session.
 * Returns null if not authenticated.
 */
export async function getSession() {
  return await auth()
}
