import { PrismaClient } from '@prisma/client'
import { differenceInDays, differenceInHours, differenceInMinutes, subDays } from 'date-fns'

const prisma = new PrismaClient()

async function checkApprovalTimesPrecise() {
  console.log('=== Checking Approval Times with Precision ===\n')

  const now = new Date()
  const thirtyDaysAgo = subDays(now, 30)

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
  })

  console.log(`Found ${completedRequests.length} completed requests in last 30 days\n`)

  if (completedRequests.length === 0) {
    // Check for any completed requests ever
    const allCompleted = await prisma.request.findMany({
      where: {
        isDeleted: false,
        status: 'Completed',
      },
      select: {
        id: true,
        title: true,
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
      take: 5,
    })

    console.log(`Checking all-time completed requests: ${allCompleted.length}\n`)

    for (const req of allCompleted) {
      console.log(`📋 ${req.title}`)
      console.log(`   Created: ${req.createdAt.toISOString()}`)

      if (req.approvals.length > 0) {
        const first = req.approvals[0].approvedAt!
        const last = req.approvals[req.approvals.length - 1].approvedAt!

        console.log(`   First approval: ${first.toISOString()}`)
        console.log(`   Last approval: ${last.toISOString()}`)
        console.log(`   Using differenceInDays: ${differenceInDays(last, req.createdAt)} days`)
        console.log(`   Using differenceInHours / 24: ${(differenceInHours(last, req.createdAt) / 24).toFixed(2)} days`)
        console.log(`   Using differenceInMinutes / 1440: ${(differenceInMinutes(last, req.createdAt) / 1440).toFixed(2)} days`)
        console.log('')
      }
    }
    return
  }

  // Check the 30-day requests
  for (const req of completedRequests) {
    console.log(`📋 ${req.title}`)
    console.log(`   Created: ${req.createdAt.toISOString()}`)

    if (req.approvals.length > 0) {
      const first = req.approvals[0].approvedAt!
      const last = req.approvals[req.approvals.length - 1].approvedAt!

      console.log(`   First approval: ${first.toISOString()}`)
      console.log(`   Last approval: ${last.toISOString()}`)
      console.log(`   Using differenceInDays: ${differenceInDays(last, req.createdAt)} days`)
      console.log(`   Using differenceInHours / 24: ${(differenceInHours(last, req.createdAt) / 24).toFixed(2)} days`)
      console.log(`   Using differenceInMinutes / 1440: ${(differenceInMinutes(last, req.createdAt) / 1440).toFixed(2)} days`)
      console.log('')
    } else {
      console.log(`   No approvals found\n`)
    }
  }

  // Calculate what metrics should be with different methods
  console.log('\n=== Metric Comparison ===\n')

  const timesDays: number[] = []
  const timesHours: number[] = []
  const timesMinutes: number[] = []

  for (const request of completedRequests) {
    if (request.approvals.length > 0) {
      const lastApproval = request.approvals[request.approvals.length - 1].approvedAt!

      timesDays.push(differenceInDays(lastApproval, request.createdAt))
      timesHours.push(differenceInHours(lastApproval, request.createdAt) / 24)
      timesMinutes.push(differenceInMinutes(lastApproval, request.createdAt) / 1440)
    }
  }

  if (timesDays.length === 0) {
    console.log('No approval times to calculate')
    return
  }

  const avgDays = timesDays.reduce((a, b) => a + b, 0) / timesDays.length
  const avgHours = timesHours.reduce((a, b) => a + b, 0) / timesHours.length
  const avgMinutes = timesMinutes.reduce((a, b) => a + b, 0) / timesMinutes.length

  console.log('Using differenceInDays (current - WRONG):')
  console.log(`  Average: ${avgDays.toFixed(2)} days`)
  console.log(`  Min: ${Math.min(...timesDays)} days`)
  console.log(`  Max: ${Math.max(...timesDays)} days`)

  console.log('\nUsing differenceInHours / 24 (proposed):')
  console.log(`  Average: ${avgHours.toFixed(2)} days`)
  console.log(`  Min: ${Math.min(...timesHours).toFixed(2)} days`)
  console.log(`  Max: ${Math.max(...timesHours).toFixed(2)} days`)

  console.log('\nUsing differenceInMinutes / 1440 (most precise):')
  console.log(`  Average: ${avgMinutes.toFixed(2)} days`)
  console.log(`  Min: ${Math.min(...timesMinutes).toFixed(2)} days`)
  console.log(`  Max: ${Math.max(...timesMinutes).toFixed(2)} days`)
}

checkApprovalTimesPrecise()
  .catch((error) => {
    console.error('Error:', error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
