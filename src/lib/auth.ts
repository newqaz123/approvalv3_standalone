import { auth } from '@clerk/nextjs/server'
import prisma from '@/lib/prisma'

/**
 * Verifies the current user is authenticated and returns their userId.
 * Returns null if not authenticated.
 */
export async function requireUser() {
  const { userId } = await auth()

  if (!userId) {
    return null
  }

  return userId
}

/**
 * Verifies the current user is an admin using database-backed role check.
 * Returns null if not authenticated or not an admin.
 *
 * This approach bypasses stale JWT metadata by checking Prisma directly,
 * ensuring role changes take effect immediately.
 */
export async function requireAdmin() {
  const { userId } = await auth()

  if (!userId) {
    return null
  }

  // Check Prisma for current role (always reflects latest changes)
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, isActive: true },
  })

  // Verify user exists, is active, and has admin role
  if (!user || !user.isActive || user.role !== 'admin') {
    return null
  }

  return userId
}

/**
 * Gets the current user's role from Clerk metadata.
 * Returns null if not authenticated.
 */
export async function getUserRole(): Promise<string | null> {
  const { sessionClaims } = await auth()
  const metadata = sessionClaims?.metadata as { role?: string } | undefined
  return metadata?.role || null
}

/**
 * Checks if the current user has a specific role.
 * Returns false if not authenticated or role doesn't match.
 */
export async function hasRole(role: string): Promise<boolean> {
  const userRole = await getUserRole()
  return userRole === role
}
