'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { AssignmentNode } from '@/lib/organization/model'
import {
  createTeam,
  deactivateTeam,
  updateTeam,
  type WorkspaceSnapshot,
} from '@/server-actions/organization'

function assignmentLabel(
  assignment: AssignmentNode,
  snapshot: WorkspaceSnapshot,
): string {
  const user = snapshot.users.find((row) => row.id === assignment.userId)
  const position = snapshot.positions.find((row) => row.id === assignment.positionId)
  if (user && position) return `${user.name} — ${position.name}`
  return user?.name ?? assignment.id
}

/**
 * Danger zone for team deactivation (deactivate-not-delete). Exported for the
 * component harness: the confirmation step and the adjacent guard error are
 * state-driven variants tests render directly (UnitDeactivationSection pattern).
 */
export function TeamDeactivationSection({
  teamName,
  confirming,
  saving,
  error,
  onStart,
  onConfirm,
  onCancel,
}: {
  teamName: string
  confirming: boolean
  saving: boolean
  error: string | null
  onStart: () => void
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div data-testid="team-deactivation-section" className="space-y-2 rounded-md border border-destructive/40 p-3">
      {error ? (
        <p role="alert" data-testid="team-deactivate-error" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {confirming ? (
        <div data-testid="team-deactivate-confirmation" className="space-y-2">
          <p className="text-sm">
            {`Deactivate "${teamName}"? The team disappears from the tree. Members must be moved or removed first; history is preserved and the reports-to person is never reassigned.`}
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="destructive"
              data-testid="team-deactivate-confirm"
              onClick={onConfirm}
              disabled={saving}
            >
              Deactivate team
            </Button>
            <Button
              type="button"
              variant="outline"
              data-testid="team-deactivate-cancel"
              onClick={onCancel}
              disabled={saving}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button
          type="button"
          variant="destructive"
          data-testid="team-deactivate"
          onClick={onStart}
          disabled={saving}
        >
          Deactivate team
        </Button>
      )}
    </div>
  )
}

export function TeamPanel({
  snapshot,
  unitId,
  teamId = null,
  onCreated,
  onUpdated,
  onDeactivated,
}: {
  snapshot: WorkspaceSnapshot
  unitId: string
  teamId?: string | null
  onCreated?: (team: {
    id: string
    unitId: string
    name: string
    reportsToAssignmentId: string
    isActive: boolean
  }, memberAssignmentIds: readonly string[]) => void
  onUpdated?: (patch: {
    id: string
    name: string
    reportsToAssignmentId: string
    memberAssignmentIds: readonly string[]
  }) => void
  onDeactivated?: (teamId: string) => void
}) {
  const team = teamId ? snapshot.teams.find((row) => row.id === teamId) ?? null : null
  const [name, setName] = useState(team?.name ?? '')
  const [reportsToAssignmentId, setReportsToAssignmentId] = useState(team?.reportsToAssignmentId ?? '')
  const [memberIds, setMemberIds] = useState<string[]>(() => (
    team
      ? snapshot.assignments.filter((row) => row.isActive && row.teamId === team.id).map((row) => row.id)
      : []
  ))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirmingDeactivate, setConfirmingDeactivate] = useState(false)
  const [deactivating, setDeactivating] = useState(false)
  const [deactivateError, setDeactivateError] = useState<string | null>(null)

  useEffect(() => {
    const current = teamId ? snapshot.teams.find((row) => row.id === teamId) ?? null : null
    setName(current?.name ?? '')
    setReportsToAssignmentId(current?.reportsToAssignmentId ?? '')
    setMemberIds(
      current
        ? snapshot.assignments.filter((row) => row.isActive && row.teamId === current.id).map((row) => row.id)
        : [],
    )
    setError(null)
    setConfirmingDeactivate(false)
    setDeactivateError(null)
  }, [teamId, unitId, snapshot.teams, snapshot.assignments])

  const unitAssignments = useMemo(
    () => snapshot.assignments.filter((row) => row.isActive && row.unitId === unitId),
    [snapshot.assignments, unitId],
  )

  const reportsToOptions = useMemo(() => {
    const rows = [...unitAssignments]
    if (reportsToAssignmentId && !rows.some((row) => row.id === reportsToAssignmentId)) {
      const current = snapshot.assignments.find((row) => row.id === reportsToAssignmentId)
      if (current) rows.push(current)
    }
    return rows
  }, [unitAssignments, reportsToAssignmentId, snapshot.assignments])

  const memberOptions = unitAssignments.filter((row) => row.id !== reportsToAssignmentId)

  function handleReportsToChange(value: string) {
    setReportsToAssignmentId(value)
    setMemberIds((current) => current.filter((id) => id !== value))
  }

  async function handleConfirmDeactivate() {
    if (!team) return
    setDeactivateError(null)
    setDeactivating(true)
    try {
      await deactivateTeam({ teamId: team.id })
      onDeactivated?.(team.id)
    } catch (err) {
      // Adjacent error with the confirmation step retained (panel error pattern).
      setDeactivateError(err instanceof Error ? err.message : String(err))
    } finally {
      setDeactivating(false)
    }
  }

  async function handleSave() {
    if (!name.trim() || !reportsToAssignmentId) return
    setError(null)
    setSaving(true)
    try {
      if (team) {
        await updateTeam({
          id: team.id,
          name,
          reportsToAssignmentId,
          memberAssignmentIds: memberIds,
        })
        onUpdated?.({
          id: team.id,
          name: name.trim(),
          reportsToAssignmentId,
          memberAssignmentIds: memberIds,
        })
      } else {
        const result = await createTeam({
          unitId,
          name,
          reportsToAssignmentId,
          memberAssignmentIds: memberIds,
        })
        onCreated?.({
          id: result.teamId,
          unitId,
          name: name.trim(),
          reportsToAssignmentId,
          isActive: true,
        }, memberIds)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <aside
      data-testid="team-panel"
      className="w-full shrink-0 space-y-6 rounded-lg border bg-card p-4 lg:w-96"
    >
      <h2 className="text-lg font-semibold">{team ? 'Manage team' : 'Create team'}</h2>

      <div className="space-y-2">
        <Label htmlFor="team-name-input">Name</Label>
        <Input
          id="team-name-input"
          data-testid="team-name-input"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="team-reports-to-select">Reports-to</Label>
        <Select
          value={reportsToAssignmentId || undefined}
          onValueChange={handleReportsToChange}
        >
          <SelectTrigger id="team-reports-to-select" data-testid="team-reports-to-select">
            <SelectValue placeholder="Select reports-to" />
          </SelectTrigger>
          <SelectContent>
            {reportsToOptions.map((row) => (
              <SelectItem key={row.id} value={row.id}>
                {assignmentLabel(row, snapshot)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">Members</p>
        <div className="space-y-2">
          {memberOptions.map((row) => {
            const label = assignmentLabel(row, snapshot)
            const checked = memberIds.includes(row.id)
            return (
              <div key={row.id} className="flex items-center gap-2">
                <Checkbox
                  id={`team-member-${row.id}`}
                  data-testid={`team-member-${row.id}`}
                  checked={checked}
                  onCheckedChange={(value) => {
                    setMemberIds((current) => {
                      if (value === true) {
                        return current.includes(row.id) ? current : [...current, row.id]
                      }
                      return current.filter((id) => id !== row.id)
                    })
                  }}
                />
                <Label htmlFor={`team-member-${row.id}`} className="text-sm font-normal">
                  {label}
                </Label>
              </div>
            )
          })}
        </div>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">{error}</p>
      ) : null}

      {team ? (
        <TeamDeactivationSection
          teamName={team.name}
          confirming={confirmingDeactivate}
          saving={deactivating}
          error={deactivateError}
          onStart={() => {
            setDeactivateError(null)
            setConfirmingDeactivate(true)
          }}
          onConfirm={() => {
            void handleConfirmDeactivate()
          }}
          onCancel={() => {
            setConfirmingDeactivate(false)
            setDeactivateError(null)
          }}
        />
      ) : null}

      <Button
        type="button"
        data-testid="team-save"
        onClick={() => {
          void handleSave()
        }}
        disabled={saving || !name.trim() || !reportsToAssignmentId}
      >
        Save
      </Button>
    </aside>
  )
}
