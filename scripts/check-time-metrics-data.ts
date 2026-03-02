import { PrismaClient } from '@prisma/client'
import { differenceInDays, subDays } from 'date-fns'

const prisma = new PrismaClient()

async function checkTimeMetricsData() {
  console.log('Checking for completed requests with approvals...\n')

  // Check date range (last 30 days)
  const now = new Date()
  const thirtyDaysAgo = subDays(now, 30)

  console.log(`Date Range: ${thirtyDaysAgo.toISOString()} to ${now.toISOString()}\n`)

  // Fetch completed requests in the last 30 days
  const completedRequests = await prisma.request.findMany({
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
      title: true,
      status: true,
      createdAt: true,
      approvals: {
        where: {
          approvedAt: { not: null },
        },
        select: {
          approvedAt: true,
          requiredLevel: true,
        },
        orderBy: {
          approvedAt: 'asc',
        },
      },
    },
    take: 10,
  })

  console.log(`Total Completed Requests in last 30 days: ${completedRequests.length}\n`)

  if (completedRequests.length === 0) {
    console.log('❌ No completed requests found in the last 30 days!')

    // Check all time
    const allCompletedRequests = await prisma.request.count({
      where: {
        isDeleted: false,
        status: 'Completed',
      },
    })
    console.log(`   Total completed requests (all time): ${allCompletedRequests}`)

    if (allCompletedRequests === 0) {
      console.log('   ⚠️  No completed requests exist in the database!')
    } else {
      // Get the most recent completed request
      const mostRecent = await prisma.request.findFirst({
        where: {
          isDeleted: false,
          status: 'Completed',
        },
        orderBy: {
          createdAt: 'desc',
        },
        select: {
          id: true,
          createdAt: true,
          title: true,
        },
      })
      console.log(`   Most recent completed request: "${mostRecent?.title}" created at ${mostRecent?.createdAt}`)
    }
    return
  }

  // Show sample of completed requests
  console.log('Sample completed requests:')
  for (const req of completedRequests.slice(0, 5)) {
    console.log(`\n📋 Request: ${req.title}`)
    console.log(`   ID: ${req.id}`)
    console.log(`   Created: ${req.createdAt}`)
    console.log(`   Approvals: ${req.approvals.length}`)

    if (req.approvals.length > 0) {
      const firstApproval = req.approvals[0].approvedAt!
      const lastApproval = req.approvals[req.approvals.length - 1].approvedAt!

      console.log(`   First approval: ${firstApproval}`)
      console.log(`   Last approval: ${lastApproval}`)

      const totalTime = differenceInDays(lastApproval, req.createdAt)
      console.log(`   Total approval time: ${totalTime} days`)

      // Show approval level times
      for (let i = 0; i < req.approvals.length; i++) {
        const approval = req.approvals[i]
        if (approval.approvedAt) {
          const prevDate = i === 0 ? req.createdAt : req.approvals[i - 1].approvedAt!
          const levelTime = differenceInDays(approval.approvedAt, prevDate)
          console.log(`   Level ${approval.requiredLevel} time: ${levelTime} days`)
        }
      }
    } else {
      console.log('   ⚠️  No approvals found for this completed request!')
    }
  }

  // Calculate what fetchTimeMetrics would return
  console.log('\n--- Calculating Time Metrics ---')

  const approvalTimes: number[] = []
  const approvalLevelTimes: number[] = []

  for (const request of completedRequests) {
    if (request.approvals.length > 0) {
      const firstApproval = request.approvals[0].approvedAt!
      const lastApproval = request.approvals[request.approvals.length - 1].approvedAt!

      const totalTime = differenceInDays(lastApproval, request.createdAt)
      approvalTimes.push(totalTime)

      for (let i = 0; i < request.approvals.length; i++) {
        const approval = request.approvals[i]
        if (approval.approvedAt) {
          const prevDate = i === 0 ? request.createdAt : request.approvals[i - 1].approvedAt!
          const levelTime = differenceInDays(approval.approvedAt, prevDate)
          approvalLevelTimes.push(levelTime)
        }
      }
    }
  }

  if (approvalTimes.length === 0) {
    console.log('❌ No approval times calculated (no completed requests with approvals)')
    console.log('\nResult: fetchTimeMetrics will return all zeros')
    console.log('       TimeMetricsChart will display "No time data available"')
    return
  }

  // Calculate statistics
  const avgPerRequest = approvalTimes.reduce((sum, time) => sum + time, 0) / approvalTimes.length
  const avgPerApprovalLevel =
    approvalLevelTimes.length > 0
      ? approvalLevelTimes.reduce((sum, time) => sum + time, 0) / approvalLevelTimes.length
      : 0
  const minPerRequest = Math.min(...approvalTimes)
  const maxPerRequest = Math.max(...approvalTimes)

  const sorted = [...approvalTimes].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const medianPerRequest =
    sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2

  console.log(`✅ Calculated metrics from ${approvalTimes.length} requests:`)
  console.log(`   avgPerRequest: ${avgPerRequest.toFixed(2)}`)
  console.log(`   avgPerApprovalLevel: ${avgPerApprovalLevel.toFixed(2)}`)
  console.log(`   medianPerRequest: ${medianPerRequest.toFixed(2)}`)
  console.log(`   minPerRequest: ${minPerRequest}`)
  console.log(`   maxPerRequest: ${maxPerRequest}`)
  console.log('\nResult: TimeMetricsChart should display these values')
}

checkTimeMetricsData()
  .catch((error) => {
    console.error('Error:', error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
