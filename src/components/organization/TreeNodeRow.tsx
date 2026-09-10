'use client'

import React from 'react'
import { Badge } from '@/components/ui/badge'
import type { AssignmentNode, OrganizationUnitNode, PositionNode, TeamNode } from '@/lib/organization/model'
import type { WorkspaceSnapshot } from '@/server-actions/organization'

function byName<T extends { name: string }>(left: T, right: T): number {
  return left.name.localeCompare(right.name)
}

/**
 * Person-once: active assignments for a unit keyed by userId.
 * Overseeing multiple teams must not duplicate the person chip — teams nest
 * under this map, they never re-key people.
 */
export function assignmentsByUserId(
  assignments: readonly AssignmentNode[],
  unitId: string,
): Map<string, AssignmentNode> {
  const byUser = new Map<string, AssignmentNode>()
  for (const assignment of assignments) {
    if (!assignment.isActive || assignment.unitId !== unitId) continue
    if (!byUser.has(assignment.userId)) {
      byUser.set(assignment.userId, assignment)
    }
  }
  return byUser
}

function teamsByReportsToAssignmentId(
  teams: readonly TeamNode[],
  unitId: string,
): Map<string, TeamNode[]> {
  const byReportsTo = new Map<string, TeamNode[]>()
  for (const unitTeam of teams) {
    if (!unitTeam.isActive || unitTeam.unitId !== unitId) continue
    const list = byReportsTo.get(unitTeam.reportsToAssignmentId) ?? []
    list.push(unitTeam)
    byReportsTo.set(unitTeam.reportsToAssignmentId, list)
  }
  for (const list of byReportsTo.values()) {
    list.sort(byName)
  }
  return byReportsTo
}

function indexById<T extends { id: string }>(rows: readonly T[]): Map<string, T> {
  const byId = new Map<string, T>()
  for (const row of rows) {
    byId.set(row.id, row)
  }
  return byId
}

function personLabel(
  assignment: AssignmentNode,
  usersById: Map<string, WorkspaceSnapshot['users'][number]>,
  positionsById: Map<string, PositionNode>,
): string | null {
  const user = usersById.get(assignment.userId)
  const position = positionsById.get(assignment.positionId)
  if (!user || !position) return null
  return `${user.name} — ${position.name}`
}

function TeamGroup({
  team,
  assignments,
  usersById,
  positionsById,
}: {
  team: TeamNode
  assignments: readonly AssignmentNode[]
  usersById: Map<string, WorkspaceSnapshot['users'][number]>
  positionsById: Map<string, PositionNode>
}) {
  const members = assignments
    .filter((assignment) => assignment.isActive && assignment.teamId === team.id)
    .slice()
    .sort((left, right) => {
      const leftName = usersById.get(left.userId)?.name ?? ''
      const rightName = usersById.get(right.userId)?.name ?? ''
      return leftName.localeCompare(rightName)
    })

  return (
    <div data-testid={`team-group-${team.id}`} className="ml-4 space-y-1 border-l pl-3">
      <div className="text-sm font-medium text-muted-foreground">{team.name}</div>
      <div className="flex flex-wrap gap-1">
        {members.map((assignment) => {
          const label = personLabel(assignment, usersById, positionsById)
          if (!label) return null
          return (
            <span
              key={assignment.id}
              data-testid={`team-member-${assignment.userId}`}
              className="inline-flex items-center rounded-md border bg-background px-2 py-0.5 text-xs"
            >
              {label}
            </span>
          )
        })}
      </div>
    </div>
  )
}

export function TreeNodeRow({
  unit,
  snapshot,
  childrenByParentId,
}: {
  unit: OrganizationUnitNode
  snapshot: WorkspaceSnapshot
  childrenByParentId: Map<string, OrganizationUnitNode[]>
}) {
  const usersById = indexById(snapshot.users)
  const positionsById = indexById(snapshot.positions)
  const people = assignmentsByUserId(snapshot.assignments, unit.id)
  const teamsByReportsTo = teamsByReportsToAssignmentId(snapshot.teams, unit.id)
  const peopleList = [...people.values()].sort((left, right) => {
    const leftName = usersById.get(left.userId)?.name ?? ''
    const rightName = usersById.get(right.userId)?.name ?? ''
    return leftName.localeCompare(rightName)
  })
  const childUnits = (childrenByParentId.get(unit.id) ?? [])
    .filter((child) => child.isActive)
    .slice()
    .sort(byName)

  return (
    <div data-testid={`unit-row-${unit.id}`} className="space-y-2">
      <div data-testid={`unit-header-${unit.id}`} className="flex flex-wrap items-center gap-2">
        <span data-testid={`unit-name-${unit.id}`} className="font-medium">
          {unit.name}
        </span>
        {unit.shareRequests ? (
          <Badge variant="secondary" data-testid={`sharing-badge-${unit.id}`}>
            Request sharing
          </Badge>
        ) : null}
      </div>
      <div data-testid={`unit-people-${unit.id}`} className="space-y-2 pl-4">
        {peopleList.map((assignment) => {
          const label = personLabel(assignment, usersById, positionsById)
          if (!label) return null
          const nestedTeams = teamsByReportsTo.get(assignment.id) ?? []
          return (
            <div key={assignment.userId} data-testid={`person-chip-${assignment.userId}`} className="space-y-1">
              <span className="inline-flex items-center rounded-md border bg-secondary px-2 py-0.5 text-sm">
                {label}
              </span>
              {nestedTeams.map((team) => (
                <TeamGroup
                  key={team.id}
                  team={team}
                  assignments={snapshot.assignments}
                  usersById={usersById}
                  positionsById={positionsById}
                />
              ))}
            </div>
          )
        })}
      </div>
      <div data-testid={`unit-children-${unit.id}`} className="space-y-3 border-l pl-4">
        {childUnits.map((child) => (
          <TreeNodeRow
            key={child.id}
            unit={child}
            snapshot={snapshot}
            childrenByParentId={childrenByParentId}
          />
        ))}
      </div>
    </div>
  )
}
