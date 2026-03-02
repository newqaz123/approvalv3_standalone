import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function checkUsers() {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        departmentId: true
      },
      orderBy: { createdAt: 'desc' }
    })

    console.log(`\nTotal users: ${users.length}\n`)

    users.forEach(user => {
      console.log(`- ${user.name} (${user.email})`)
      console.log(`  ID: ${user.id}`)
      console.log(`  Role: ${user.role}, Dept: ${user.departmentId || 'None'}`)
      console.log('')
    })
  } catch (error) {
    console.error('❌ Error:', error)
  } finally {
    await prisma.$disconnect()
  }
}

checkUsers()
