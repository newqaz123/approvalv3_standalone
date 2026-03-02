/**
 * Database Setup Script for Phase 2 Testing
 *
 * This script ensures test data is ready:
 * - Creates test departments if they don't exist
 * - Assigns current users to departments
 * - Creates sample requests for testing
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('🔧 Setting up test data for Phase 2...\n')

  // Step 1: Create departments if they don't exist
  console.log('📁 Checking departments...')

  const departments = [
    { id: 'ENG', name: 'Engineering', type: 'ENGINEERING' as const },
    { id: 'QC', name: 'Quality Control', type: 'GENERAL' as const },
    { id: 'PD1', name: 'Production Department 1', type: 'GENERAL' as const },
    { id: 'ADMIN', name: 'Administration', type: 'GENERAL' as const },
  ]

  for (const dept of departments) {
    const existing = await prisma.department.findUnique({
      where: { id: dept.id },
    })

    if (!existing) {
      await prisma.department.create({ data: dept })
      console.log(`  ✅ Created department: ${dept.name}`)
    } else {
      console.log(`  ℹ️  Department exists: ${dept.name}`)
    }
  }

  // Step 2: Find users without departments and assign them
  console.log('\n👥 Checking users...')

  const usersWithoutDept = await prisma.user.findMany({
    where: { departmentId: null },
    select: { id: true, name: true, email: true, role: true },
  })

  if (usersWithoutDept.length > 0) {
    console.log(`  Found ${usersWithoutDept.length} user(s) without department:\n`)

    for (const user of usersWithoutDept) {
      // Assign department based on role
      const deptId = user.role === 'engineering' ? 'ENG' : 'QC'

      await prisma.user.update({
        where: { id: user.id },
        data: { departmentId: deptId },
      })

      console.log(`  ✅ Assigned ${user.name} (${user.email}) to ${deptId}`)
    }
  } else {
    console.log('  ✅ All users have departments assigned')
  }

  // Step 3: Show current user setup
  console.log('\n📊 Current User Setup:')
  const allUsers = await prisma.user.findMany({
    include: { department: true },
    orderBy: { createdAt: 'asc' },
  })

  console.log('\n┌─────────────────────────┬──────────────────┬─────────────────┐')
  console.log('│ Name                    │ Department       │ Role            │')
  console.log('├─────────────────────────┼──────────────────┼─────────────────┤')

  allUsers.forEach(user => {
    const name = (user.name || 'N/A').padEnd(23)
    const dept = (user.department?.name || 'NO DEPT!').padEnd(16)
    const role = (user.role || 'N/A').padEnd(15)
    console.log(`│ ${name} │ ${dept} │ ${role} │`)
  })

  console.log('└─────────────────────────┴──────────────────┴─────────────────┘')

  // Step 4: Check existing requests
  const requestCount = await prisma.request.count()
  console.log(`\n📋 Current requests in database: ${requestCount}`)

  console.log('\n✅ Database setup complete! Ready for testing.\n')
  console.log('💡 Next steps:')
  console.log('   1. Log in to the app with one of the users above')
  console.log('   2. Start testing request creation')
  console.log('   3. Follow the Phase 2 Manual Testing Guide\n')
}

main()
  .catch((e) => {
    console.error('❌ Error setting up test data:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
