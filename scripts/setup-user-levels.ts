/**
 * Setup user levels for testing approval hierarchy
 * Run: npx tsx scripts/setup-user-levels.ts
 */

import { config } from 'dotenv'
import { resolve } from 'path'

// Load environment variables from .env.local
config({ path: resolve(__dirname, '../.env.local') })

import prisma from '../src/lib/prisma'

async function setupUserLevels() {
  console.log('🔄 Setting up user levels for approval testing...\n')

  try {
    // Get all users with their departments
    const users = await prisma.user.findMany({
      where: { isActive: true },
      include: { department: true },
      orderBy: [{ departmentId: 'asc' }, { name: 'asc' }],
    })

    console.log(`Found ${users.length} active users\n`)

    // Assign levels (you can customize this based on your needs)
    for (const user of users) {
      // Default level assignment logic:
      // - Admins get level 5
      // - First user in each department gets level 3
      // - Second user gets level 2
      // - Others get level 1

      let level = 1

      if (user.role === 'admin') {
        level = 5
      } else {
        // Count users in same department with levels assigned
        const deptUsersWithLevels = await prisma.user.count({
          where: {
            departmentId: user.departmentId,
            level: { not: null },
            isActive: true,
          },
        })

        if (deptUsersWithLevels === 0) {
          level = 3 // First user in department = Level 3
        } else if (deptUsersWithLevels === 1) {
          level = 2 // Second user = Level 2
        } else {
          level = 1 // Others = Level 1
        }
      }

      await prisma.user.update({
        where: { id: user.id },
        data: { level },
      })

      console.log(`✅ ${user.name.padEnd(25)} → Level ${level} (${user.department?.name || 'No dept'})`)
    }

    console.log('\n✨ User levels setup complete!\n')
    console.log('📊 Summary by level:')

    const levelCounts = await prisma.user.groupBy({
      by: ['level'],
      where: { isActive: true, level: { not: null } },
      _count: true,
      orderBy: { level: 'desc' },
    })

    for (const { level, _count } of levelCounts) {
      console.log(`   Level ${level}: ${_count} users`)
    }

  } catch (error) {
    console.error('❌ Error:', error)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

setupUserLevels()
