'use client'

import React, { useRef, useState } from 'react'
import { ChevronDown, MoreHorizontal, Share2, Wrench } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { InlineNameEdit } from '@/components/organization/InlineNameEdit'
import type { AssignmentNode, OrganizationUnitNode, PositionNode, TeamNode } from '@/lib/organization/model'
import { renameOrganizationUnit, renameTeam, type WorkspaceSnapshot } from '@/server-actions/organization'

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

/**
 * Enabled-flag-only tree icon (formerly text badges). Compact sharing/wrench
 * glyph with an accessible name and a hover/focus tooltip; focusable so the
 * tooltip also opens on keyboard focus. The full settings labels and their
 * business semantics stay in UnitSidePanel — the tree shows the flag only.
 */
function UnitFlagIcon({ testId, label, children }: {
  testId: string
  label: string
  children: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          data-testid={testId}
          role="img"
          aria-label={label}
          tabIndex={0}
          className="inline-flex h-6 w-6 min-h-6 min-w-6 items-center justify-center rounded-md border bg-secondary text-secondary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
        >
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent className="text-xs">{label}</TooltipContent>
    </Tooltip>
  )
}

/**
 * Branch expand/collapse chevron. Units only: people/team reporting stays
 * always visible under its unit — the chevron toggles unit-branch content
 * (this unit's people + descendant units), never anyone else's. Accessible
 * name plus aria-expanded so screen readers announce the state change.
 */
function UnitBranchToggle({ unit, expanded, onToggle }: {
  unit: OrganizationUnitNode
  expanded: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      data-testid={`unit-toggle-${unit.id}`}
      aria-expanded={expanded}
      aria-label={expanded ? `Collapse ${unit.name}` : `Expand ${unit.name}`}
      onClick={(event) => {
        event.stopPropagation()
        onToggle()
      }}
      className="inline-flex h-6 w-6 min-h-6 min-w-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ChevronDown
        aria-hidden="true"
        className={`h-4 w-4 transition-transform duration-150 ${expanded ? '' : '-rotate-90'}`}
      />
    </button>
  )
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
  onSelectTeam,
}: {
  team: TeamNode
  assignments: readonly AssignmentNode[]
  usersById: Map<string, WorkspaceSnapshot['users'][number]>
  positionsById: Map<string, PositionNode>
  onSelectTeam?: (teamId: string) => void
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
      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <InlineNameEdit
          value={team.name}
          onSave={async (next) => {
            await renameTeam({ id: team.id, name: next })
          }}
        />
        {onSelectTeam ? (
          <button
            type="button"
            data-testid={`team-select-${team.id}`}
            className="text-xs underline"
            onClick={(event) => {
              event.stopPropagation()
              onSelectTeam(team.id)
            }}
          >
            Manage
          </button>
        ) : null}
      </div>
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
  onSelectUnit,
  onSelectPerson,
  onSelectTeam,
}: {
  unit: OrganizationUnitNode
  snapshot: WorkspaceSnapshot
  childrenByParentId: Map<string, OrganizationUnitNode[]>
  onSelectUnit?: (unitId: string) => void
  onSelectPerson?: (assignmentId: string) => void
  onSelectTeam?: (teamId: string) => void
}) {
  const nameRef = useRef<HTMLSpanElement>(null)
  // Default expanded preserves the pre-existing behavior: every active row
  // renders until the reader collapses a branch.
  const [expanded, setExpanded] = useState(true)
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
  // The chevron only exists where it collapses something: descendant units
  // or this unit's own people (teams nest under people, so people imply them).
  const hasBranchContent = childUnits.length > 0 || peopleList.length > 0

  function startRename() {
    const pencil = nameRef.current?.querySelector('[data-testid="inline-name-edit-pencil"]')
    if (pencil instanceof HTMLElement) pencil.click()
  }

  return (
    <div data-testid={`unit-row-${unit.id}`} className="space-y-2">
      <div
        data-testid={`unit-header-${unit.id}`}
        className="group relative flex cursor-pointer flex-wrap items-center gap-2 rounded-md bg-muted/60 px-2.5 py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
        tabIndex={0}
        onClick={() => onSelectUnit?.(unit.id)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            if (event.target === event.currentTarget) {
              event.preventDefault()
              onSelectUnit?.(unit.id)
            }
          }
        }}
      >
        {hasBranchContent ? (
          <UnitBranchToggle unit={unit} expanded={expanded} onToggle={() => setExpanded((value) => !value)} />
        ) : (
          <span aria-hidden="true" className="inline-block h-6 w-6 shrink-0" />
        )}
        <span
          ref={nameRef}
          data-testid={`unit-name-${unit.id}`}
          className="font-medium [&_[data-testid=inline-name-edit-pencil]]:hidden"
        >
          <InlineNameEdit
            value={unit.name}
            onSave={async (next) => {
              await renameOrganizationUnit({ id: unit.id, name: next })
            }}
          />
        </span>
        {unit.shareRequests || unit.canWorkOnSolutions ? (
          <TooltipProvider delayDuration={200}>
            {unit.shareRequests ? (
              <UnitFlagIcon testId={`sharing-badge-${unit.id}`} label="Request sharing">
                <Share2 className="h-3.5 w-3.5" aria-hidden="true" />
              </UnitFlagIcon>
            ) : null}
            {unit.canWorkOnSolutions ? (
              <UnitFlagIcon testId={`solutions-badge-${unit.id}`} label="Can work on solutions">
                <Wrench className="h-3.5 w-3.5" aria-hidden="true" />
              </UnitFlagIcon>
            ) : null}
          </TooltipProvider>
        ) : null}
        <div
          data-testid={`unit-hover-actions-${unit.id}`}
          className="invisible absolute inset-y-0 right-1 flex items-center gap-1 rounded-md bg-muted px-1 opacity-0 transition-opacity duration-150 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100 max-md:!invisible pointer-coarse:!invisible"
        >
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-testid={`unit-rename-${unit.id}`}
            onClick={startRename}
          >
            Rename
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-testid={`unit-manage-${unit.id}`}
            onClick={() => onSelectUnit?.(unit.id)}
          >
            Manage
          </Button>
        </div>
        <div className="flex md:hidden pointer-coarse:!flex">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 min-h-8 min-w-8"
                data-testid={`unit-overflow-${unit.id}`}
                aria-label="Open unit actions"
              >
                <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={startRename}>Rename</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onSelectUnit?.(unit.id)}>Manage</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {expanded ? (
        <div data-testid={`unit-people-${unit.id}`} className="space-y-2 pl-6 md:pl-8">
          {peopleList.map((assignment) => {
            const label = personLabel(assignment, usersById, positionsById)
            if (!label) return null
            const nestedTeams = teamsByReportsTo.get(assignment.id) ?? []
            return (
              <div key={assignment.userId} data-testid={`person-chip-${assignment.userId}`} className="space-y-1">
                <button
                  type="button"
                  className="inline-flex items-center rounded-md border bg-secondary px-2 py-0.5 text-sm"
                  onClick={(event) => {
                    event.stopPropagation()
                    onSelectPerson?.(assignment.id)
                  }}
                >
                  {label}
                </button>
                {nestedTeams.map((team) => (
                  <TeamGroup
                    key={team.id}
                    team={team}
                    assignments={snapshot.assignments}
                    usersById={usersById}
                    positionsById={positionsById}
                    onSelectTeam={onSelectTeam}
                  />
                ))}
              </div>
            )
          })}
        </div>
      ) : null}
      {expanded ? (
        <div
          data-testid={`unit-children-${unit.id}`}
          className="space-y-5 border-l-2 border-border pl-6 md:pl-8"
        >
          {childUnits.map((child) => (
            <div key={child.id} className="relative">
              {/* Elbow connector: horizontal tick from the ancestry rail to the child branch. */}
              <span
                aria-hidden="true"
                data-testid={`unit-connector-${child.id}`}
                className="pointer-events-none absolute -left-6 top-[17px] h-px w-5 bg-border md:-left-8 md:w-7"
              />
              <TreeNodeRow
                unit={child}
                snapshot={snapshot}
                childrenByParentId={childrenByParentId}
                onSelectUnit={onSelectUnit}
                onSelectPerson={onSelectPerson}
                onSelectTeam={onSelectTeam}
              />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
