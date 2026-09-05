const { PrismaClient } = require('@prisma/client')
const { hashSync } = require('bcryptjs')

const prisma = new PrismaClient()

const users = [
  {
    email: 'canonical.requester@example.com',
    name: 'Canonical Requester L5',
    role: 'general_dept',
    departmentId: 'PD1',
    level: 5,
  },
  {
    email: 'canonical.request.approver@example.com',
    name: 'Canonical Request Approver L6',
    role: 'general_dept',
    departmentId: 'PD1',
    level: 6,
  },
  {
    email: 'canonical.engineer@example.com',
    name: 'Canonical Engineer L5',
    role: 'engineering',
    departmentId: 'ENG',
    level: 5,
  },
  {
    email: 'canonical.solution.approver@example.com',
    name: 'Canonical Solution Approver L6',
    role: 'engineering',
    departmentId: 'ENG',
    level: 6,
  },
]

async function main() {
  const requiredDepartments = await prisma.departments.findMany({
    where: { id: { in: ['PD1', 'ENG'] } },
    select: { id: true, name: true, type: true },
  })
  if (requiredDepartments.length !== 2) {
    throw new Error('Expected PD1 and ENG departments in the connected database')
  }

  const passwordHash = hashSync('changeme', 12)
  for (const fixture of users) {
    await prisma.user.upsert({
      where: { email: fixture.email },
      update: {
        name: fixture.name,
        passwordHash,
        role: fixture.role,
        departmentId: fixture.departmentId,
        level: fixture.level,
        isActive: true,
        forcePasswordChange: false,
      },
      create: {
        ...fixture,
        passwordHash,
        isActive: true,
        forcePasswordChange: false,
      },
    })
  }

  const fixtures = await prisma.user.findMany({
    where: { email: { in: users.map((user) => user.email) } },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      level: true,
      isActive: true,
      forcePasswordChange: true,
      department: { select: { id: true, name: true, type: true } },
    },
    orderBy: { email: 'asc' },
  })

  console.log(JSON.stringify({ fixtures }, null, 2))
}

main()
  .finally(async () => prisma.$disconnect())
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
