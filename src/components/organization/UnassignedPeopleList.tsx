'use client'

import React from 'react'
import { personInitials, personShortName } from '@/lib/organization/person-name'

export function UnassignedPeopleList({
  users,
  onSelectUser,
}: {
  users: ReadonlyArray<{ id: string; name: string; email: string }>
  onSelectUser?: (userId: string) => void
}) {
  const sorted = users.slice().sort((left, right) => left.name.localeCompare(right.name))
  return (
    <section
      data-testid="unassigned-people-list"
      className="organization-unassigned-dock space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-800">Unassigned people</h2>
        <span className="text-xs text-muted-foreground">Available to place</span>
      </div>
      {sorted.length === 0 ? (
        <p className="text-sm text-muted-foreground">None</p>
      ) : (
        <ul className="organization-unassigned-dock-list flex min-w-0 flex-wrap items-center gap-2">
          {sorted.map((user) => (
            <li
              key={user.id}
              data-testid={`unassigned-person-${user.id}`}
              className="min-w-0 max-w-full shrink-0"
            >
              <button
                type="button"
                title={user.name}
                className="inline-flex min-h-10 max-w-full items-center gap-2 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-sm shadow-sm transition-colors hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => onSelectUser?.(user.id)}
              >
                <span
                  data-testid={`unassigned-avatar-${user.id}`}
                  aria-hidden="true"
                  className="organization-initials-avatar inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold tracking-wide text-slate-700 ring-1 ring-slate-200"
                >
                  {personInitials(user.name)}
                </span>
                <span className="min-w-0 max-w-full truncate whitespace-nowrap">
                  {personShortName(user.name)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
