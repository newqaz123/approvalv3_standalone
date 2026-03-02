/**
 * Manual Clerk User Sync Script
 * Run this to sync all Clerk users to Prisma database
 * Usage: npx tsx scripts/sync-clerk-users.ts
 */

import { config } from 'dotenv'
import { resolve } from 'path'

// Load environment variables from .env.local
config({ path: resolve(__dirname, '../.env.local') })

import { createClerkClient } from '@clerk/backend'
import prisma from '../src/lib/prisma'

async function syncClerkUsers() {
  console.log('🔄 Starting Clerk user sync...\n')

  // Verify environment variables are loaded
  if (!process.env.CLERK_SECRET_KEY) {
    throw new Error('CLERK_SECRET_KEY not found in environment variables')
  }

  try {
    // Initialize Clerk client with explicit secret key
    const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY })

    // Fetch all users from Clerk
    const { data: clerkUsers, totalCount } = await clerk.users.getUserList({
      limit: 100,
    })

    console.log(`📊 Found ${totalCount} users in Clerk\n`)

    let created = 0
    let skipped = 0
    let errors = 0

    for (const user of clerkUsers) {
      const email = user.emailAddresses[0]?.emailAddress

      if (!email) {
        console.log(`⚠️  Skipping user ${user.id} - no email`)
        skipped++
        continue
      }

      try {
        // Check if user already exists
        const existingUser = await prisma.user.findUnique({
          where: { id: user.id },
        })

        if (existingUser) {
          console.log(`✓ User already exists: ${email}`)
          skipped++
          continue
        }

        // Get role from Clerk metadata or default to general_dept
        const role = (user.publicMetadata?.role as string) || 'general_dept'

        // Create user in Prisma
        await prisma.user.create({
          data: {
            id: user.id,
            email: email,
            name: `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'User',
            role: role as any,
            isActive: true,
          },
        })

        console.log(`✅ Created user: ${email}`)
        created++

        // Update Clerk metadata if not set
        if (!user.publicMetadata?.role) {
          await clerk.users.updateUser(user.id, {
            publicMetadata: {
              role: 'general_dept',
            },
          })
          console.log(`   └─ Updated Clerk metadata with role`)
        }

      } catch (error) {
        console.error(`❌ Error processing ${email}:`, error)
        errors++
      }
    }

    console.log('\n📈 Sync Complete!')
    console.log(`   Created: ${created}`)
    console.log(`   Skipped: ${skipped}`)
    console.log(`   Errors: ${errors}`)

  } catch (error) {
    console.error('❌ Sync failed:', error)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

syncClerkUsers()
