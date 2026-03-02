import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  // Check for users with pd01 in name/email/id
  const users = await prisma.user.findMany({
    where: {
      OR: [
        { email: { contains: 'pd01' } },
        { name: { contains: 'pd01' } },
        { id: { contains: 'pd01' } },
      ]
    },
    select: {
      id: true,
      email: true,
      name: true,
      departmentId: true,
      level: true,
      isActive: true,
    }
  })

  console.log('Users matching "pd01":', JSON.stringify(users, null, 2))

  // Count all users vs active users per department
  const departments = await prisma.department.findMany({
    include: {
      _count: {
        select: { users: true }
      }
    }
  })

  console.log('\n--- Department User Counts (All Users) ---')
  departments.forEach(dept => {
    console.log(`${dept.id}: ${dept._count.users} users`)
  })

  // Count active users per department
  const activeCounts = await prisma.user.groupBy({
    by: ['departmentId'],
    where: { isActive: true },
    _count: true
  })

  console.log('\n--- Department User Counts (Active Only) ---')
  activeCounts.forEach(item => {
    console.log(`${item.departmentId}: ${item._count} active users`)
  })

  // Check DepartmentApprover records for Engineering
  const deptApprovers = await prisma.departmentApprover.findMany({
    where: { departmentId: 'ENGINEERING' },
    include: {
      approver: {
        select: { id: true, name: true, email: true }
      }
    }
  })

  console.log('\n--- Engineering Department Approvers (Cross-dept) ---')
  console.log(JSON.stringify(deptApprovers, null, 2))

  await prisma.$disconnect()
}

main().catch(console.error)
