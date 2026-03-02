/**
 * Update user names to be more descriptive for testing
 * Format: [Department] Level [X]
 * Run: npx tsx scripts/update-user-names.ts
 */

import { config } from 'dotenv'
import { resolve } from 'path'

// Load environment variables from .env.local
config({ path: resolve(__dirname, '../.env.local') })

import prisma from '../src/lib/prisma'

async function updateUserNames() {
  console.log('🔄 Updating user names for easier testing...\n')

  try {
    // Get all users with their departments
    const users = await prisma.user.findMany({
      where: { isActive: true },
      include: { department: true },
      orderBy: [{ departmentId: 'asc' }, { level: 'desc' }],
    })

    console.log(`Found ${users.length} active users\n`)

    let updated = 0
    let skipped = 0

    for (const user of users) {
      // Skip if already has a good name (not just "User")
      if (user.name !== 'User' && !user.name.includes('Level')) {
        console.log(`⏭️  Skipping: ${user.name} (already has custom name)`)
        skipped++
        continue
      }

      // Generate descriptive name
      let newName = ''

      if (user.role === 'admin') {
        newName = `Admin - ${user.department?.name || 'No Dept'}`
      } else if (user.department && user.level) {
        // Shorten department names for readability
        const deptShort = getDepartmentShortName(user.department.name)
        newName = `${deptShort} Level ${user.level}`
      } else if (user.department) {
        newName = `${user.department.name} User`
      } else {
        newName = `User (No Dept)`
      }

      // Update user
      await prisma.user.update({
        where: { id: user.id },
        data: { name: newName },
      })

      console.log(`✅ ${user.email.padEnd(30)} → ${newName}`)
      updated++
    }

    console.log(`\n✨ Update complete!`)
    console.log(`   Updated: ${updated}`)
    console.log(`   Skipped: ${skipped}`)

    // Display summary
    console.log('\n📊 Current Users:')
    const updatedUsers = await prisma.user.findMany({
      where: { isActive: true },
      include: { department: true },
      orderBy: [{ departmentId: 'asc' }, { level: 'desc' }],
    })

    for (const user of updatedUsers) {
      const dept = user.department?.name || 'No Dept'
      const level = user.level ? `L${user.level}` : 'L?'
      console.log(`   ${level} ${user.name.padEnd(30)} (${user.email})`)
    }

  } catch (error) {
    console.error('❌ Error:', error)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

function getDepartmentShortName(deptName: string): string {
  const shortNames: Record<string, string> = {
    'Quality Control': 'QC',
    'Production Department 1': 'PD1',
    'Production Department 2': 'PD2',
    'Production Department 3': 'PD3',
    'Engineering': 'Engineering',
    'Water Treatment': 'WWT',
    'Utility': 'Utility',
    'Boiler Maintenance': 'BM',
    'TTEC': 'TTEC',
    'Admin': 'Admin',
    'Maintenance': 'Maintenance',
    'OSEC': 'OSEC',
  }

  return shortNames[deptName] || deptName
}

updateUserNames()
