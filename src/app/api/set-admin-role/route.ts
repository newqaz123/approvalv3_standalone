import { createClerkClient } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'

export async function POST() {
  try {
    const clerkClient = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY })

    // Set admin role for your user
    const userId = 'user_38z2hFwkRcJHygMeQzW8EDuYpNP' // Your user ID from debug page

    await clerkClient.users.updateUser(userId, {
      publicMetadata: {
        role: 'admin',
      },
    })

    return NextResponse.json({ success: true, message: 'Admin role set successfully! Sign out and sign back in.' })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to set admin role' }, { status: 500 })
  }
}
