import { config } from 'dotenv'
import { resolve } from 'path'
import { PrismaClient } from '@prisma/client'

// Load .env.local file first
config({ path: resolve(process.cwd(), '.env.local') })

const prisma = new PrismaClient()

async function syncNamesToClerk() {
  try {
    const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY

    if (!CLERK_SECRET_KEY) {
      throw new Error('CLERK_SECRET_KEY not found in environment variables')
    }

    // Get all users from Prisma
    const users = await prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true
      }
    })

    console.log(`\nFound ${users.length} users to sync\n`)

    for (const user of users) {
      try {
        // Split name into first and last
        const nameParts = user.name.split(' ')
        const firstName = nameParts[0] || user.name
        const lastName = nameParts.slice(1).join(' ') || ''

        // Update Clerk user using REST API
        const response = await fetch(`https://api.clerk.com/v1/users/${user.id}`, {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${CLERK_SECRET_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            first_name: firstName,
            last_name: lastName,
          }),
        })

        if (!response.ok) {
          const error = await response.text()
          throw new Error(`HTTP ${response.status}: ${error}`)
        }

        console.log(`✅ Updated ${user.email}: "${user.name}" -> firstName: "${firstName}", lastName: "${lastName}"`)
      } catch (error: any) {
        console.error(`❌ Failed to update ${user.email}:`, error.message)
      }
    }

    console.log('\n✨ Done! All users synced to Clerk.')
    console.log('💡 Users should now see their correct names after refreshing.')
  } catch (error) {
    console.error('❌ Error:', error)
  } finally {
    await prisma.$disconnect()
  }
}

syncNamesToClerk()
