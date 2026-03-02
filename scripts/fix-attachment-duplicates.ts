import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function fixAttachmentDuplicates() {
  console.log('Finding and fixing duplicate attachments...\n')

  // Find all attachments with both requestId and solutionId set
  const duplicates = await prisma.fileAttachment.findMany({
    where: {
      AND: [
        { requestId: { not: null } },
        { solutionId: { not: null } },
      ],
    },
    include: {
      solution: {
        select: {
          id: true,
          createdAt: true,
        },
      },
    },
  })

  console.log(`Found ${duplicates.length} duplicate attachments to fix\n`)

  let fixedCount = 0

  for (const attachment of duplicates) {
    const fileCreatedAt = attachment.createdAt
    const solutionCreatedAt = attachment.solution!.createdAt

    // If file was uploaded before solution, it's a request file
    // If file was uploaded after solution, it's a solution file
    const isRequestFile = fileCreatedAt < solutionCreatedAt

    if (isRequestFile) {
      // Clear solutionId to make it a request-only file
      await prisma.fileAttachment.update({
        where: { id: attachment.id },
        data: { solutionId: null },
      })
      console.log(`✅ Fixed: ${attachment.fileName} (request file, cleared solutionId)`)
    } else {
      // Clear requestId to make it a solution-only file
      await prisma.fileAttachment.update({
        where: { id: attachment.id },
        data: { requestId: null },
      })
      console.log(`✅ Fixed: ${attachment.fileName} (solution file, cleared requestId)`)
    }

    fixedCount++
  }

  console.log(`\n✅ Fixed ${fixedCount} duplicate attachments`)
}

fixAttachmentDuplicates()
  .then(() => {
    console.log('\n✅ Cleanup complete')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ Error:', error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
