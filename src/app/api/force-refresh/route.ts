import { auth, clerkClient } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'

export async function GET() {
  try {
    const { userId } = await auth()

    if (!userId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    // Get user's current metadata
    const clerk = await clerkClient()
    const user = await clerk.users.getUser(userId)

    // Force a metadata update (this triggers session refresh)
    await clerk.users.updateUser(userId, {
      publicMetadata: {
        ...user.publicMetadata,
        lastRefresh: new Date().toISOString()
      }
    })

    return NextResponse.json({
      success: true,
      message: 'Session refresh triggered. Log out and back in.',
      role: (user.publicMetadata as any)?.role
    })
  } catch (error) {
    return NextResponse.json({
      error: 'Failed to refresh session',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}
