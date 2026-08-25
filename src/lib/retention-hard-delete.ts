import prisma from '@/lib/prisma'
import { deleteAttachmentFile } from '@/lib/attachments/storage'
import { revalidatePath } from 'next/cache'
import { revalidateRequestViews } from '@/server-actions/request-view-invalidation'

export async function hardDeleteArchivedRequests(requestIds: string[]): Promise<
  { success: true; deleted: number; fileWarnings: string[] } | { success: false; error: string }
> {
  const ids = [...new Set(requestIds.filter((id) => typeof id === 'string' && id.length > 0))]
  if (ids.length === 0) {
    return { success: false, error: 'Select at least one archived request' }
  }

  const rows = await prisma.requests.findMany({
    where: { id: { in: ids }, isArchived: true, isDeleted: false },
    select: {
      id: true,
      fileAttachments: { select: { filePath: true } },
      solutions: { select: { fileAttachments: { select: { filePath: true } } } },
    },
  })

  if (rows.length === 0) {
    return { success: false, error: 'Only archived requests can be hard-deleted' }
  }

  const paths = rows.flatMap((row) => [
    ...row.fileAttachments.map((file) => file.filePath),
    ...row.solutions.flatMap((solution) => solution.fileAttachments.map((file) => file.filePath)),
  ])

  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL app.bypass_audit = 'true'`
      await tx.requests.deleteMany({
        where: { id: { in: rows.map((row) => row.id) }, isArchived: true },
      })
    })
  } catch (error) {
    console.error('Error hard-deleting archived requests:', error)
    return { success: false, error: 'Failed to hard-delete archived requests' }
  }

  const settled = await Promise.allSettled(paths.map((path) => deleteAttachmentFile(path)))
  const fileWarnings: string[] = []
  settled.forEach((outcome, index) => {
    if (outcome.status === 'rejected') {
      const warning = `Orphaned file after hard-delete (${paths[index]}): ${String(outcome.reason)}`
      console.warn(`[retention-hard-delete] ${warning}`)
      fileWarnings.push(warning)
    }
  })

  revalidateRequestViews()
  revalidatePath('/admin/retention')
  return { success: true, deleted: rows.length, fileWarnings }
}
