import { PrismaClient } from '@prisma/client'
import { subDays, differenceInMinutes } from 'date-fns'

const prisma = new PrismaClient()

async function testFixedTimeMetrics() {
  console.log('=== Testing Fixed fetchTimeMetrics Function ===\n')

  const now = new Date()
  const thirtyDaysAgo = subDays(now, 30)

  // Fetch completed requests with their approval dates
  const requests = await prisma.request.findMany({
    where: {
      isDeleted: false,
      status: 'Completed',
      createdAt: {
        gte: thirtyDaysAgo,
        lte: now,
      },
    },
    select: {
      id: true,
      createdAt: true,
      approvals: {
        where: {
          approvedAt: { not: null },
        },
        select: {
          approvedAt: true,
        },
        orderBy: {
          approvedAt: 'asc',
        },
      },
    },
  })

  console.log(`Found ${requests.length} completed requests in last 30 days\n`)

  // Calculate approval times using FIXED method
  const approvalTimes: number[] = []
  const approvalLevelTimes: number[] = []

  for (const request of requests) {
    if (request.approvals.length > 0) {
      const firstApproval = request.approvals[0].approvedAt!
      const lastApproval = request.approvals[request.approvals.length - 1].approvedAt!

      // FIXED: Use differenceInMinutes / 1440 instead of differenceInDays
      const totalTime = differenceInMinutes(lastApproval, request.createdAt) / 1440
      approvalTimes.push(totalTime)

      // Calculate time per approval level
      for (let i = 0; i < request.approvals.length; i++) {
        const approval = request.approvals[i]
        if (approval.approvedAt) {
          const prevDate = i === 0 ? request.createdAt : request.approvals[i - 1].approvedAt!
          const levelTime = differenceInMinutes(approval.approvedAt, prevDate) / 1440
          approvalLevelTimes.push(levelTime)
        }
      }
    }
  }

  // Handle empty data case
  if (approvalTimes.length === 0) {
    console.log('❌ No approval times found')
    console.log('\nTimeMetrics result would be:')
    console.log('  avgPerRequest: 0')
    console.log('  avgPerApprovalLevel: 0')
    console.log('  medianPerRequest: 0')
    console.log('  minPerRequest: 0')
    console.log('  maxPerRequest: 0')
    console.log('\n⚠️  TimeMetricsChart would display "No time data available"')
    return
  }

  // Calculate statistics using FIXED method
  const avgPerRequest =
    approvalTimes.reduce((sum, time) => sum + time, 0) / approvalTimes.length
  const avgPerApprovalLevel =
    approvalLevelTimes.length > 0
      ? approvalLevelTimes.reduce((sum, time) => sum + time, 0) / approvalLevelTimes.length
      : 0
  const minPerRequest = Math.min(...approvalTimes)
  const maxPerRequest = Math.max(...approvalTimes)

  // Calculate median
  const sorted = [...approvalTimes].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const medianPerRequest =
    sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2

  console.log('✅ FIXED TimeMetrics result:')
  console.log(`  avgPerRequest: ${avgPerRequest.toFixed(2)} days`)
  console.log(`  avgPerApprovalLevel: ${avgPerApprovalLevel.toFixed(2)} days`)
  console.log(`  medianPerRequest: ${medianPerRequest.toFixed(2)} days`)
  console.log(`  minPerRequest: ${minPerRequest.toFixed(2)} days`)
  console.log(`  maxPerRequest: ${maxPerRequest.toFixed(2)} days`)

  console.log('\n✅ TimeMetricsChart will now display these values instead of "No time data available"')

  // Verify the empty data check would pass
  const isEmptyData =
    avgPerRequest === 0 &&
    avgPerApprovalLevel === 0 &&
    medianPerRequest === 0 &&
    minPerRequest === 0 &&
    maxPerRequest === 0

  console.log(`\nEmpty data check: ${isEmptyData ? 'FAIL (would show empty message)' : 'PASS (will show chart)'}`)
}

testFixedTimeMetrics()
  .catch((error) => {
    console.error('Error:', error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
