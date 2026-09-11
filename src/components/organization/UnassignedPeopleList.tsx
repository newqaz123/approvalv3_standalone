'use client'

import React from 'react'

export function UnassignedPeopleList({
  users,
  onSelectUser,
}: {
  users: ReadonlyArray<{ id: string; name: string; email: string }>
  onSelectUser?: (userId: string) => void
}) {
  const sorted = users.slice().sort((left, right) => left.name.localeCompare(right.name))
  return (
    <section data-testid="unassigned-people-list" className="space-y-2">
      <h2 className="text-sm font-semibold">Unassigned people</h2>
      {sorted.length === 0 ? (
        <p className="text-sm text-muted-foreground">None</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {sorted.map((user) => (
            <li key={user.id} data-testid={`unassigned-person-${user.id}`}>
              <button
                type="button"
                className="inline-flex items-center rounded-md border px-2 py-0.5 text-sm"
                onClick={() => onSelectUser?.(user.id)}
              >
                {user.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
