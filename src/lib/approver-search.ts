export interface ApproverSearchFields {
  id: string
  name: string
  email: string
  role?: string | null
  level?: number | null
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
    if (user.level != null) {
      parts.push(String(user.level), `Level ${user.level}`)
    }
    return parts.join(' ').toLowerCase().includes(normalizedQuery)
  })
}
