import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  // Get ALL users with their department and level info
  const users = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      name: true,
      departmentId: true,
      level: true,
      isActive: true,
      role: true,
    },
    orderBy: { departmentId: 'asc' }
  })

  console.log('--- All Users ---')
  console.table(users)

  // Check inactive users per department
  const inactiveUsers = await prisma.user.findMany({
    where: { isActive: false },
    select: {
      id: true,
      email: true,
      name: true,
      departmentId: true,
      level: true,
    }
  })

  console.log('\n--- Inactive Users ---')
  console.table(inactiveUsers)

  // Check hierarchy change log
  const recentChanges = await prisma.hierarchyChangeLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: 10,
    include: {
      adminUser: { select: { name: true } },
      targetUser: { select: { name: true } }
    }
  })

  console.log('\n--- Recent Hierarchy Changes ---')
  console.table(recentChanges.map(log => ({
    timestamp: log.createdAt,
    admin: log.adminUser.name,
    target: log.targetUser.name,
    oldLevel: log.oldLevel,
    newLevel: log.newLevel
  })))

  await prisma.$disconnect()
}

main().catch(console.error)
