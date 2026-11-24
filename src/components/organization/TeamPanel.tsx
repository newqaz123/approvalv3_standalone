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
import { useTranslations } from '@/lib/i18n/client'

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
  const t = useTranslations()
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
            {t('admin.deactivateTeamQuestion', { name: teamName })}
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="destructive"
              data-testid="team-deactivate-confirm"
              onClick={onConfirm}
              disabled={saving}
            >
              {t('admin.deactivateTeam')}
            </Button>
            <Button
              type="button"
              variant="outline"
              data-testid="team-deactivate-cancel"
              onClick={onCancel}
              disabled={saving}
            >
              {t('common.cancel')}
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
          {t('admin.deactivateTeam')}
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
  const t = useTranslations()
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
  const [deactivateError, setDeactivateError] = useState<
    { reason: 'failed' } | { reason: 'members_assigned'; memberNames: string[] } | null
  >(null)

  // Refreshes with the same persisted team (including language changes) must keep the open draft.
  const storedName = team?.name ?? ''
  const storedReportsTo = team?.reportsToAssignmentId ?? ''
  const storedMembership = JSON.stringify(team
    ? snapshot.assignments.filter(row => row.isActive && row.teamId === team.id).map(row => row.id)
    : [])
  useEffect(() => {
    setName(storedName)
    setReportsToAssignmentId(storedReportsTo)
    setMemberIds(JSON.parse(storedMembership))
    setError(null)
    setConfirmingDeactivate(false)
    setDeactivateError(null)
  }, [teamId, unitId, storedName, storedReportsTo, storedMembership])

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
      const result = await deactivateTeam({ teamId: team.id })
      if (!result.success) {
        setDeactivateError(result)
        return
      }
      onDeactivated?.(team.id)
    } catch {
      setDeactivateError({ reason: 'failed' })
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
      setError(t('admin.teamSaveFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <aside
      data-testid="team-panel"
      className="max-h-[calc(100vh-2rem)] w-full shrink-0 space-y-6 overflow-y-auto overscroll-contain rounded-lg border bg-card p-4 lg:sticky lg:top-4"
    >
      <h2 className="text-lg font-semibold">{team ? t('admin.manageTeam') : t('admin.createTeam')}</h2>

      <div className="space-y-2">
        <Label htmlFor="team-name-input">{t('admin.name')}</Label>
        <Input
          id="team-name-input"
          data-testid="team-name-input"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="team-reports-to-select">{t('admin.reportsTo')}</Label>
        <Select
          value={reportsToAssignmentId || undefined}
          onValueChange={handleReportsToChange}
        >
          <SelectTrigger id="team-reports-to-select" data-testid="team-reports-to-select">
            <SelectValue placeholder={t('admin.selectReportsTo')} />
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
        <p className="text-sm font-medium">{t('admin.members')}</p>
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
          error={deactivateError && (deactivateError.reason === 'members_assigned' && deactivateError.memberNames.length > 0
            ? t('admin.teamDeactivateMembers', { names: deactivateError.memberNames.join(', ') })
            : t('admin.teamDeactivateFailed'))}
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
        {t('admin.save')}
      </Button>
    </aside>
  )
}
