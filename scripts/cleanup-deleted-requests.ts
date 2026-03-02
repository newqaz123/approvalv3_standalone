/**
 * Cleanup Old Deleted Requests Script
 *
 * This script permanently deletes requests that were soft-deleted older than a specified threshold.
 * It can be run manually or scheduled as a cron job.
 *
 * Usage:
 *   npx tsx scripts/cleanup-deleted-requests.ts
 *
 * Scheduling examples (cron):
 *   # Run monthly on the 1st at midnight
 *   0 0 1 * * cd /path/to/ApprovalAppV2 && npx tsx scripts/cleanup-deleted-requests.ts
 *
 *   # Run yearly on January 1st at midnight
 *   0 0 1 1 * cd /path/to/ApprovalAppV2 && npx tsx scripts/cleanup-deleted-requests.ts --threshold=365
 *
 * Environment variables:
 *   CLEANUP_THRESHOLD_DAYS - Number of days after soft-delete to permanent delete (default: 365)
 *   DRY_RUN - Set to "true" to simulate without deleting (default: false)
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(__dirname, '../.env.local') })

import prisma from '../src/lib/prisma'

interface CleanupStats {
  totalFound: number
  totalDeleted: number
  errors: string[]
}

async function cleanupDeletedRequests(thresholdDays: number, dryRun: boolean): Promise<CleanupStats> {
  const stats: CleanupStats = {
    totalFound: 0,
    totalDeleted: 0,
    errors: [],
  }

  console.log('🗑️  Starting cleanup of deleted requests...\n')
  console.log(`Configuration:`)
  console.log(`  Threshold: ${thresholdDays} days`)
  console.log(`  Mode: ${dryRun ? 'DRY RUN (no changes will be made)' : 'LIVE (will delete data)'}\n`)

  try {
    // Calculate cutoff date
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - thresholdDays)

    console.log(`  Cutoff date: ${cutoffDate.toISOString()}`)
    console.log(`  Deleting requests deleted before: ${cutoffDate.toLocaleString()}\n`)

    // Find requests to be deleted
    const requestsToDelete = await prisma.request.findMany({
      where: {
        isDeleted: true,
        deletedAt: {
          lt: cutoffDate,
        },
      },
      select: {
        id: true,
        title: true,
        deletedAt: true,
        requester: {
          select: {
            name: true,
            email: true,
          },
        },
      },
    })

    stats.totalFound = requestsToDelete.length

    if (requestsToDelete.length === 0) {
      console.log('✅ No requests found matching the cleanup criteria.\n')
      return stats
    }

    console.log(`Found ${requestsToDelete.length} requests to permanently delete:\n`)

    // List requests
    requestsToDelete.forEach((request, index) => {
      console.log(`  ${index + 1}. ${request.title}`)
      console.log(`     ID: ${request.id}`)
      console.log(`     Requester: ${request.requester.name} (${request.requester.email})`)
      console.log(`     Deleted at: ${request.deletedAt?.toLocaleString()}`)
      console.log('')
    })

    if (dryRun) {
      console.log('🔍 DRY RUN - No requests were deleted.\n')
      return stats
    }

    // Perform permanent deletion
    console.log('⚠️  Permanently deleting requests...\n')

    const result = await prisma.request.deleteMany({
      where: {
        isDeleted: true,
        deletedAt: {
          lt: cutoffDate,
        },
      },
    })

    stats.totalDeleted = result.count
    console.log(`✅ Successfully deleted ${result.count} requests.\n`)

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    stats.errors.push(errorMessage)
    console.error(`❌ Error during cleanup: ${errorMessage}\n`)
  }

  return stats
}

async function main() {
  const args = process.argv.slice(2)

  // Parse threshold from command line or environment
  let thresholdDays = parseInt(process.env.CLEANUP_THRESHOLD_DAYS || '365', 10)

  // Check for --threshold flag
  const thresholdIndex = args.findIndex(arg => arg.startsWith('--threshold='))
  if (thresholdIndex !== -1) {
    thresholdDays = parseInt(args[thresholdIndex].split('=')[1], 10)
  }

  // Check for --dry-run flag
  const dryRun = args.includes('--dry-run') || process.env.DRY_RUN === 'true'

  // Validate threshold
  if (isNaN(thresholdDays) || thresholdDays < 1) {
    console.error('❌ Invalid threshold. Must be a positive number of days.')
    process.exit(1)
  }

  // Run cleanup
  const stats = await cleanupDeletedRequests(thresholdDays, dryRun)

  // Print summary
  console.log('═══════════════════════════════════════')
  console.log('Cleanup Summary')
  console.log('═══════════════════════════════════════')
  console.log(`Total found:      ${stats.totalFound}`)
  console.log(`Total deleted:    ${stats.totalDeleted}`)
  console.log(`Errors:           ${stats.errors.length}`)

  if (stats.errors.length > 0) {
    console.log('\nErrors:')
    stats.errors.forEach(error => console.log(`  - ${error}`))
  }

  console.log('═══════════════════════════════════════\n')

  // Exit with error code if there were errors
  if (stats.errors.length > 0) {
    process.exit(1)
  }
}

main()
  .catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
  .finally(() => {
    // Close Prisma connection
    prisma.$disconnect()
  })
