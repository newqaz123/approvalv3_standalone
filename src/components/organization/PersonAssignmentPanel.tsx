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
import { personShortName } from '@/lib/organization/person-name'
import {
  assignPerson,
  moveAssignment,
  removeAssignment,
  type WorkspaceSnapshot,
} from '@/server-actions/organization'
import { UnitTreeSelect } from '@/components/organization/UnitTreeSelect'
import { useTranslations } from '@/lib/i18n/client'

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

function teamReportsToValidAgainstProposed(
  team: TeamNode,
  assignments: readonly AssignmentNode[],
  positionById: Map<string, { rank: number }>,
): boolean {
  const reportsTo = assignments.find((row) => row.id === team.reportsToAssignmentId)
  if (reportsTo === undefined || !reportsTo.isActive) return false
  if (reportsTo.unitId !== team.unitId) return false
  if (reportsTo.teamId === team.id) return false
  const reportsToRank = positionById.get(reportsTo.positionId)?.rank
  if (reportsToRank === undefined) return false
  for (const member of assignments) {
    if (!member.isActive || member.teamId !== team.id) continue
    const memberRank = positionById.get(member.positionId)?.rank
    if (memberRank === undefined || reportsToRank <= memberRank) return false
  }
  return true
}

export function reportsToTeamsInvalidatedByMove(
  assignment: AssignmentNode,
  next: { unitId: string; positionId: string; teamId: string | null },
  snapshot: WorkspaceSnapshot,
): TeamNode[] {
  const positionById = new Map(snapshot.positions.map((row) => [row.id, row]))
  const proposedAssignments = snapshot.assignments.map((row) => (
    row.id === assignment.id
      ? { ...row, unitId: next.unitId, positionId: next.positionId, teamId: next.teamId }
      : row
  ))
  const invalidated: TeamNode[] = []
  for (const team of snapshot.teams) {
    if (!team.isActive) continue
    const affectedMembership =
      team.reportsToAssignmentId === assignment.id
      || assignment.teamId === team.id
      || next.teamId === team.id
    if (!affectedMembership) continue
    if (!teamReportsToValidAgainstProposed(team, proposedAssignments, positionById)) {
      invalidated.push(team)
    }
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
  const t = useTranslations()
  return (
    <div data-testid="assignment-move-confirmation" className="space-y-3 rounded-md border p-3">
      <div className="grid grid-cols-2 gap-3">
        <section data-testid="assignment-change-before" className="space-y-1">
          <h3 className="text-sm font-medium">{t('admin.current')}</h3>
          <p className="text-sm">{t('admin.unitLabel')} {before.unitName}</p>
          <p className="text-sm">{t('admin.positionLabel')} {before.positionName}</p>
          <p className="text-sm">{t('admin.teamLabel')} {before.teamName}</p>
        </section>
        <section data-testid="assignment-change-after" className="space-y-1">
          <h3 className="text-sm font-medium">{t('admin.new')}</h3>
          <p className="text-sm">{t('admin.unitLabel')} {after.unitName}</p>
          <p className="text-sm">{t('admin.positionLabel')} {after.positionName}</p>
          <p className="text-sm">{t('admin.teamLabel')} {after.teamName}</p>
        </section>
      </div>
      {invalidatedTeams.length > 0 ? (
        <div data-testid="assignment-reports-to-correction" className="space-y-2">
          <p className="text-sm">
            {t('admin.correctReportsTo')}
          </p>
          <ul className="list-disc space-y-1 pl-4 text-sm">
            {invalidatedTeams.map((team) => (
              <li key={team.id}>{team.name}</li>
            ))}
          </ul>
          {reportsToCorrection ? <p className="text-sm">{t('admin.reportsToLabel')} {reportsToCorrection}</p> : null}
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
  const t = useTranslations()
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
      setError(t('admin.assignmentSaveFailed'))
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
      setError(t('admin.assignmentSaveFailed'))
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
      setError(t('admin.assignmentRemoveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const beforeLabels = assignment
    ? {
        unitName: nameOf(assignment.unitId, snapshot.units, assignment.unitId),
        positionName: nameOf(assignment.positionId, snapshot.positions, assignment.positionId),
        teamName: nameOf(assignment.teamId, snapshot.teams, t('admin.none')),
      }
    : null
  const afterLabels = {
    unitName: nameOf(unitId, snapshot.units, unitId || t('admin.none')),
    positionName: nameOf(positionId, snapshot.positions, positionId || t('admin.none')),
    teamName: nameOf(teamId, snapshot.teams, t('admin.none')),
  }

  return (
    <aside
      data-testid="person-assignment-panel"
      className="max-h-[calc(100vh-2rem)] w-full shrink-0 space-y-6 overflow-y-auto overscroll-contain rounded-lg border bg-card p-4 lg:sticky lg:top-4"
    >
      {/* Heading split (owner-approved): the TITLE is the person short name
          (never the stored "Name — Unit" qualifier string) and the unit vs
          position summary sits in SEPARATE labeled lines bound to the current
          select state — not one combined gray "Name — Unit" string. */}
      <div>
        <h2 className="text-lg font-semibold" data-testid="assignment-panel-title">
          {assignment ? personShortName(user.name) : t('admin.assignPerson')}
        </h2>
        {assignment ? (
          <div className="space-y-0.5 text-sm text-muted-foreground">
            <p data-testid="assignment-subtitle-unit">
              <span className="font-medium text-foreground">{t('admin.unitLabel')}</span>{' '}
              {nameOf(unitId, snapshot.units, unitId || t('admin.none'))}
            </p>
            <p data-testid="assignment-subtitle-position">
              <span className="font-medium text-foreground">{t('admin.positionLabel')}</span>{' '}
              {nameOf(positionId, snapshot.positions, positionId || t('admin.none'))}
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{personShortName(user.name)}</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="assignment-unit-select">{t('admin.unit')}</Label>
        {/* Searchable, depth-indented tree-path dropdown (owner-approved):
            options show "Factory › Production Division › Engineering
            Department" indented by depth and match on any ancestor name. */}
        <UnitTreeSelect
          units={activeUnits}
          value={unitId || null}
          onChange={handleUnitChange}
          triggerId="assignment-unit-select"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="assignment-position-select">{t('admin.position')}</Label>
        <Select
          value={positionId || undefined}
          onValueChange={(value) => {
            setPositionId(value)
            setConfirming(false)
          }}
        >
          <SelectTrigger id="assignment-position-select" data-testid="assignment-position-select">
            <SelectValue placeholder={t('admin.selectPosition')} />
          </SelectTrigger>
          <SelectContent>
            {activePositions.map((row) => (
              <SelectItem key={row.id} value={row.id}>{row.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="assignment-team-select">{t('admin.team')}</Label>
        <Select
          value={teamReselectRequired ? undefined : (teamId ?? NONE_TEAM)}
          onValueChange={(value) => {
            setTeamId(value === NONE_TEAM ? null : value)
            setTeamReselectRequired(false)
            setConfirming(false)
          }}
        >
          <SelectTrigger id="assignment-team-select" data-testid="assignment-team-select">
            <SelectValue placeholder={teamReselectRequired ? t('admin.selectTeam') : t('admin.noTeam')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE_TEAM}>{t('admin.noTeam')}</SelectItem>
            {teamsInUnit.map((row) => (
              <SelectItem key={row.id} value={row.id}>{row.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {teamReselectRequired ? (
          <p className="text-sm text-destructive">{t('admin.selectTeamForUnit')}</p>
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
                {t('admin.reportsToFor', { name: team.name })}
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
                  <SelectValue placeholder={t('admin.chooseReportsTo')} />
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
                {t('admin.confirmMove')}
              </Button>
              <Button
                type="button"
                variant="outline"
                data-testid="assignment-move-cancel"
                onClick={() => setConfirming(false)}
                disabled={saving}
              >
                {t('common.cancel')}
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
                {t('admin.save')}
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
                {t('admin.removeAssignment')}
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
            {t('admin.assign')}
          </Button>
        )}
      </div>
    </aside>
  )
}
