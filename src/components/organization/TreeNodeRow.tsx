'use client'

import React, { useRef, useState } from 'react'
import { Building2, ChevronDown, MoreHorizontal, Share2, Wrench } from 'lucide-react'
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

/** The compact avatar language is shared by managers and unassigned people. */
export function personInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '??'
  return words
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('')
}

function PersonInitials({ name, testId }: { name: string; testId: string }) {
  return (
    <span
      data-testid={testId}
      aria-hidden="true"
      className="organization-initials-avatar inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold tracking-wide text-slate-700 ring-1 ring-slate-200"
    >
      {personInitials(name)}
    </span>
  )
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
 * Resolve the single manager row used by the card. The persisted unit manager
 * is authoritative; the position-name fallback keeps older snapshots readable
 * while they are being normalized by the live-data cleanup stream.
 */
function managerAssignmentForUnit(
  unit: OrganizationUnitNode,
  people: Map<string, AssignmentNode>,
  positionsById: Map<string, PositionNode>,
  usersById: Map<string, WorkspaceSnapshot['users'][number]>,
): AssignmentNode | null {
  if (unit.managerUserId !== null) {
    const explicit = people.get(unit.managerUserId)
    if (explicit !== undefined) return explicit
  }
  const candidates = [...people.values()]
    .filter((assignment) => positionsById.get(assignment.positionId)?.name.toLowerCase().includes('manager'))
    .sort((left, right) => {
      const leftRank = positionsById.get(left.positionId)?.rank ?? 0
      const rightRank = positionsById.get(right.positionId)?.rank ?? 0
      return rightRank - leftRank
        || (usersById.get(left.userId)?.name ?? '').localeCompare(usersById.get(right.userId)?.name ?? '')
    })
  return candidates[0] ?? null
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
      className="inline-flex h-8 w-8 min-h-8 min-w-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
    <div data-testid={`team-group-${team.id}`} className="organization-team-group ml-4 space-y-2 border-l border-slate-200 pl-3">
      <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-muted-foreground">
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
            className="text-xs underline underline-offset-2"
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
              className="inline-flex max-w-full items-center rounded-md border bg-background px-2 py-0.5 text-xs"
            >
              {label}
            </span>
          )
        })}
      </div>
    </div>
  )
}

function PersonChip({
  assignment,
  manager,
  nestedTeams,
  assignments,
  usersById,
  positionsById,
  onSelectPerson,
  onSelectTeam,
}: {
  assignment: AssignmentNode
  manager: boolean
  nestedTeams: readonly TeamNode[]
  assignments: readonly AssignmentNode[]
  usersById: Map<string, WorkspaceSnapshot['users'][number]>
  positionsById: Map<string, PositionNode>
  onSelectPerson?: (assignmentId: string) => void
  onSelectTeam?: (teamId: string) => void
}) {
  const user = usersById.get(assignment.userId)
  const label = personLabel(assignment, usersById, positionsById)
  if (!user || !label) return null
  return (
    <div
      data-testid={`person-chip-${assignment.userId}`}
      className={`${manager ? 'organization-manager-person' : 'organization-staff-person'} min-w-0 space-y-2`}
    >
      <button
        type="button"
        className={`inline-flex max-w-full items-center gap-2 rounded-lg border border-slate-200 bg-secondary text-left text-sm shadow-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${manager ? 'min-h-10 px-2.5 py-1.5' : 'min-h-8 px-2 py-1'}`}
        onClick={(event) => {
          event.stopPropagation()
          onSelectPerson?.(assignment.id)
        }}
      >
        <PersonInitials
          name={user.name}
          testId={`${manager ? 'manager-avatar' : 'person-avatar'}-${user.id}`}
        />
        <span className="min-w-0 truncate">{label}</span>
      </button>
      {nestedTeams.map((team) => (
        <TeamGroup
          key={team.id}
          team={team}
          assignments={assignments}
          usersById={usersById}
          positionsById={positionsById}
          onSelectTeam={onSelectTeam}
        />
      ))}
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
  const managerAssignment = managerAssignmentForUnit(unit, people, positionsById, usersById)
  const staffList = peopleList.filter((assignment) => assignment.id !== managerAssignment?.id)
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
    <div data-testid={`unit-row-${unit.id}`} className="organization-unit-node space-y-2">
      <article
        data-testid={`unit-card-${unit.id}`}
        className="organization-unit-card w-full rounded-xl border border-slate-200 bg-white shadow-sm"
      >
        <div
          data-testid={`unit-header-${unit.id}`}
          className="group flex cursor-pointer flex-wrap items-center gap-2 rounded-t-xl bg-muted/60 px-3 py-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
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
            <span aria-hidden="true" className="inline-block h-8 w-8 shrink-0" />
          )}
          <span
            data-testid={`unit-icon-${unit.id}`}
            aria-hidden="true"
            className="organization-unit-icon inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-white text-slate-500 ring-1 ring-slate-200"
          >
            <Building2 className="h-4 w-4" />
          </span>
          <span
            ref={nameRef}
            data-testid={`unit-name-${unit.id}`}
            className="min-w-0 flex-1 font-medium break-words [&_[data-testid=inline-name-edit]]:min-w-0 [&_[data-testid=inline-name-edit-pencil]]:hidden"
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
          {/* Permanently reserved in-flow action area (md+ fine pointer): the
              strip always owns this space, so revealing it via
              visibility/opacity can never shift geometry. */}
          <div
            data-testid={`unit-hover-actions-${unit.id}`}
            className="invisible flex shrink-0 items-center gap-1 rounded-md bg-muted px-1 opacity-0 transition-opacity duration-150 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100 max-md:!hidden pointer-coarse:!hidden"
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
          <div className="flex shrink-0 md:hidden pointer-coarse:!flex">
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

        {/* Manager and staff remain mounted during collapse so a queued rename
            can settle after an in-flight save. Teams stay under their
            reports-to person and never become unit cards. */}
        <div
          data-testid={`unit-people-${unit.id}`}
          hidden={!expanded}
          className="organization-unit-people space-y-3 px-3 pb-3 pt-3"
        >
          {managerAssignment ? (
            <div data-testid={`unit-manager-${unit.id}`} className="organization-manager-row space-y-1.5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Manager</p>
              <PersonChip
                assignment={managerAssignment}
                manager
                nestedTeams={teamsByReportsTo.get(managerAssignment.id) ?? []}
                assignments={snapshot.assignments}
                usersById={usersById}
                positionsById={positionsById}
                onSelectPerson={onSelectPerson}
                onSelectTeam={onSelectTeam}
              />
            </div>
          ) : null}
          {staffList.length > 0 ? (
            <div className="organization-staff-list flex flex-col items-stretch gap-1">
              {staffList.map((assignment) => (
                <PersonChip
                  key={assignment.userId}
                  assignment={assignment}
                  manager={false}
                  nestedTeams={teamsByReportsTo.get(assignment.id) ?? []}
                  assignments={snapshot.assignments}
                  usersById={usersById}
                  positionsById={positionsById}
                  onSelectPerson={onSelectPerson}
                  onSelectTeam={onSelectTeam}
                />
              ))}
            </div>
          ) : null}
          {peopleList.length > 0 ? (
            <p data-testid={`unit-staff-count-${unit.id}`} className="text-xs text-muted-foreground">
              {`${peopleList.length} ${peopleList.length === 1 ? 'person' : 'people'}`}
            </p>
          ) : null}
        </div>
      </article>

      {/* Collapsed branch content stays MOUNTED behind the hidden attribute:
          unmounting would tear down editors and cancel a queued follow-up
          rename. The children are a responsive flowchart group: siblings use
          a row when there is room and wrap into additional rows on narrow
          surfaces. */}
      <div
        data-testid={`unit-children-${unit.id}`}
        hidden={!expanded}
        className="organization-unit-children flex flex-wrap space-y-5 border-l-2 border-transparent pl-6 md:pl-8"
      >
        {childUnits.map((child) => (
          <div key={child.id} className="organization-unit-child relative">
            {/* The connector span retains the stable test seam while CSS turns
                it into a slate vertical/horizontal flowchart connector. */}
            <span
              aria-hidden="true"
              data-testid={`unit-connector-${child.id}`}
              className="organization-flowchart-connector pointer-events-none absolute -left-6 top-[17px] h-px w-5 bg-border md:-left-8 md:w-7"
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
    </div>
  )
}
