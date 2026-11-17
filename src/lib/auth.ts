import { auth } from '@/lib/auth-config'
import prisma from '@/lib/prisma'

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
