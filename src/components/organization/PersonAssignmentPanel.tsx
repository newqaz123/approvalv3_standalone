'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { AssignmentNode, TeamNode } from '@/lib/organization/model'
import {
  assignPerson,
  moveAssignment,
  removeAssignment,
  type WorkspaceSnapshot,
} from '@/server-actions/organization'

export const NONE_TEAM = 'none'

export function teamBelongsToUnit(
  teamId: string | null,
  unitId: string,
  teams: readonly TeamNode[],
): boolean {
  if (teamId === null) return true
  const team = teams.find((row) => row.id === teamId && row.isActive)
  return team !== undefined && team.unitId === unitId
}

export function reportsToTeamsInvalidatedByMove(
  assignment: AssignmentNode,
  next: { unitId: string; positionId: string; teamId: string | null },
  snapshot: WorkspaceSnapshot,
): TeamNode[] {
  const positionById = new Map(snapshot.positions.map((row) => [row.id, row]))
  const nextRank = positionById.get(next.positionId)?.rank
  const invalidated: TeamNode[] = []
  for (const team of snapshot.teams) {
    if (!team.isActive || team.reportsToAssignmentId !== assignment.id) continue
    if (next.unitId !== team.unitId || next.teamId === team.id) {
      invalidated.push(team)
      continue
    }
    if (nextRank === undefined) {
      invalidated.push(team)
      continue
    }
    let rankOk = true
    for (const member of snapshot.assignments) {
      if (!member.isActive || member.teamId !== team.id) continue
      const memberRank = positionById.get(member.positionId)?.rank
      if (memberRank === undefined || nextRank <= memberRank) {
        rankOk = false
        break
      }
    }
    if (!rankOk) invalidated.push(team)
  }
  return invalidated
}

export function AssignmentChangeSummary({
  before,
  after,
  invalidatedTeams = [],
  reportsToCorrection = undefined,
  children,
}: {
  before: { unitName: string; positionName: string; teamName: string }
  after: { unitName: string; positionName: string; teamName: string }
  invalidatedTeams?: ReadonlyArray<{ id: string; name: string }>
  reportsToCorrection?: string | null
  children?: React.ReactNode
}) {
  return (
    <div data-testid="assignment-move-confirmation" className="space-y-3 rounded-md border p-3">
      <div className="grid grid-cols-2 gap-3">
        <section data-testid="assignment-change-before" className="space-y-1">
          <h3 className="text-sm font-medium">Current</h3>
          <p className="text-sm">Unit: {before.unitName}</p>
          <p className="text-sm">Position: {before.positionName}</p>
          <p className="text-sm">Team: {before.teamName}</p>
        </section>
        <section data-testid="assignment-change-after" className="space-y-1">
          <h3 className="text-sm font-medium">New</h3>
          <p className="text-sm">Unit: {after.unitName}</p>
          <p className="text-sm">Position: {after.positionName}</p>
          <p className="text-sm">Team: {after.teamName}</p>
        </section>
      </div>
      {invalidatedTeams.length > 0 ? (
        <div data-testid="assignment-reports-to-correction" className="space-y-2">
          <p className="text-sm">
            This change requires explicit correction of the team&apos;s reports-to person.
          </p>
          <ul className="list-disc space-y-1 pl-4 text-sm">
            {invalidatedTeams.map((team) => (
              <li key={team.id}>{team.name}</li>
            ))}
          </ul>
          {reportsToCorrection ? <p className="text-sm">Reports-to: {reportsToCorrection}</p> : null}
          {children}
        </div>
      ) : null}
    </div>
  )
}

function nameOf(
  id: string | null,
  rows: ReadonlyArray<{ id: string; name: string }>,
  fallback: string,
): string {
  if (id === null) return fallback
  return rows.find((row) => row.id === id)?.name ?? fallback
}

export function PersonAssignmentPanel({
  snapshot,
  assignmentId = null,
  userId = null,
  onAssigned,
  onMoved,
  onRemoved,
}: {
  snapshot: WorkspaceSnapshot
  assignmentId?: string | null
  userId?: string | null
  onAssigned?: (row: AssignmentNode) => void
  onMoved?: (patch: {
    assignmentId: string
    unitId: string
    positionId: string
    teamId: string | null
    teamReportsToCorrections: ReadonlyArray<{ teamId: string; reportsToAssignmentId: string }>
  }) => void
  onRemoved?: (input: { assignmentId: string; userId: string }) => void
}) {
  const assignment = snapshot.assignments.find((row) => row.id === assignmentId) ?? null
  const user = snapshot.users.find((row) => row.id === (assignment?.userId ?? userId)) ?? null
  const [unitId, setUnitId] = useState(assignment?.unitId ?? '')
  const [positionId, setPositionId] = useState(assignment?.positionId ?? '')
  const [teamId, setTeamId] = useState<string | null>(assignment?.teamId ?? null)
  const [teamReselectRequired, setTeamReselectRequired] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [reportsToByTeam, setReportsToByTeam] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setUnitId(assignment?.unitId ?? '')
    setPositionId(assignment?.positionId ?? '')
    setTeamId(assignment?.teamId ?? null)
    setTeamReselectRequired(false)
    setConfirming(false)
    setReportsToByTeam({})
    setError(null)
  }, [assignment?.id, assignment?.unitId, assignment?.positionId, assignment?.teamId, userId])

  const activeUnits = snapshot.units.filter((row) => row.isActive)
  const activePositions = snapshot.positions.filter((row) => row.isActive)
  const teamsInUnit = snapshot.teams.filter((row) => row.isActive && row.unitId === unitId)

  const next = useMemo(
    () => ({ unitId, positionId, teamId }),
    [unitId, positionId, teamId],
  )
  const invalidated = assignment
    ? reportsToTeamsInvalidatedByMove(assignment, next, snapshot)
    : []
  const correctionsReady = invalidated.every((team) => Boolean(reportsToByTeam[team.id]))

  if (!user) return null

  function handleUnitChange(nextUnitId: string) {
    setUnitId(nextUnitId)
    setConfirming(false)
    if (!teamBelongsToUnit(teamId, nextUnitId, snapshot.teams)) {
      setTeamId(null)
      setTeamReselectRequired(true)
    }
  }

  async function handleAssign() {
    if (!userId || !unitId || !positionId || teamReselectRequired) return
    setError(null)
    setSaving(true)
    try {
      const result = await assignPerson({
        userId,
        unitId,
        positionId,
        teamId,
      })
      onAssigned?.({
        id: result.assignmentId,
        userId,
        unitId,
        positionId,
        teamId,
        isActive: true,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  async function handleConfirmMove() {
    if (!assignment || teamReselectRequired || !correctionsReady) return
    setError(null)
    setSaving(true)
    try {
      const teamReportsToCorrections = invalidated.map((team) => ({
        teamId: team.id,
        reportsToAssignmentId: reportsToByTeam[team.id],
      }))
      await moveAssignment({
        assignmentId: assignment.id,
        unitId,
        positionId,
        teamId,
        teamReportsToCorrections,
      })
      onMoved?.({
        assignmentId: assignment.id,
        unitId,
        positionId,
        teamId,
        teamReportsToCorrections,
      })
      setConfirming(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  async function handleRemove() {
    if (!assignment) return
    setError(null)
    setSaving(true)
    try {
      await removeAssignment({ assignmentId: assignment.id })
      onRemoved?.({ assignmentId: assignment.id, userId: assignment.userId })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const beforeLabels = assignment
    ? {
        unitName: nameOf(assignment.unitId, snapshot.units, assignment.unitId),
        positionName: nameOf(assignment.positionId, snapshot.positions, assignment.positionId),
        teamName: nameOf(assignment.teamId, snapshot.teams, 'None'),
      }
    : null
  const afterLabels = {
    unitName: nameOf(unitId, snapshot.units, unitId || 'None'),
    positionName: nameOf(positionId, snapshot.positions, positionId || 'None'),
    teamName: nameOf(teamId, snapshot.teams, 'None'),
  }

  return (
    <aside
      data-testid="person-assignment-panel"
      className="w-full shrink-0 space-y-6 rounded-lg border bg-card p-4 lg:w-96"
    >
      <div>
        <h2 className="text-lg font-semibold">{assignment ? 'Manage assignment' : 'Assign person'}</h2>
        <p className="text-sm text-muted-foreground">{user.name}</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="assignment-unit-select">Unit</Label>
        <Select value={unitId || undefined} onValueChange={handleUnitChange}>
          <SelectTrigger id="assignment-unit-select" data-testid="assignment-unit-select">
            <SelectValue placeholder="Select unit" />
          </SelectTrigger>
          <SelectContent>
            {activeUnits.map((row) => (
              <SelectItem key={row.id} value={row.id}>{row.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="assignment-position-select">Position</Label>
        <Select
          value={positionId || undefined}
          onValueChange={(value) => {
            setPositionId(value)
            setConfirming(false)
          }}
        >
          <SelectTrigger id="assignment-position-select" data-testid="assignment-position-select">
            <SelectValue placeholder="Select position" />
          </SelectTrigger>
          <SelectContent>
            {activePositions.map((row) => (
              <SelectItem key={row.id} value={row.id}>{row.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="assignment-team-select">Team</Label>
        <Select
          value={teamReselectRequired ? undefined : (teamId ?? NONE_TEAM)}
          onValueChange={(value) => {
            setTeamId(value === NONE_TEAM ? null : value)
            setTeamReselectRequired(false)
            setConfirming(false)
          }}
        >
          <SelectTrigger id="assignment-team-select" data-testid="assignment-team-select">
            <SelectValue placeholder={teamReselectRequired ? 'Select a team' : 'No team'} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE_TEAM}>No team</SelectItem>
            {teamsInUnit.map((row) => (
              <SelectItem key={row.id} value={row.id}>{row.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {teamReselectRequired ? (
          <p className="text-sm text-destructive">Select a team for the new unit</p>
        ) : null}
      </div>

      {confirming && beforeLabels ? (
        <AssignmentChangeSummary
          before={beforeLabels}
          after={afterLabels}
          invalidatedTeams={invalidated}
        >
          {invalidated.map((team) => (
            <div key={team.id} className="space-y-1">
              <Label htmlFor={`assignment-reports-to-${team.id}`}>
                {`Reports-to for ${team.name}`}
              </Label>
              <Select
                value={reportsToByTeam[team.id]}
                onValueChange={(value) => {
                  setReportsToByTeam((current) => ({ ...current, [team.id]: value }))
                }}
              >
                <SelectTrigger
                  id={`assignment-reports-to-${team.id}`}
                  data-testid={`assignment-reports-to-${team.id}`}
                >
                  <SelectValue placeholder="Choose reports-to" />
                </SelectTrigger>
                <SelectContent>
                  {snapshot.assignments
                    .filter((row) => (
                      row.isActive
                      && row.id !== assignment?.id
                      && row.unitId === team.unitId
                      && row.teamId !== team.id
                    ))
                    .map((row) => {
                      const candidate = snapshot.users.find((entry) => entry.id === row.userId)
                      return (
                        <SelectItem key={row.id} value={row.id}>
                          {candidate?.name ?? row.id}
                        </SelectItem>
                      )
                    })}
                </SelectContent>
              </Select>
            </div>
          ))}
        </AssignmentChangeSummary>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-destructive">{error}</p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {assignment ? (
          confirming ? (
            <>
              <Button
                type="button"
                data-testid="assignment-move-confirm"
                onClick={() => {
                  void handleConfirmMove()
                }}
                disabled={saving || teamReselectRequired || !correctionsReady}
              >
                Confirm move
              </Button>
              <Button
                type="button"
                variant="outline"
                data-testid="assignment-move-cancel"
                onClick={() => setConfirming(false)}
                disabled={saving}
              >
                Cancel
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                data-testid="assignment-save"
                onClick={() => setConfirming(true)}
                disabled={saving || teamReselectRequired || !unitId || !positionId}
              >
                Save
              </Button>
              <Button
                type="button"
                variant="destructive"
                data-testid="assignment-remove"
                onClick={() => {
                  void handleRemove()
                }}
                disabled={saving}
              >
                Remove assignment
              </Button>
            </>
          )
        ) : (
          <Button
            type="button"
            data-testid="assignment-save"
            onClick={() => {
              void handleAssign()
            }}
            disabled={saving || teamReselectRequired || !unitId || !positionId}
          >
            Assign
          </Button>
        )}
      </div>
    </aside>
  )
}
