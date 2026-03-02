import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  // Get all departments
  const departments = await prisma.department.findMany({
    select: {
      id: true,
      name: true,
      type: true,
      levelNames: true,
    }
  })

  console.log('--- All Departments ---')
  console.table(departments)

  // Get users for ENG department
  const engUsers = await prisma.user.findMany({
    where: { departmentId: 'ENG' },
    select: {
      id: true,
      email: true,
      name: true,
      level: true,
      isActive: true,
    }
  })

  console.log('\n--- Users with departmentId = "ENG" ---')
  console.table(engUsers)

  // Also check if there's a department called "Engineering Level 3"
  const weirdDepts = await prisma.department.findMany({
    where: {
      name: { contains: 'Level' }
    }
  })

  console.log('\n--- Departments with "Level" in name (likely wrong) ---')
  console.table(weirdDepts)

  await prisma.$disconnect()
}

main().catch(console.error)
