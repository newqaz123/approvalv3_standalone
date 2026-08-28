import prisma from '@/lib/prisma'
import { deleteAttachmentFile } from '@/lib/attachments/storage'
import { revalidatePath } from 'next/cache'
import { revalidateRequestViews } from '@/server-actions/request-view-invalidation'
import {
  cleanupUnreferencedInlineImages,
  type InlineImageCleanupResult,
} from '@/lib/inline-images/lifecycle'

const INLINE_IMAGE_CLEANUP_LIMIT = 100

export type HardDeleteArchivedRow = {
  id: string
  fileAttachments: Array<{ filePath: string }>
  solutions: Array<{ fileAttachments: Array<{ filePath: string }> }>
}

/** Narrow database/storage adapter so ordering and failures stay testable. */
export type HardDeleteArchivedRequestsDeps = {
  findArchivedRequests(requestIds: string[]): Promise<HardDeleteArchivedRow[]>
  /**
   * Database-only deletion. Request/solution inline image reference cascades
   * commit when this resolves; file I/O never runs inside it.
   */
  deleteArchivedRequests(requestIds: string[]): Promise<void>
  deleteAttachmentFile(filePath: string): Promise<void>
  cleanupUnreferencedInlineImages(input: {
    olderThan: Date
    limit: number
  }): Promise<InlineImageCleanupResult>
  revalidateViews(): void
}

/**
 * Deletes archived requests. Reference cascades (including request and
 * solution inline image references) commit here; keep file I/O out so a
 * storage failure can never roll back the database deletion.
 */
async function deleteArchivedRequestsTransaction(requestIds: string[]): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL app.bypass_audit = 'true'`
    await tx.requests.deleteMany({
      where: { id: { in: requestIds }, isArchived: true },
    })
  })
}

const productionHardDeleteDeps: HardDeleteArchivedRequestsDeps = {
  findArchivedRequests: (requestIds) =>
    prisma.requests.findMany({
      where: { id: { in: requestIds }, isArchived: true, isDeleted: false },
      select: {
        id: true,
        fileAttachments: { select: { filePath: true } },
        solutions: { select: { fileAttachments: { select: { filePath: true } } } },
      },
    }),
  deleteArchivedRequests: deleteArchivedRequestsTransaction,
  deleteAttachmentFile,
  cleanupUnreferencedInlineImages,
  revalidateViews: () => {
    revalidateRequestViews()
    revalidatePath('/admin/retention')
  },
}

export async function hardDeleteArchivedRequests(
  requestIds: string[],
  deps: HardDeleteArchivedRequestsDeps = productionHardDeleteDeps
): Promise<
  { success: true; deleted: number; fileWarnings: string[] } | { success: false; error: string }
> {
  const ids = [...new Set(requestIds.filter((id) => typeof id === 'string' && id.length > 0))]
  if (ids.length === 0) {
    return { success: false, error: 'Select at least one archived request' }
  }

  const rows = await deps.findArchivedRequests(ids)

  if (rows.length === 0) {
    return { success: false, error: 'Only archived requests can be hard-deleted' }
  }

  const paths = rows.flatMap((row) => [
    ...row.fileAttachments.map((file) => file.filePath),
    ...row.solutions.flatMap((solution) => solution.fileAttachments.map((file) => file.filePath)),
  ])

  try {
    await deps.deleteArchivedRequests(rows.map((row) => row.id))
  } catch (error) {
    console.error('Error hard-deleting archived requests:', error)
    return { success: false, error: 'Failed to hard-delete archived requests' }
  }

  const settled = await Promise.allSettled(paths.map((path) => deps.deleteAttachmentFile(path)))
  const fileWarnings: string[] = []
  settled.forEach((outcome, index) => {
    if (outcome.status === 'rejected') {
      const warning = `Orphaned file after hard-delete (${paths[index]}): ${String(outcome.reason)}`
      console.warn(`[retention-hard-delete] ${warning}`)
      fileWarnings.push(warning)
    }
  })

  // The deletion above has committed, so assets whose request/solution
  // references cascaded away are now unreferenced; a now cutoff picks them up.
  // Assets still referenced by other owners stay out of the candidate set.
  try {
    const cleanup = await deps.cleanupUnreferencedInlineImages({
      olderThan: new Date(),
      limit: INLINE_IMAGE_CLEANUP_LIMIT,
    })
    fileWarnings.push(...cleanup.warnings)
  } catch (error) {
    const warning = `Inline image cleanup failed after hard-delete: ${String(error)}`
    console.warn(`[retention-hard-delete] ${warning}`)
    fileWarnings.push(warning)
  }

  deps.revalidateViews()
  return { success: true, deleted: rows.length, fileWarnings }
}
