'use client'

// Clean-start position administration panel (Plan C Task 8). Company-wide
// position names and ranks: inline rename (InlineNameEdit), rank editing with
// the A4 guard's block-and-list impact rendered adjacent to the rank input
// (no auto-repair — the admin corrects the listed records first), creation,
// and /in use/-guarded deactivation plus confirmation-gated cleanup of inactive
// rows. Attempt snapshots are never touched.

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { InlineNameEdit } from '@/components/organization/InlineNameEdit'
import { InTreeModal } from '@/components/organization/InTreeModal'
import type { PositionNode } from '@/lib/organization/model'
import {
  changePositionRank,
  createPosition,
  deactivatePosition,
  deletePosition,
  reactivatePosition,
  renamePosition,
  type RankChangeImpact,
  type WorkspaceSnapshot,
} from '@/server-actions/organization'

export function formatRouteProblem(
  row: { scopeUnitId: string; phase: string; problem: 'STEP_NOT_ASCENDING' | 'STEP_EXCEEDS_LIMIT' },
  unitNames: ReadonlyMap<string, string>,
): string {
  const scope = unitNames.get(row.scopeUnitId) ?? row.scopeUnitId
  const description = row.problem === 'STEP_NOT_ASCENDING'
    ? 'required steps would no longer ascend'
    : 'a required step would exceed the approval limit'
  return `${scope} ${row.phase} — ${description} (${row.problem})`
}

/**
 * The blocked-rank-change affected records, verbatim from the A4 guard:
 * affected reporting relationships as team names, affected published routes
 * as scope/phase/problem. Rendered adjacent to the rank input; nothing was
 * saved and nothing is auto-repaired.
 */
export function PositionRankImpactList({
  impact,
  unitNames,
}: {
  impact: RankChangeImpact
  unitNames: ReadonlyMap<string, string>
}) {
  return (
    <div
      data-testid="position-rank-impact"
      role="alert"
      className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3"
    >
      <p className="text-sm font-medium">
        This rank change is blocked. Nothing was saved — correct the affected records first.
      </p>
      {impact.affectedReportingRelationships.length > 0 ? (
        <section data-testid="position-rank-impact-teams" className="space-y-1">
          <h4 className="text-sm font-medium">Reporting relationships</h4>
          <ul className="list-disc space-y-1 pl-4 text-sm">
            {impact.affectedReportingRelationships.map((row) => (
              <li key={row.teamId} data-testid={`position-rank-impact-team-${row.teamId}`}>
                {row.teamName}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {impact.affectedPublishedRoutes.length > 0 ? (
        <section data-testid="position-rank-impact-routes" className="space-y-1">
          <h4 className="text-sm font-medium">Published routes</h4>
          <ul className="list-disc space-y-1 pl-4 text-sm">
            {impact.affectedPublishedRoutes.map((row) => (
              <li key={`${row.routeVersionId}-${row.problem}`} data-testid={`position-rank-impact-route-${row.routeVersionId}-${row.problem}`}>
                {formatRouteProblem(row, unitNames)}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}

/**
 * Rank-edit session (C8-fix1, C3-fix1 epoch pattern). epoch is the current
 * editor/draft identity: it is bumped by opening an editor, by every draft
 * change while a save is pending, and by cancel. pendingEpoch is the
 * in-flight save's epoch, or null. A rank assessment is applied only when
 * pendingEpoch still equals epoch — a draft change, cancel, or switch to
 * another position's editor invalidates the response, so a late blocked
 * impact or success can never disable or cancel a different draft/position.
 */
export type PositionRankEditSession = {
  positionId: string | null
  draftRank: string
  blockedImpact: RankChangeImpact | null
  error: string | null
  epoch: number
  pendingEpoch: number | null
}

export function idleRankEditSession(epoch = 0): PositionRankEditSession {
  return { positionId: null, draftRank: '', blockedImpact: null, error: null, epoch, pendingEpoch: null }
}

export function startRankEditSession(
  positionId: string,
  rank: number,
  priorEpoch = 0,
): PositionRankEditSession {
  return { positionId, draftRank: String(rank), blockedImpact: null, error: null, epoch: priorEpoch + 1, pendingEpoch: null }
}

export function typeRankDraft(session: PositionRankEditSession, draft: string): PositionRankEditSession {
  const next = { ...session, draftRank: draft, blockedImpact: null }
  if (session.pendingEpoch !== null) {
    return { ...next, epoch: session.epoch + 1 }
  }
  return next
}

export function cancelRankEditSession(session: PositionRankEditSession): PositionRankEditSession {
  return idleRankEditSession(session.epoch + 1)
}

export function requestRankSave(
  session: PositionRankEditSession,
): { session: PositionRankEditSession; submit: boolean } {
  if (session.positionId === null || session.pendingEpoch !== null) {
    return { session, submit: false }
  }
  if (session.blockedImpact !== null || session.draftRank.trim().length === 0) {
    return { session, submit: false }
  }
  return { session: { ...session, pendingEpoch: session.epoch }, submit: true }
}

export type PositionRankSaveOutcome =
  | { kind: 'blocked'; impact: RankChangeImpact }
  | { kind: 'error'; message: string }
  | { kind: 'success' }

export function applyRankSaveOutcome(
  session: PositionRankEditSession,
  epoch: number,
  outcome: PositionRankSaveOutcome,
): PositionRankEditSession {
  if (session.pendingEpoch !== epoch) return session
  if (session.epoch !== epoch) {
    return { ...session, pendingEpoch: null }
  }
  if (outcome.kind === 'blocked') {
    return { ...session, blockedImpact: outcome.impact, pendingEpoch: null }
  }
  if (outcome.kind === 'error') {
    return { ...session, error: outcome.message, pendingEpoch: null }
  }
  return idleRankEditSession(session.epoch)
}

export function PositionDeleteConfirmation({
  positionName,
  confirming,
  deleting,
  error,
  onConfirm,
  onCancel,
}: {
  positionName: string
  confirming: boolean
  deleting: boolean
  error: string | null
  onConfirm: () => void
  onCancel: () => void
}) {
  if (!confirming) return null
  return (
    <div
      data-testid="position-delete-confirmation"
      role="alertdialog"
      aria-label={`Confirm permanent deletion of ${positionName}`}
      className="basis-full space-y-3 rounded-md border border-destructive/40 bg-destructive/5 p-3"
    >
      <div className="space-y-1">
        <p className="text-sm font-medium">{`Delete ${positionName} permanently?`}</p>
        <p className="text-xs text-muted-foreground">
          Only inactive positions with no assignments, route definitions, or approval-history references can
          be deleted. Captured approval history remains protected and is never rewritten.
        </p>
      </div>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="destructive"
          size="sm"
          data-testid="position-delete-confirm"
          disabled={deleting}
          onClick={onConfirm}
        >
          {deleting ? 'Deleting…' : 'Delete permanently'}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="position-delete-cancel"
          disabled={deleting}
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
    </div>
  )
}

/**
 * Rank editor for one position. Save stays disabled while the last assessment
 * for the current draft is blocked; editing the draft clears the assessment so
 * the admin can retry a different value or cancel.
 */
export function PositionRankEditor({
  position,
  draftRank,
  blockedImpact,
  saving = false,
  error = null,
  unitNames,
  onDraftRankChange,
  onSave,
  onCancel,
}: {
  position: { id: string; name: string; rank: number }
  draftRank: string
  blockedImpact: RankChangeImpact | null
  saving?: boolean
  error?: string | null
  unitNames: ReadonlyMap<string, string>
  onDraftRankChange: (value: string) => void
  onSave: () => void
  onCancel: () => void
}) {
  return (
    <div data-testid={`position-rank-editor-${position.id}`} className="space-y-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor={`position-rank-input-${position.id}`} className="text-sm">
          {`New rank for ${position.name}`}
        </Label>
        <Input
          id={`position-rank-input-${position.id}`}
          data-testid={`position-rank-input-${position.id}`}
          inputMode="numeric"
          value={draftRank}
          onChange={(event) => onDraftRankChange(event.target.value)}
          className="h-8 min-h-8 w-24"
        />
        <Button
          type="button"
          size="sm"
          data-testid={`position-rank-save-${position.id}`}
          disabled={saving || blockedImpact !== null || draftRank.trim().length === 0}
          onClick={onSave}
        >
          Save rank
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid={`position-rank-cancel-${position.id}`}
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
      {error ? (
        <p
          role="alert"
          data-testid={`position-rank-error-${position.id}`}
          className="text-sm text-destructive"
        >
          {error}
        </p>
      ) : null}
      {blockedImpact ? <PositionRankImpactList impact={blockedImpact} unitNames={unitNames} /> : null}
    </div>
  )
}

function activePositionsSorted(positions: readonly PositionNode[]): PositionNode[] {
  return positions
    .filter((row) => row.isActive)
    .slice()
    .sort((left, right) => (
      left.rank - right.rank || left.name.localeCompare(right.name)
    ))
}

function inactivePositionsSorted(positions: readonly PositionNode[]): PositionNode[] {
  return positions
    .filter((row) => !row.isActive)
    .slice()
    .sort((left, right) => (
      left.rank - right.rank || left.name.localeCompare(right.name)
    ))
}

export function PositionAdminPanel({
  snapshot,
}: {
  snapshot: WorkspaceSnapshot
}) {
  const [rows, setRows] = useState<PositionNode[]>(() => activePositionsSorted(snapshot.positions))
  const [inactiveRows, setInactiveRows] = useState<PositionNode[]>(
    () => inactivePositionsSorted(snapshot.positions),
  )
  const [rankSession, setRankSession] = useState<PositionRankEditSession>(() => idleRankEditSession())
  const sessionRef = useRef(rankSession)
  sessionRef.current = rankSession
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})
  const [createName, setCreateName] = useState('')
  const [createRank, setCreateRank] = useState('1')
  const [createError, setCreateError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<PositionNode | null>(null)
  /** Deactivate/reactivate/delete are single-flight per position: the button
   *  of the in-flight row disables, and success transfers are idempotent. */
  const [pendingPositionId, setPendingPositionId] = useState<string | null>(null)

  function commitRankSession(next: PositionRankEditSession) {
    sessionRef.current = next
    setRankSession(next)
  }

  useEffect(() => {
    setRows(activePositionsSorted(snapshot.positions))
    setInactiveRows(inactivePositionsSorted(snapshot.positions))
  }, [snapshot.positions])

  const unitNames = useMemo(
    () => new Map(snapshot.units.map((row) => [row.id, row.name])),
    [snapshot.units],
  )
  const sliderMax = useMemo(
    () => Math.max(8, ...rows.map((row) => row.rank), ...inactiveRows.map((row) => row.rank)) + 1,
    [rows, inactiveRows],
  )
  const assignmentCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const assignment of snapshot.assignments) {
      if (!assignment.isActive) continue
      counts.set(assignment.positionId, (counts.get(assignment.positionId) ?? 0) + 1)
    }
    return counts
  }, [snapshot.assignments])

  function startRankEdit(row: PositionNode) {
    commitRankSession(startRankEditSession(row.id, row.rank, sessionRef.current.epoch))
  }

  function cancelRankEdit() {
    commitRankSession(cancelRankEditSession(sessionRef.current))
  }

  async function handleSaveRank(row: PositionNode) {
    const request = requestRankSave(sessionRef.current)
    commitRankSession(request.session)
    if (!request.submit) return
    const epoch = request.session.epoch
    const proposedRank = Number(request.session.draftRank)
    let outcome: PositionRankSaveOutcome
    try {
      const result = await changePositionRank({
        positionId: row.id,
        proposedRank,
      })
      outcome = 'blocked' in result && result.blocked
        ? { kind: 'blocked', impact: result.impact }
        : { kind: 'success' }
    } catch (err) {
      outcome = { kind: 'error', message: err instanceof Error ? err.message : String(err) }
    }
    const current = sessionRef.current
    const fresh = current.pendingEpoch === epoch && current.epoch === epoch
    commitRankSession(applyRankSaveOutcome(current, epoch, outcome))
    if (outcome.kind === 'success' && fresh) {
      setRows((rowsNow) => rowsNow.map((candidate) => (
        candidate.id === row.id ? { ...candidate, rank: proposedRank } : candidate
      )))
    }
  }

  async function handleRename(row: PositionNode, next: string) {
    await renamePosition({ positionId: row.id, name: next })
    setRows((current) => current.map((candidate) => (
      candidate.id === row.id ? { ...candidate, name: next } : candidate
    )))
  }

  async function handleDeactivate(row: PositionNode) {
    if (pendingPositionId !== null) return
    setRowErrors((current) => {
      const next = { ...current }
      delete next[row.id]
      return next
    })
    setPendingPositionId(row.id)
    try {
      await deactivatePosition({ positionId: row.id })
      setRows((current) => current.filter((candidate) => candidate.id !== row.id))
      // Idempotent transfer (never duplicate), carrying the deactivated flag.
      setInactiveRows((current) => current.some((candidate) => candidate.id === row.id)
        ? current
        : [...current, { ...row, isActive: false }].sort((left, right) => (
            left.rank - right.rank || left.name.localeCompare(right.name)
          )))
    } catch (err) {
      setRowErrors((current) => ({
        ...current,
        [row.id]: err instanceof Error ? err.message : String(err),
      }))
    } finally {
      setPendingPositionId(null)
    }
  }

  async function handleReactivate(row: PositionNode) {
    if (pendingPositionId !== null) return
    setRowErrors((current) => {
      const next = { ...current }
      delete next[`inactive-${row.id}`]
      delete next[`delete-${row.id}`]
      return next
    })
    setPendingPositionId(row.id)
    try {
      await reactivatePosition({ positionId: row.id })
      setInactiveRows((current) => current.filter((candidate) => candidate.id !== row.id))
      // Idempotent transfer (never duplicate), carrying the activated flag.
      setRows((current) => current.some((candidate) => candidate.id === row.id)
        ? current
        : [...current, { ...row, isActive: true }].sort((left, right) => (
            left.rank - right.rank || left.name.localeCompare(right.name)
          )))
    } catch (err) {
      setRowErrors((current) => ({
        ...current,
        [`inactive-${row.id}`]: err instanceof Error ? err.message : String(err),
      }))
    } finally {
      setPendingPositionId(null)
    }
  }

  async function handleDelete(row: PositionNode) {
    if (pendingPositionId !== null) return
    setRowErrors((current) => {
      const next = { ...current }
      delete next[`inactive-${row.id}`]
      delete next[`delete-${row.id}`]
      return next
    })
    setPendingPositionId(row.id)
    try {
      await deletePosition({ positionId: row.id })
      setInactiveRows((current) => current.filter((candidate) => candidate.id !== row.id))
      setDeleteTarget(null)
    } catch (err) {
      setRowErrors((current) => ({
        ...current,
        [`delete-${row.id}`]: err instanceof Error ? err.message : String(err),
      }))
    } finally {
      setPendingPositionId(null)
    }
  }

  async function handleCreate(onDone?: () => void) {
    setCreateError(null)
    setCreating(true)
    try {
      const rank = Number(createRank)
      const result = await createPosition({ name: createName, rank })
      setRows((current) => [...current, {
        id: result.positionId,
        name: createName.trim(),
        rank,
        isActive: true,
      }])
      setCreateName('')
      setCreateRank('1')
      onDone?.()
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err))
    } finally {
      setCreating(false)
    }
  }

  return (
    <section
      data-testid="position-admin-panel"
      aria-label="Position administration"
      className="space-y-6 rounded-lg border bg-card p-4"
    >
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold">Positions</h2>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            data-testid="position-create-open"
            onClick={() => {
              setCreateName('')
              setCreateRank('1')
              setCreateError(null)
              setCreateOpen(true)
            }}
          >
            Add position
          </Button>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        Company-wide job titles and approval ranks (1 is lowest). A rank change that would
        invalidate a reporting relationship or a published approval chain is blocked and lists the
        affected records. Existing approval snapshots keep their captured values.
      </p>

      <div className="grid gap-6 lg:grid-cols-[13rem_minmax(0,1fr)]">
      <aside className="rounded-md border px-3 py-3" aria-label="Rank ladder">
        <h3 className="text-sm font-medium">Rank ladder</h3>
        <p className="mb-3 text-xs text-muted-foreground">Higher number sits higher on the approval ceiling.</p>
        <ol className="space-y-1">
          {rows.map((row) => (
            <li key={`ladder-${row.id}`} className="flex items-center gap-2 text-sm">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-foreground text-xs font-semibold text-background">
                {row.rank}
              </span>
              <span className="truncate font-medium">{row.name}</span>
            </li>
          ))}
        </ol>
      </aside>
      <ul data-testid="position-list" className="space-y-2">
        {rows.map((row) => {
          const count = assignmentCounts.get(row.id) ?? 0
          return (
            <li
              key={row.id}
              data-testid={`position-row-${row.id}`}
              className="space-y-2 rounded-md border px-3 py-2"
            >
              <div className="flex flex-wrap items-center gap-3">
                <InlineNameEdit
                  value={row.name}
                  onSave={(next) => handleRename(row, next)}
                />
                <span data-testid={`position-rank-${row.id}`} className="text-sm text-muted-foreground">
                  {`Rank ${row.rank}`}
                </span>
                <span
                  data-testid={`position-assignment-count-${row.id}`}
                  className="text-sm text-muted-foreground"
                >
                  {count === 1 ? '1 person holds this title' : `${count} people hold this title`}
                </span>
                <span className="flex-1" />
                {rankSession.positionId !== row.id ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    data-testid={`position-rank-edit-${row.id}`}
                    onClick={() => startRankEdit(row)}
                  >
                    Edit rank
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  data-testid={`position-deactivate-${row.id}`}
                  disabled={pendingPositionId !== null}
                  onClick={() => {
                    void handleDeactivate(row)
                  }}
                >
                  Deactivate
                </Button>
              </div>
              {rowErrors[row.id] ? (
                <p
                  role="alert"
                  data-testid={`position-row-error-${row.id}`}
                  className="text-sm text-destructive"
                >
                  {rowErrors[row.id]}
                </p>
              ) : null}
            </li>
          )
        })}
      </ul>
      </div>

      {inactiveRows.length > 0 ? (
        <section data-testid="position-inactive" className="space-y-2">
          <h3 className="text-sm font-medium">Inactive positions</h3>
          <p className="text-xs text-muted-foreground">
            Hidden from new assignments and editors. Reactivate anytime — history and approval
            snapshots keep their captured values.
          </p>
          <ul className="space-y-2">
            {inactiveRows.map((row) => (
              <li
                key={row.id}
                data-testid={`position-inactive-row-${row.id}`}
                className="flex flex-wrap items-center gap-3 rounded-md border border-dashed px-3 py-2"
              >
                <span className="text-sm font-medium">{row.name}</span>
                <span className="text-sm text-muted-foreground">{`Rank ${row.rank}`}</span>
                <span className="flex-1" />
                {rowErrors[`inactive-${row.id}`] ? (
                  <p role="alert" className="text-sm text-destructive">
                    {rowErrors[`inactive-${row.id}`]}
                  </p>
                ) : null}
                {deleteTarget?.id !== row.id ? (
                  <div className="flex items-center gap-2">
                    {rowErrors[`delete-${row.id}`] ? (
                      <p role="alert" className="max-w-sm text-sm text-destructive">
                        {rowErrors[`delete-${row.id}`]}
                      </p>
                    ) : null}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      data-testid={`position-reactivate-${row.id}`}
                      disabled={pendingPositionId !== null}
                      onClick={() => {
                        void handleReactivate(row)
                      }}
                    >
                      Reactivate
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      data-testid={`position-delete-${row.id}`}
                      disabled={pendingPositionId !== null}
                      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => {
                        setRowErrors((current) => {
                          const next = { ...current }
                          delete next[`delete-${row.id}`]
                          return next
                        })
                        setDeleteTarget(row)
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                ) : (
                  <PositionDeleteConfirmation
                    positionName={row.name}
                    confirming
                    deleting={pendingPositionId === row.id}
                    error={rowErrors[`delete-${row.id}`] ?? null}
                    onConfirm={() => {
                      void handleDelete(row)
                    }}
                    onCancel={() => setDeleteTarget(null)}
                  />
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {rankSession.positionId ? (
        <InTreeModal
          open
          onClose={cancelRankEdit}
          className="max-w-lg"
          title="Edit position rank"
          ariaLabel="Edit position rank"
        >
          <div className="p-4">
            {rows.filter((row) => row.id === rankSession.positionId).map((row) => (
              <PositionRankEditor
                key={row.id}
                position={row}
                draftRank={rankSession.draftRank}
                blockedImpact={rankSession.blockedImpact}
                saving={rankSession.pendingEpoch !== null}
                error={rankSession.error}
                unitNames={unitNames}
                onDraftRankChange={(value) => {
                  commitRankSession(typeRankDraft(sessionRef.current, value))
                }}
                onSave={() => {
                  void handleSaveRank(row)
                }}
                onCancel={cancelRankEdit}
              />
            ))}
          </div>
        </InTreeModal>
      ) : null}

      {createOpen ? (
        <InTreeModal
          open
          onClose={() => setCreateOpen(false)}
          className="max-w-sm"
          title="Add position"
          ariaLabel="Add position"
        >
          <div className="space-y-4 p-4">
            <div>
              <h3 className="text-base font-semibold">Add position</h3>
              <p className="text-sm text-muted-foreground">Company-wide title and approval rank.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="position-create-name">Name</Label>
              <Input
                id="position-create-name"
                data-testid="position-create-name"
                value={createName}
                onChange={(event) => setCreateName(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="position-create-rank">Rank</Label>
              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  data-testid="position-create-rank-decrease"
                  aria-label="Decrease rank"
                  disabled={Number(createRank) <= 1}
                  onClick={() => setCreateRank(String(Math.max(1, Number(createRank) - 1)))}
                >
                  −
                </Button>
                <span
                  id="position-create-rank"
                  data-testid="position-create-rank"
                  aria-live="polite"
                  className="min-w-14 text-center text-xl font-bold tabular-nums"
                >
                  {createRank}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  data-testid="position-create-rank-increase"
                  aria-label="Increase rank"
                  disabled={Number(createRank) >= sliderMax}
                  onClick={() => setCreateRank(String(Math.min(sliderMax, Number(createRank) + 1)))}
                >
                  +
                </Button>
                <span className="text-xs text-muted-foreground">max {sliderMax}</span>
              </div>
              <p className="text-xs text-muted-foreground">1 is lowest; use + / − to set the rank.</p>
            </div>
            {createError ? (
              <p role="alert" data-testid="position-create-error" className="text-sm text-destructive">
                {createError}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                data-testid="position-create-save"
                disabled={creating || createName.trim().length === 0 || createRank.trim().length === 0}
                onClick={() => {
                  void handleCreate(() => setCreateOpen(false))
                }}
              >
                Create position
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setCreateOpen(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        </InTreeModal>
      ) : null}
    </section>
  )
}
