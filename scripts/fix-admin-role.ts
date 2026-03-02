/**
 * Fix Admin Role in Clerk Metadata
 * Ensures admin users have correct publicMetadata.role
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { createClerkClient } from '@clerk/nextjs/server'
import { PrismaClient } from '@prisma/client'

const clerkClient = createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY
})
const prisma = new PrismaClient()

async function main() {
  console.log('\n🔧 Fixing admin role metadata...\n')

  // Get admin from Prisma
  const adminUser = await prisma.user.findFirst({
    where: { role: 'admin' }
  })

  if (!adminUser) {
    console.log('❌ No admin user found in database')
    return
  }

  console.log(`Found admin: ${adminUser.email} (${adminUser.id})`)

  // Update Clerk metadata
  try {
    await clerkClient.users.updateUser(adminUser.id, {
      publicMetadata: {
        role: 'admin'
      }
    })

    console.log('✅ Updated Clerk publicMetadata with role: admin')
    console.log('\n✅ Admin access fixed!')
    console.log('\n💡 Next steps:')
    console.log('   1. Log out and log back in (to refresh session)')
    console.log('   2. You should now see "Admin Panel" link in navbar')
    console.log('   3. You can access /admin routes\n')

  } catch (error) {
    console.error('❌ Error updating Clerk metadata:', error)
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
