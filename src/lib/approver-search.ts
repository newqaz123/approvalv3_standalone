export interface ApproverSearchFields {
  id: string
  name: string
  email: string
  role?: string | null
  unitPathNames?: readonly string[] | null
}

export function filterApproversByQuery<T extends ApproverSearchFields>(
  users: readonly T[],
  query: string
): T[] {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) {
    return [...users]
  }

  return users.filter((user) => {
    const parts = [user.name, user.email]
    if (user.role) {
      parts.push(user.role)
    }
    if (user.unitPathNames && user.unitPathNames.length > 0) {
      parts.push(...user.unitPathNames)
    }
    return parts.join(' ').toLowerCase().includes(normalizedQuery)
  })
}
