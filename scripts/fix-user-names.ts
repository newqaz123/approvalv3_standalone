import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function fixUserNames() {
  try {
    // Find all users with name "User"
    const usersWithDefaultName = await prisma.user.findMany({
      where: { name: 'User' }
    })

    console.log(`Found ${usersWithDefaultName.length} users with default name "User"`)

    for (const user of usersWithDefaultName) {
      // Use email prefix as name
      const newName = user.email.split('@')[0]

      await prisma.user.update({
        where: { id: user.id },
        data: { name: newName }
      })

      console.log(`✅ Updated user ${user.id}: "User" -> "${newName}" (${user.email})`)
    }

    console.log('\n✨ Done! All users updated.')
  } catch (error) {
    console.error('❌ Error:', error)
  } finally {
    await prisma.$disconnect()
  }
}

fixUserNames()
