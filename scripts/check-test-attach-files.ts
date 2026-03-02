import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function checkTestAttachRequest() {
  console.log('Checking "test attach" request...\n')

  // Find the request by title
  const requests = await prisma.request.findMany({
    where: {
      title: {
        contains: 'test attach',
        mode: 'insensitive',
      },
    },
    include: {
      fileAttachments: {
        select: {
          id: true,
          fileName: true,
          fileSize: true,
          createdAt: true,
          requestId: true,
          solutionId: true,
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
      solutions: {
        include: {
          fileAttachments: {
            select: {
              id: true,
              fileName: true,
              fileSize: true,
              createdAt: true,
              requestId: true,
              solutionId: true,
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
      },
    },
  })

  if (requests.length === 0) {
    console.log('No "test attach" requests found')
    return
  }

  requests.forEach((request) => {
    console.log(`\n${'='.repeat(80)}`)
    console.log(`Request: ${request.title}`)
    console.log(`ID: ${request.id}`)
    console.log(`Status: ${request.status}`)
    console.log(`Created: ${request.createdAt.toISOString()}`)
    console.log(`Updated: ${request.updatedAt.toISOString()}`)
    console.log(`\nRequest file attachments (${request.fileAttachments.length}):`)

    if (request.fileAttachments.length === 0) {
      console.log('  ⚠️  NO REQUEST FILES')
    } else {
      request.fileAttachments.forEach((file) => {
        console.log(`  📄 ${file.fileName}`)
        console.log(`      Size: ${(file.fileSize / 1024).toFixed(1)} KB`)
        console.log(`      Uploaded: ${file.createdAt.toISOString()}`)
        console.log(`      By: ${file.uploadedBy.name}`)
        console.log(`      requestId: ${file.requestId ? '✅' : '❌ NULL'}`)
        console.log(`      solutionId: ${file.solutionId ? '✅' : '❌ NULL'}`)
      })
    }

    if (request.solutions.length > 0) {
      const solution = request.solutions[0]
      console.log(`\nSolution: ${solution.title}`)
      console.log(`ID: ${solution.id}`)
      console.log(`Created: ${solution.createdAt.toISOString()}`)
      console.log(`\nSolution file attachments (${solution.fileAttachments.length}):`)

      if (solution.fileAttachments.length === 0) {
        console.log('  ⚠️  NO SOLUTION FILES')
      } else {
        solution.fileAttachments.forEach((file) => {
          console.log(`  📄 ${file.fileName}`)
          console.log(`      Size: ${(file.fileSize / 1024).toFixed(1)} KB`)
          console.log(`      Uploaded: ${file.createdAt.toISOString()}`)
          console.log(`      By: ${file.uploadedBy.name}`)
          console.log(`      requestId: ${file.requestId ? '✅' : '❌ NULL'}`)
          console.log(`      solutionId: ${file.solutionId ? '✅' : '❌ NULL'}`)
        })
      }
    }

    console.log(`\n${'='.repeat(80)}`)
  })
}

checkTestAttachRequest()
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
