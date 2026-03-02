/**
 * Manually assign user levels for testing
 * Run: npx tsx scripts/assign-user-levels-manual.ts
 */

import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(__dirname, '../.env.local') })

import prisma from '../src/lib/prisma'

// CONFIGURE YOUR USERS HERE
const userLevelMapping = {
  // Quality Control Department
  'patawatnew@hotmail.com': { level: 5, name: 'Admin (QC Level 5)' },
  'test01@gmail.com': { level: 2, name: 'QC Level 2' },
  'test02@gmail.com': { level: 1, name: 'QC Level 1' },

  // Production Department 1
  'userpd1@gmail.com': { level: 3, name: 'PD1 Level 3' },
  'userpd1_1@gmail.com': { level: 2, name: 'PD1 Level 2' },

  // Engineering Department
  'enguser01@gmail.com': { level: 3, name: 'Engineering Level 3' },
  // 'patawatnew@hotmail.com': { level: 2, name: 'Engineering Level 2' }, // if has engineering user (duplicate - removed)

  // Others
  'test03@gmail.com': { level: 1, name: 'No Dept User' },
}

async function assignUserLevels() {
  console.log('🔄 Manually assigning user levels and names...\n')

  try {
    let updated = 0
    let notFound = 0

    for (const [email, config] of Object.entries(userLevelMapping)) {
      const user = await prisma.user.findUnique({
        where: { email },
        include: { department: true },
      })

      if (!user) {
        console.log(`⚠️  User not found: ${email}`)
        notFound++
        continue
      }

      await prisma.user.update({
        where: { email },
        data: {
          level: config.level,
          name: config.name,
        },
      })

      const dept = user.department?.name || 'No Dept'
      console.log(`✅ ${email.padEnd(30)} → Level ${config.level} | ${config.name}`)
      updated++
    }

    console.log(`\n✨ Update complete!`)
    console.log(`   Updated: ${updated}`)
    console.log(`   Not found: ${notFound}`)

    // Display final summary
    console.log('\n📊 Final User Configuration:')
    const users = await prisma.user.findMany({
      where: { isActive: true },
      include: { department: true },
      orderBy: [{ departmentId: 'asc' }, { level: 'desc' }],
    })

    const groupedByDept: Record<string, typeof users> = {}
    for (const user of users) {
      const deptName = user.department?.name || 'No Department'
      if (!groupedByDept[deptName]) {
        groupedByDept[deptName] = []
      }
      groupedByDept[deptName].push(user)
    }

    for (const [deptName, deptUsers] of Object.entries(groupedByDept)) {
      console.log(`\n   ${deptName}:`)
      for (const user of deptUsers.sort((a, b) => (b.level || 0) - (a.level || 0))) {
        console.log(`      Level ${user.level || '?'}: ${user.name} (${user.email})`)
      }
    }

  } catch (error) {
    console.error('❌ Error:', error)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

assignUserLevels()
