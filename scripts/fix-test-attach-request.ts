import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function fixTestAttachRequest() {
  console.log('Fixing "test attach" request files...\n')

  const request = await prisma.request.findFirst({
    where: {
      title: {
        contains: 'test attach',
        mode: 'insensitive',
      },
      createdAt: {
        gte: new Date('2026-02-21'),
      },
    },
    include: {
      activities: {
        where: {
          action: 'status_changed',
          toStatus: 'SentToEngineer',
        },
        orderBy: {
          createdAt: 'asc',
        },
      },
      solutions: {
        include: {
          fileAttachments: true,
        },
      },
    },
  })

  if (!request) {
    console.log('Request not found')
    return
  }

  console.log(`Request: ${request.title}`)
  console.log(`ID: ${request.id}`)

  // Get the timestamp when status first changed to SentToEngineer
  const sentToEngineerAt = request.activities[0]?.createdAt
  if (!sentToEngineerAt) {
    console.log('No status change activity found')
    return
  }

  console.log(`Status changed to SentToEngineer at: ${sentToEngineerAt.toISOString()}`)

  if (request.solutions.length === 0) {
    console.log('No solution found')
    return
  }

  const solution = request.solutions[0]
  console.log(`Solution: ${solution.title}`)
  console.log(`Solution ID: ${solution.id}`)
  console.log(`Solution created: ${solution.createdAt.toISOString()}`)

  console.log('\nFiles before fix:')
  solution.fileAttachments.forEach((file) => {
    console.log(`  📄 ${file.fileName}`)
    console.log(`      Uploaded: ${file.createdAt.toISOString()}`)
    console.log(`      requestId: ${file.requestId || 'NULL'}, solutionId: ${file.solutionId || 'NULL'}`)
    console.log(`      After SentToEngineer? ${file.createdAt > sentToEngineerAt ? 'YES' : 'NO'}`)
  })

  // Fix files: move files uploaded BEFORE SentToEngineer back to request
  const filesToMoveBack = solution.fileAttachments.filter(
    (file) => file.createdAt < sentToEngineerAt
  )

  console.log(`\nMoving ${filesToMoveBack.length} files back to request...`)

  for (const file of filesToMoveBack) {
    console.log(`  Moving: ${file.fileName}`)
    await prisma.fileAttachment.update({
      where: { id: file.id },
      data: {
        requestId: request.id,
        solutionId: null,
      },
    })
  }

  console.log('\n✅ Fix complete!')

  // Verify
  const updatedRequest = await prisma.request.findUnique({
    where: { id: request.id },
    include: {
      fileAttachments: {
        orderBy: {
          createdAt: 'asc',
        },
      },
      solutions: {
        include: {
          fileAttachments: {
            orderBy: {
              createdAt: 'asc',
            },
          },
        },
      },
    },
  })

  console.log('\nFiles after fix:')
  console.log(`Request file attachments (${updatedRequest!.fileAttachments.length}):`)
  updatedRequest!.fileAttachments.forEach((file) => {
    console.log(`  📄 ${file.fileName}`)
    console.log(`      requestId: ✅, solutionId: NULL`)
  })

  console.log(`\nSolution file attachments (${updatedRequest!.solutions[0].fileAttachments.length}):`)
  updatedRequest!.solutions[0].fileAttachments.forEach((file) => {
    console.log(`  📄 ${file.fileName}`)
    console.log(`      requestId: NULL, solutionId: ✅`)
  })
}

fixTestAttachRequest()
  .then(() => {
    console.log('\n✅ Done!')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ Error:', error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
