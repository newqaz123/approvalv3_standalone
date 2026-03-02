/**
 * Manually Sync Users from Clerk to Prisma
 * Use this when webhook can't reach localhost
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { PrismaClient } from '@prisma/client'
import { createClerkClient } from '@clerk/nextjs/server'

const prisma = new PrismaClient()
const clerkClient = createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY
})

async function main() {
  console.log('\n🔄 Syncing users from Clerk to Prisma...\n')

  // Get all Clerk users
  const clerkUsers = await clerkClient.users.getUserList()

  if (clerkUsers.data.length === 0) {
    console.log('❌ No users found in Clerk')
    return
  }

  console.log(`Found ${clerkUsers.data.length} users in Clerk\n`)

  let synced = 0
  let skipped = 0
  let errors = 0

  for (const clerkUser of clerkUsers.data) {
    const email = clerkUser.emailAddresses[0]?.emailAddress
    const name = `${clerkUser.firstName || ''} ${clerkUser.lastName || ''}`.trim() || 'User'
    const role = (clerkUser.publicMetadata as any)?.role || 'general_dept'

    if (!email) {
      console.log(`⚠️  Skipping ${clerkUser.id} - no email`)
      skipped++
      continue
    }

    try {
      // Check if user already exists
      const existing = await prisma.user.findUnique({
        where: { id: clerkUser.id }
      })

      if (existing) {
        console.log(`⏭️  ${email} - already exists`)
        skipped++
        continue
      }

      // Create user in Prisma
      await prisma.user.create({
        data: {
          id: clerkUser.id,
          email: email,
          name: name,
          role: role as any,
          isActive: true,
        }
      })

      console.log(`✅ ${email} - synced (${role})`)
      synced++

      // Update Clerk metadata if missing
      if (!clerkUser.publicMetadata || !(clerkUser.publicMetadata as any).role) {
        await clerkClient.users.updateUser(clerkUser.id, {
          publicMetadata: { role }
        })
        console.log(`   ↳ Updated Clerk metadata with role: ${role}`)
      }

    } catch (error) {
      console.error(`❌ ${email} - error:`, error instanceof Error ? error.message : error)
      errors++
    }
  }

  console.log('\n' + '━'.repeat(60))
  console.log(`✅ Synced: ${synced}`)
  console.log(`⏭️  Skipped: ${skipped}`)
  console.log(`❌ Errors: ${errors}`)
  console.log('━'.repeat(60) + '\n')

  if (synced > 0) {
    console.log('🎯 Next step: Assign departments to users')
    console.log('   Run: npx tsx scripts/setup-test-data.ts\n')
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
