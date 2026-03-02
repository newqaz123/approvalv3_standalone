import { verifyWebhook } from '@clerk/nextjs/webhooks'
import { NextRequest, NextResponse } from 'next/server'
import { clerkClient } from '@clerk/nextjs/server'
import prisma from '@/lib/prisma'

export async function POST(req: NextRequest) {
  // Check environment configuration
  const webhookSecret = process.env.CLERK_WEBHOOK_SECRET
  if (!webhookSecret) {
    console.error('CLERK_WEBHOOK_SECRET not configured')
    return new NextResponse('Webhook secret not configured', { status: 500 })
  }

  try {
    // Verify webhook signature (automatic using CLERK_WEBHOOK_SECRET)
    const evt = await verifyWebhook(req)
    const eventType = evt.type

    // Handle user creation
    if (eventType === 'user.created') {
      const { id, email_addresses, first_name, last_name, username } = evt.data
      const email = email_addresses[0]?.email_address

      if (!email) {
        console.error('No email address in webhook payload')
        return new NextResponse('Invalid payload', { status: 400 })
      }

      // Determine user name with fallbacks:
      // 1. First + Last name (if provided)
      // 2. Username (if provided)
      // 3. Email local part (before @)
      let userName = `${first_name || ''} ${last_name || ''}`.trim()
      let firstName = first_name || ''
      let lastName = last_name || ''

      if (!userName) {
        userName = username || email.split('@')[0]
        firstName = userName
        lastName = ''
      }

      // Step 1: Update Clerk metadata and name (assigns default role + ensures name is set)
      const clerk = await clerkClient()
      await clerk.users.updateUser(id, {
        firstName: firstName,
        lastName: lastName,
        publicMetadata: {
          role: 'general_dept', // Default role for self-signups
        },
      })

      // Step 2: Create Prisma user record
      await prisma.user.create({
        data: {
          id: id,
          email: email,
          name: userName,
          role: 'general_dept',
          isActive: true,
        },
      })

      console.log(`✅ User created via webhook: ${id} (${email}) with name: ${userName}`)
    }

    // Return success to prevent retries
    return NextResponse.json({ success: true }, { status: 200 })

  } catch (error) {
    // Log error for debugging
    console.error('❌ Webhook error:', error)

    // Check for Prisma unique constraint violation (duplicate user)
    if (error instanceof Error && error.message.includes('Unique constraint')) {
      // Idempotent: User already exists, return success
      console.log('ℹ️ User already exists (idempotent retry)')
      return NextResponse.json({ success: true, idempotent: true }, { status: 200 })
    }

    // Return 400 to prevent Clerk retries (handled via Svix)
    return NextResponse.json(
      { error: 'Webhook processing failed' },
      { status: 400 }
    )
  }
}
