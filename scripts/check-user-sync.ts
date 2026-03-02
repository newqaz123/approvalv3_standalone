/**
 * Check User Sync Between Clerk and Prisma
 * Helps diagnose webhook issues
 */

import { config } from 'dotenv'
import { resolve } from 'path'

// Load environment variables from .env.local
config({ path: resolve(process.cwd(), '.env.local') })

import { PrismaClient } from '@prisma/client'
import { createClerkClient } from '@clerk/nextjs/server'

const prisma = new PrismaClient()
const clerkClient = createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY
})

async function main() {
  console.log('\n🔍 Checking User Sync Between Clerk and Prisma...\n')

  try {
    // Check Clerk users
    console.log('📱 CLERK USERS:')
    console.log('━'.repeat(60))

    const clerkUsers = await clerkClient.users.getUserList()

    if (clerkUsers.data.length === 0) {
      console.log('❌ No users found in Clerk')
      console.log('   → Sign up at your app to create a user\n')
    } else {
      console.log(`✅ Found ${clerkUsers.data.length} user(s) in Clerk:\n`)

      for (const user of clerkUsers.data) {
        const email = user.emailAddresses[0]?.emailAddress || 'No email'
        const name = `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'No name'
        const role = (user.publicMetadata as any)?.role || 'No role set'

        console.log(`   User ID: ${user.id}`)
        console.log(`   Email:   ${email}`)
        console.log(`   Name:    ${name}`)
        console.log(`   Role:    ${role}`)
        console.log(`   Created: ${new Date(user.createdAt).toLocaleString()}`)
        console.log()
      }
    }

    // Check Prisma users
    console.log('\n💾 PRISMA USERS:')
    console.log('━'.repeat(60))

    const prismaUsers = await prisma.user.findMany({
      include: {
        department: true
      }
    })

    if (prismaUsers.length === 0) {
      console.log('❌ No users found in Prisma database')
      console.log('   → Webhook did not create users\n')
    } else {
      console.log(`✅ Found ${prismaUsers.length} user(s) in Prisma:\n`)

      for (const user of prismaUsers) {
        console.log(`   User ID:    ${user.id}`)
        console.log(`   Email:      ${user.email}`)
        console.log(`   Name:       ${user.name}`)
        console.log(`   Role:       ${user.role}`)
        console.log(`   Department: ${user.department?.name || '❌ NOT ASSIGNED'}`)
        console.log(`   Active:     ${user.isActive ? '✅' : '❌'}`)
        console.log()
      }
    }

    // Compare and find mismatches
    console.log('\n🔄 SYNC STATUS:')
    console.log('━'.repeat(60))

    if (clerkUsers.data.length === 0) {
      console.log('⚠️  No Clerk users exist - create a user first')
    } else if (prismaUsers.length === 0) {
      console.log('❌ WEBHOOK NOT WORKING')
      console.log('   Clerk has users but Prisma does not')
      console.log('\n   Possible issues:')
      console.log('   1. Webhook endpoint not configured in Clerk Dashboard')
      console.log('   2. Webhook secret mismatch')
      console.log('   3. Dev server not accessible from internet')
      console.log('   4. Webhook errors (check server logs)')
      console.log('\n   Quick fix: Manually create Prisma user (see instructions)')
    } else {
      // Check for users in Clerk but not in Prisma
      const clerkIds = new Set(clerkUsers.data.map(u => u.id))
      const prismaIds = new Set(prismaUsers.map(u => u.id))

      const missingInPrisma = clerkUsers.data.filter(u => !prismaIds.has(u.id))
      const missingInClerk = prismaUsers.filter(u => !clerkIds.has(u.id))

      if (missingInPrisma.length > 0) {
        console.log(`\n⚠️  ${missingInPrisma.length} user(s) in Clerk but NOT in Prisma:`)
        missingInPrisma.forEach(u => {
          console.log(`   - ${u.emailAddresses[0]?.emailAddress} (${u.id})`)
        })
      }

      if (missingInClerk.length > 0) {
        console.log(`\n⚠️  ${missingInClerk.length} user(s) in Prisma but NOT in Clerk:`)
        missingInClerk.forEach(u => {
          console.log(`   - ${u.email} (${u.id})`)
        })
      }

      if (missingInPrisma.length === 0 && missingInClerk.length === 0) {
        console.log('✅ All users are synced between Clerk and Prisma!')

        // Check department assignments
        const withoutDept = prismaUsers.filter(u => !u.departmentId)
        if (withoutDept.length > 0) {
          console.log(`\n⚠️  ${withoutDept.length} user(s) need department assignment:`)
          withoutDept.forEach(u => {
            console.log(`   - ${u.email}`)
          })
          console.log('\n   Run: npx tsx scripts/setup-test-data.ts')
        } else {
          console.log('✅ All users have departments assigned!')
        }
      }
    }

    console.log('\n' + '━'.repeat(60))
    console.log('✅ Check complete!\n')

  } catch (error) {
    console.error('\n❌ Error checking user sync:', error)

    if (error instanceof Error) {
      if (error.message.includes('CLERK_SECRET_KEY')) {
        console.log('\n⚠️  Clerk credentials not configured properly')
        console.log('   Check .env.local for CLERK_SECRET_KEY')
      } else if (error.message.includes('connect')) {
        console.log('\n⚠️  Database connection error')
        console.log('   Check DATABASE_URL in .env.local')
      }
    }
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
