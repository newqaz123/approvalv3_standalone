export type UserRole = 'admin' | 'general_dept' | 'engineering'

export function roleForAdminFlag(isAdmin: boolean): 'admin' | 'general_dept' {
  return isAdmin ? 'admin' : 'general_dept'
}

export function isAdminRole(role: string | null | undefined): boolean {
  return role === 'admin'
}

export function adminChangeBlockedReason(input: {
  actorId: string
  targetId: string
  targetIsActiveAdmin: boolean
  nextIsActiveAdmin: boolean
  otherActiveAdminCount: number
}): string | null {
  if (!input.targetIsActiveAdmin || input.nextIsActiveAdmin) return null
  if (input.actorId === input.targetId) {
    return 'You cannot remove your own administrator access'
  }
  if (input.otherActiveAdminCount === 0) {
    return 'At least one active administrator is required'
  }
  return null
}
