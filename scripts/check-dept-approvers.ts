import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  // Get all DepartmentApprover records
  const allApprovers = await prisma.departmentApprover.findMany({
    include: {
      department: { select: { id: true, name: true } },
      approver: { select: { id: true, name: true, email: true, departmentId: true } }
    }
  })

  console.log('--- All Department Approvers (Cross-dept) ---')
  console.table(allApprovers.map(a => ({
    dept: a.department.name,
    approver: a.approver.name,
    approverEmail: a.approver.email,
    approverDept: a.approver.departmentId,
    level: a.approverLevel
  })))

  // Check specifically for userpd1
  const userpd1Approvers = await prisma.departmentApprover.findMany({
    where: {
      approver: {
        OR: [
          { email: { contains: 'userpd1' } },
          { name: { contains: 'PD1' } }
        ]
      }
    },
    include: {
      department: { select: { id: true, name: true } },
      approver: { select: { id: true, name: true, email: true, departmentId: true } }
    }
  })

  console.log('\n--- userpd1 Cross-Department Approver Roles ---')
  console.table(userpd1Approvers.map(a => ({
    dept: a.department.name,
    approver: a.approver.name,
    approverDept: a.approver.departmentId,
    level: a.approverLevel
  })))

  await prisma.$disconnect()
}

main().catch(console.error)
