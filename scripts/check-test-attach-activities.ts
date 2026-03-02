import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function checkTestAttachTimeline() {
  console.log('Checking "test attach" request timeline...\n')

  const requests = await prisma.request.findMany({
    where: {
      title: {
        contains: 'test attach',
        mode: 'insensitive',
      },
    },
    orderBy: {
      createdAt: 'desc',
    },
    include: {
      activities: {
        include: {
          user: {
            select: {
              name: true,
            },
          },
        },
        orderBy: {
          createdAt: 'asc',
        },
      },
      fileAttachments: {
        include: {
          uploadedBy: {
            select: {
              name: true,
            },
          },
        },
        orderBy: {
          createdAt: 'asc',
        },
      },
    },
  })

  if (requests.length === 0) {
    console.log('No requests found')
    return
  }

  requests.forEach((request) => {
    console.log(`\n${'='.repeat(80)}`)
    console.log(`Request: ${request.title}`)
    console.log(`ID: ${request.id}`)
    console.log(`\nTimeline:\n`)

  console.log('ACTIVITIES:')
  request.activities.forEach((activity, index) => {
    console.log(`${index + 1}. [${activity.createdAt.toISOString()}] ${activity.action} by ${activity.user.name}`)
    if (activity.fromStatus) {
      console.log(`   ${activity.fromStatus} → ${activity.toStatus}`)
    }
    if (activity.comments) {
      console.log(`   "${activity.comments}"`)
    }
  })

  console.log(`\nFILE ATTACHMENTS:`)
  request.fileAttachments.forEach((file, index) => {
    console.log(`${index + 1}. [${file.createdAt.toISOString()}] ${file.fileName}`)
    console.log(`   By: ${file.uploadedBy?.name || 'Unknown'}`)
    console.log(`   requestId: ${file.requestId || 'NULL'}, solutionId: ${file.solutionId || 'NULL'}`)
  })

  console.log(`\nREQUEST STATUS CHANGES:`)
  console.log(`Created: ${request.createdAt.toISOString()}`)
  console.log(`Updated: ${request.updatedAt.toISOString()}`)
  console.log(`Current Status: ${request.status}`)
    console.log(`${'='.repeat(80)}`)
  })
}

checkTestAttachTimeline()
  .then(() => {
    console.log('\n✅ Check complete')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ Error:', error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
