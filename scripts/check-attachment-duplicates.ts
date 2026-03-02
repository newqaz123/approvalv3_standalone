import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function checkAttachmentDuplicates() {
  console.log('Checking for duplicate attachments...\n')

  // Get all file attachments
  const attachments = await prisma.fileAttachment.findMany({
    include: {
      request: {
        select: {
          id: true,
          title: true,
        },
      },
      solution: {
        select: {
          id: true,
          title: true,
          request: {
            select: {
              id: true,
              title: true,
            },
          },
        },
      },
    },
  })

  console.log(`Total attachments: ${attachments.length}\n`)

  // Check for attachments with both requestId and solutionId
  const bothSet = attachments.filter(a => a.requestId && a.solutionId)
  console.log(`Attachments with BOTH requestId AND solutionId: ${bothSet.length}`)

  if (bothSet.length > 0) {
    console.log('\n⚠️  DUPLICATES FOUND:\n')
    bothSet.forEach(a => {
      console.log(`- File: ${a.fileName}`)
      console.log(`  Request ID: ${a.requestId}`)
      console.log(`  Solution ID: ${a.solutionId}`)
      console.log(`  Request Title: ${a.request?.title}`)
      console.log(`  Solution Title: ${a.solution?.title}`)
      console.log('')
    })
  } else {
    console.log('✅ No attachments have both requestId and solutionId set')
  }

  // Group by fileName to check for exact duplicates
  const byFileName = attachments.reduce((acc, a) => {
    if (!acc[a.fileName]) {
      acc[a.fileName] = []
    }
    acc[a.fileName].push(a)
    return acc
  }, {} as Record<string, typeof attachments>)

  const exactDuplicates = Object.entries(byFileName).filter(([name, atts]) => atts.length > 1)

  console.log(`\nExact duplicate file names: ${exactDuplicates.length}`)

  if (exactDuplicates.length > 0) {
    console.log('\n⚠️  FILES WITH SAME NAME:\n')
    exactDuplicates.forEach(([name, atts]) => {
      console.log(`- ${name} (${atts.length} copies)`)
      atts.forEach(a => {
        console.log(`  ID: ${a.id}`)
        console.log(`  Request: ${a.requestId ? a.request?.title : 'none'}`)
        console.log(`  Solution: ${a.solutionId ? a.solution?.title : 'none'}`)
        console.log('')
      })
    })
  }

  // Show sample of attachments
  console.log('\nSample attachments:\n')
  attachments.slice(0, 10).forEach(a => {
    console.log(`- ${a.fileName}`)
    console.log(`  Request: ${a.requestId ? a.request?.title : 'none'}`)
    console.log(`  Solution: ${a.solutionId ? a.solution?.title : 'none'}`)
    console.log('')
  })
}

checkAttachmentDuplicates()
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
