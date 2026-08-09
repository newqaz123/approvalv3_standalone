import prisma from '@/lib/prisma'

/**
 * Request-visibility authorization for private attachment downloads.
 *
 * Rule (exact):
 *  - Missing / inactive user, missing request, or soft-deleted request → false.
 *  - Admin and engineering users (role `admin`/`engineering`, or a department of
 *    type `ENGINEERING`) may view any non-deleted request.
 *  - Everyone else (general users) must have an explicit relationship to the
 *    request: the same department, a direct request-approval assignment, or a
 *    direct solution-approval assignment.
 *
 * Archived requests are NOT blanket-denied: the existing detail accessor
 * (`getRequest`) returns them via `findUnique` and the list view exposes an
 * explicit `showArchived` toggle, i.e. existing listings include archived data,
 * satisfying the brief's "unless existing request listings explicitly include
 * archived data" carve-out. Soft-deleted requests are always denied.
 */
export async function canUserViewRequest(userId: string, requestId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      isActive: true,
      role: true,
      departmentId: true,
      department: { select: { type: true } },
    },
  })
  if (!user || !user.isActive) return false

  const request = await prisma.requests.findUnique({
    where: { id: requestId },
    select: { isDeleted: true, departmentId: true },
  })
  if (!request || request.isDeleted) return false

  if (user.role === 'admin' || user.role === 'engineering' || user.department?.type === 'ENGINEERING') {
    return true
  }

  // General users: same department.
  if (user.departmentId && request.departmentId === user.departmentId) {
    return true
  }

  // General users: direct request approver (designated or actual).
  const requestApproval = await prisma.request_approvals.findFirst({
    where: { requestId, OR: [{ approverId: userId }, { requiredApproverId: userId }] },
    select: { id: true },
  })
  if (requestApproval) return true

  // General users: direct solution approver for one of the request's solutions.
  const solutionApproval = await prisma.solution_approvals.findFirst({
    where: {
      solution: { requestId },
      OR: [{ approverId: userId }, { requiredApproverId: userId }],
    },
    select: { id: true },
  })
  return Boolean(solutionApproval)
}
