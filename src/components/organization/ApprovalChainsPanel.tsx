'use client'

// Clean-start approval chains panel (Plan C Task 9): the company-wide
// configuration surface opened by the workspace header action "Approval
// chains" — NOT another form repeated under each unit. Root defaults are
// separate per phase; unit exceptions are explicit published overrides
// labeled "Custom at this unit"; published versions render as explicit
// per-phase lists; the RouteEditorPanel handles Add approval step /
// Approval limit editing with limit-conflict blocking; the
// SubmitterTestDialog resolves actual people side-effect-free; stranded
// attempts restart through the RestartAttemptDialog (required reason).
// Copy contract: publishing a root default affects future attempts only —
// it is NOT a global on/off switch.

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
import type { ApprovalPhase } from '@/lib/approval-routes/definition'
import { ancestorUnitIds } from '@/lib/organization/hierarchy'
import {
  deleteRouteException,
  type ApprovalChainsData,
} from '@/server-actions/approval-routes'
import { InTreeModal } from '@/components/organization/InTreeModal'
import { RouteEditorPanel } from '@/components/organization/RouteEditorPanel'
import { RestartAttemptDialog } from '@/components/organization/RestartAttemptDialog'

const PHASES: readonly ApprovalPhase[] = ['REQUEST', 'SOLUTION', 'FINAL']
const PHASE_LABEL: Record<ApprovalPhase, string> = {
  REQUEST: 'Request',
  SOLUTION: 'Solution',
  FINAL: 'Final',
}

export type ChainsEditorMode = 'create' | 'edit' | 'customize'

export type ChainsEditorTarget = {
  scopeUnitId: string
  phase: ApprovalPhase
  readOnly?: boolean
  versionId?: string
  /** `create` seeds from an inherited route while keeping this scope as the destination. */
  mode?: ChainsEditorMode
}

function publishedAtScope(
  versions: ApprovalChainsData['versions'],
  scopeUnitId: string,
  phase: ApprovalPhase,
): Array<ApprovalChainsData['versions'][number]> {
  return versions.filter(
    (row) =>
      row.scopeUnitId === scopeUnitId
      && row.phase === phase
      && row.status === 'PUBLISHED',
  )
}

/** Effective PUBLISHED route for View: self, then ancestors. Drafts never win. */
export function resolvePublishedSourceVersion(
  versions: ApprovalChainsData['versions'],
  units: ApprovalChainsData['units'],
  scopeUnitId: string,
  phase: ApprovalPhase,
): ApprovalChainsData['versions'][number] | null {
  let path: string[]
  try {
    path = ancestorUnitIds(units, scopeUnitId)
  } catch {
    return null
  }
  for (const id of path) {
    const published = publishedAtScope(versions, id, phase)
    if (published.length === 1) return published[0]
    if (published.length > 1) return null
  }
  return null
}

/**
 * Finds the nearest published route inherited by a unit, deliberately
 * skipping the unit itself. This is the seed for a new exception: the source
 * definition is copied in memory, while the selected unit remains the publish
 * destination. DRAFT and RETIRED rows never qualify; ambiguity fails closed.
 */
export function resolveInheritedPublishedSourceVersion(
  versions: ApprovalChainsData['versions'],
  units: ApprovalChainsData['units'],
  scopeUnitId: string,
  phase: ApprovalPhase,
): ApprovalChainsData['versions'][number] | null {
  let path: string[]
  try {
    path = ancestorUnitIds(units, scopeUnitId).slice(1)
  } catch {
    return null
  }
  for (const id of path) {
    const published = publishedAtScope(versions, id, phase)
    if (published.length === 1) return published[0]
    if (published.length > 1) return null
  }
  return null
}

/** Effective PUBLISHED route for View/Edit: self, then ancestors. */
export function resolveEditorVersion(
  versions: ApprovalChainsData['versions'],
  units: ApprovalChainsData['units'],
  editor: ChainsEditorTarget,
): ApprovalChainsData['versions'][number] | null {
  // Owner revision: drafts are removed — the editor always seeds from the
  // PUBLISHED route at the scope (or the explicitly referenced version when
  // it is published). A new exception falls back to the nearest inherited
  // published route, but the editor scope remains the selected destination.
  if (editor.versionId) {
    const row = versions.find((candidate) => candidate.versionId === editor.versionId) ?? null
    if (
      row === null
      || row.status !== 'PUBLISHED'
      || row.scopeUnitId !== editor.scopeUnitId
      || row.phase !== editor.phase
    ) return null
    return row
  }
  if (editor.mode === 'create') {
    return resolveInheritedPublishedSourceVersion(versions, units, editor.scopeUnitId, editor.phase)
  }
  if (editor.readOnly === true) {
    return resolvePublishedSourceVersion(versions, units, editor.scopeUnitId, editor.phase)
  }
  const local = versions.find(
    (row) =>
      row.scopeUnitId === editor.scopeUnitId
      && row.phase === editor.phase
      && row.status === 'PUBLISHED',
  ) ?? null
  // A scope without its own published route is a newly-created/recreated
  // exception in practice, so seed it from the nearest inherited route rather
  // than presenting an empty editor. The explicit create mode above skips the
  // scope itself even if a concurrent publisher added a local row meanwhile.
  return local ?? resolvePublishedSourceVersion(versions, units, editor.scopeUnitId, editor.phase)
}

/** Remount the editor when the viewed/edited version identity changes. */
export function editorRemountKey(
  editor: ChainsEditorTarget,
  version: ApprovalChainsData['versions'][number] | null,
): string {
  const versionPart = editor.versionId ?? version?.versionId ?? 'empty'
  const mode = editor.readOnly === true ? 'view' : editor.mode ?? 'edit'
  return `${editor.scopeUnitId}-${editor.phase}-${mode}-${versionPart}`
}

export function ChainsVersionSummary({
  version,
  positionNames,
}: {
  version: ApprovalChainsData['versions'][number]
  positionNames: ReadonlyMap<string, string>
}) {
  const stepNames = version.steps
    .map((step) => positionNames.get(step.positionId) ?? step.positionId)
    .join(' → ')
  const limit = version.approvalLimitPositionId
    ? positionNames.get(version.approvalLimitPositionId) ?? version.approvalLimitPositionId
    : '—'
  return (
    <p className="text-sm">
      {`Steps: ${version.steps.length === 0 ? '(none)' : stepNames} · Approval limit: ${limit}`}
    </p>
  )
}

export function RouteExceptionDeletionSection({
  unitName,
  phase,
  confirming,
  deleting,
  error,
  onConfirm,
  onCancel,
}: {
  unitName: string
  phase: ApprovalPhase
  confirming: boolean
  deleting: boolean
  error: string | null
  onConfirm: () => void
  onCancel: () => void
}) {
  if (!confirming) return null
  return (
    <div
      data-testid="chains-exception-delete-confirmation"
      role="alertdialog"
      aria-label={`Confirm removal of ${unitName} ${PHASE_LABEL[phase]} exception`}
      className="space-y-3 rounded-md border border-destructive/40 bg-destructive/5 p-3"
    >
      <div className="space-y-1">
        <p className="text-sm font-medium">{`Remove ${unitName} ${PHASE_LABEL[phase]} exception?`}</p>
        <p className="text-xs text-muted-foreground">
          Future submissions will use the nearest inherited published route. Existing approval history and
          captured route snapshots remain unchanged; only this unit&apos;s published exception is retired.
        </p>
      </div>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="destructive"
          size="sm"
          data-testid="chains-exception-delete-confirm"
          disabled={deleting}
          onClick={onConfirm}
        >
          {deleting ? 'Removing…' : 'Remove exception'}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="chains-exception-delete-cancel"
          disabled={deleting}
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
    </div>
  )
}

export type CreateExceptionDialogProps = {
  open?: boolean
  units: ApprovalChainsData['units']
  rootUnitId: string | null
  phaseVersions: ApprovalChainsData['versions']
  onClose: () => void
  onCreate: (target: ChainsEditorTarget) => void
  onEdit: (target: ChainsEditorTarget) => void
}

/**
 * Chooser for a new unit exception. It only changes local editor state: no
 * route action runs until the editor's Publish button is pressed. A local
 * published pair is never offered a second Create action; it is routed to
 * Edit chain instead.
 */
export function CreateExceptionDialog({
  open = true,
  units,
  rootUnitId,
  phaseVersions,
  onClose,
  onCreate,
  onEdit,
}: CreateExceptionDialogProps) {
  const eligibleUnits = useMemo(
    () => units.filter((unit) => (
      unit.isActive
      && unit.parentId !== null
      && unit.id !== rootUnitId
    )),
    [units, rootUnitId],
  )
  const [selectedUnitId, setSelectedUnitId] = useState(eligibleUnits[0]?.id ?? '')
  const [phase, setPhase] = useState<ApprovalPhase>('REQUEST')

  useEffect(() => {
    if (eligibleUnits.some((unit) => unit.id === selectedUnitId)) return
    setSelectedUnitId(eligibleUnits[0]?.id ?? '')
  }, [eligibleUnits, selectedUnitId])

  const selectedUnit = eligibleUnits.find((unit) => unit.id === selectedUnitId) ?? null
  const localPublished = selectedUnit
    ? publishedAtScope(phaseVersions, selectedUnit.id, phase)
    : []
  const inherited = selectedUnit
    ? resolveInheritedPublishedSourceVersion(phaseVersions, units, selectedUnit.id, phase)
    : null
  const inheritedUnit = inherited
    ? units.find((unit) => unit.id === inherited.scopeUnitId) ?? null
    : null

  function handleCreate() {
    if (!selectedUnit) return
    onCreate({ scopeUnitId: selectedUnit.id, phase, mode: 'create' })
  }

  function handleEdit() {
    if (!selectedUnit || localPublished.length === 0) return
    // Ambiguous legacy data is still fail-closed for creation; selecting the
    // first published row gives the admin an entry point to resolve it.
    onEdit({
      scopeUnitId: selectedUnit.id,
      phase,
      mode: 'edit',
      versionId: localPublished[0].versionId,
    })
  }

  return (
    <InTreeModal
      open={open}
      onClose={onClose}
      testId="chains-create-exception-dialog"
      title="Create unit exception"
      titleId="chains-create-exception-title"
      className="max-w-xl"
    >
      <div className="space-y-5 p-6">
        <p className="text-sm text-muted-foreground">
          A custom chain replaces the inherited chain for this unit and all of its descendants unless
          overridden by their own exception; it does not append to the inherited chain. Nothing is saved
          until you publish.
        </p>

        {eligibleUnits.length === 0 ? (
          <div
            data-testid="chains-create-exception-no-units"
            className="rounded-md border bg-muted/20 px-3 py-3 text-sm text-muted-foreground"
          >
            There are no active non-root units available for a unit exception.
          </div>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="chains-create-exception-unit">Target unit</Label>
                <Select value={selectedUnitId} onValueChange={setSelectedUnitId}>
                  <SelectTrigger id="chains-create-exception-unit" data-testid="chains-create-exception-unit-select">
                    <SelectValue placeholder="Select an active unit" />
                  </SelectTrigger>
                  <SelectContent>
                    {eligibleUnits.map((unit) => (
                      <SelectItem key={unit.id} value={unit.id}>{unit.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="chains-create-exception-phase">Phase</Label>
                <Select value={phase} onValueChange={(value) => setPhase(value as ApprovalPhase)}>
                  <SelectTrigger id="chains-create-exception-phase" data-testid="chains-create-exception-phase-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PHASES.map((candidate) => (
                      <SelectItem key={candidate} value={candidate}>{PHASE_LABEL[candidate]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {selectedUnit && localPublished.length > 0 ? (
              <div
                data-testid="chains-create-exception-existing"
                className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-3"
              >
                <p className="text-sm font-medium">{`${selectedUnit.name} already has a published ${PHASE_LABEL[phase]} exception.`}</p>
                <p className="text-sm text-muted-foreground">
                  This unit/phase pair cannot be duplicated. Edit the existing chain instead; its
                  published history remains intact until a replacement is published.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  data-testid="chains-create-exception-edit"
                  onClick={handleEdit}
                >
                  Edit chain
                </Button>
              </div>
            ) : selectedUnit && inherited ? (
              <p data-testid="chains-create-exception-inherited" className="text-sm text-muted-foreground">
                {`The new ${PHASE_LABEL[phase]} chain starts from the published chain inherited from ${inheritedUnit?.name ?? 'an ancestor'}. It will publish for ${selectedUnit.name}; the inherited source is unchanged.`}
              </p>
            ) : selectedUnit ? (
              <p data-testid="chains-create-exception-no-inherited" className="text-sm text-muted-foreground">
                {`No inherited published ${PHASE_LABEL[phase]} chain is available for ${selectedUnit.name}. The editor will start blank; no placeholder route is fabricated.`}
              </p>
            ) : null}
          </>
        )}

        <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
          <Button
            type="button"
            variant="outline"
            data-testid="chains-create-exception-cancel"
            onClick={onClose}
          >
            Cancel
          </Button>
          {selectedUnit && localPublished.length === 0 ? (
            <Button
              type="button"
              data-testid="chains-create-exception-submit"
              onClick={handleCreate}
            >
              Create exception
            </Button>
          ) : null}
        </div>
      </div>
    </InTreeModal>
  )
}

export function ApprovalChainsPanel({
  data,
  initialEditor = null,
}: {
  data: ApprovalChainsData
  initialEditor?: ChainsEditorTarget | null
}) {
  const [editor, setEditor] = useState(initialEditor)
  const [createExceptionOpen, setCreateExceptionOpen] = useState(false)
  const [strandedId, setStrandedId] = useState<string | null>(null)
  const [exceptionDeleteTarget, setExceptionDeleteTarget] = useState<{
    unitId: string
    phase: ApprovalPhase
  } | null>(null)
  const [exceptionDeleteError, setExceptionDeleteError] = useState<string | null>(null)
  const [deletingException, setDeletingException] = useState(false)
  // Keep a truthful client snapshot after a publish/remove. The server
  // revalidation updates the next RSC refresh; this local copy makes the
  // current panel update immediately and preserves retired history rows.
  const [versions, setVersions] = useState<ApprovalChainsData['versions']>(() => data.versions)

  useEffect(() => {
    setVersions(data.versions)
  }, [data.versions])

  const positionNames = useMemo(
    () => new Map(data.positions.map((row) => [row.id, row.name])),
    [data.positions],
  )
  const unitNames = useMemo(
    () => new Map(data.units.map((row) => [row.id, row.name])),
    [data.units],
  )
  const activeUsers = useMemo(
    () => data.users.filter((user) => user.isActive).map(({ id, name }) => ({ id, name })),
    [data.users],
  )
  const rootUnit = useMemo(
    () => data.units.find((row) => row.id === data.rootUnitId) ?? null,
    [data.units, data.rootUnitId],
  )
  const editorUnit = editor
    ? data.units.find((row) => row.id === editor.scopeUnitId) ?? null
    : null
  const seed = useMemo(() => {
    if (!editor) return null
    if (editor.mode === 'create') {
      return resolveInheritedPublishedSourceVersion(versions, data.units, editor.scopeUnitId, editor.phase)
    }
    return resolveEditorVersion(versions, data.units, editor)
  }, [data.units, editor, versions])
  const editorInitial = seed && seed.approvalLimitPositionId
    ? {
        approvalLimitPositionId: seed.approvalLimitPositionId,
        steps: seed.steps.map((step) => ({ order: step.order, positionId: step.positionId })),
      }
    : null
  const editorMode: ChainsEditorMode | 'view' | null = editor
    ? editor.readOnly === true
      ? 'view'
      : editor.mode
        ?? (editor.scopeUnitId === rootUnit?.id ? 'customize' : 'edit')
    : null
  const editorTitleVerb = editorMode === 'view'
    ? 'View'
    : editorMode === 'create'
      ? 'Create'
      : editorMode === 'customize'
        ? 'Customize'
        : 'Edit'
  const seedScopeName = editor?.mode === 'create' && seed
    ? unitNames.get(seed.scopeUnitId) ?? null
    : null

  const exceptions = useMemo(
    () => data.units
      .filter((row) => row.id !== data.rootUnitId)
      .flatMap((unit) =>
        PHASES.flatMap((phase) =>
          versions
            .filter((row) => (
              row.scopeUnitId === unit.id
              && row.phase === phase
              && row.status === 'PUBLISHED'
            ))
            .map((version) => ({ unit, phase, version })),
        ),
      ),
    [data.units, data.rootUnitId, versions],
  )

  async function handleDeleteException(target: { unitId: string; phase: ApprovalPhase }) {
    if (deletingException) return
    setExceptionDeleteError(null)
    setDeletingException(true)
    try {
      await deleteRouteException({ scopeUnitId: target.unitId, phase: target.phase })
      setVersions((current) => current.map((row) => (
        row.scopeUnitId === target.unitId
        && row.phase === target.phase
        && row.status === 'PUBLISHED'
          ? { ...row, status: 'RETIRED' as const }
          : row
      )))
      setExceptionDeleteTarget(null)
    } catch (err) {
      setExceptionDeleteError(err instanceof Error ? err.message : String(err))
    } finally {
      setDeletingException(false)
    }
  }

  function handleEditorPublished(
    target: ChainsEditorTarget,
    result: {
      versionId: string
      approvalLimitPositionId: string
      steps: ReadonlyArray<{ order: number; positionId: string }>
    },
  ) {
    setVersions((current) => {
      const scoped = current.filter((row) => row.scopeUnitId === target.scopeUnitId && row.phase === target.phase)
      const nextVersion = Math.max(0, ...scoped.map((row) => row.version)) + 1
      const retired = current.map((row) => (
        row.scopeUnitId === target.scopeUnitId
        && row.phase === target.phase
        && row.status === 'PUBLISHED'
          ? { ...row, status: 'RETIRED' as const }
          : row
      ))
      return [
        ...retired,
        {
          versionId: result.versionId,
          scopeUnitId: target.scopeUnitId,
          phase: target.phase,
          version: nextVersion,
          status: 'PUBLISHED' as const,
          approvalLimitPositionId: result.approvalLimitPositionId,
          steps: result.steps.map((step) => ({ order: step.order, positionId: step.positionId })),
        },
      ]
    })
    // A successful publish is the commit point for the editor. Closing here
    // also makes it impossible for a stale draft to be mistaken for a saved
    // route; the new local published row renders immediately below.
    setEditor(null)
  }

  function beginCreateException(target: ChainsEditorTarget) {
    setCreateExceptionOpen(false)
    setEditor(target)
  }

  return (
    <section data-testid="chains-panel" className="space-y-6 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Approval chains</h2>
        <a
          href="/admin/organization"
          data-testid="chains-close"
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          Close
        </a>
      </div>
      <p className="text-sm text-muted-foreground">
        Live routes apply to the next submit. Publishing a root default affects future attempts
        only — it is not a global on/off switch. Unit exceptions are explicit, versioned
        overrides; the nearest configured ancestor route applies per phase.
      </p>

      {rootUnit ? (
        <div className="grid gap-3 md:grid-cols-3">
          {PHASES.map((phase) => {
            const published = versions.filter(
              (row) =>
                row.scopeUnitId === rootUnit.id && row.phase === phase && row.status === 'PUBLISHED',
            )
            return (
              <div
                key={phase}
                data-testid={`chains-root-${phase}`}
                className="space-y-2 rounded-md border p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-medium">{`Root default — ${PHASE_LABEL[phase]}`}</h3>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    data-testid={`chains-root-customize-${phase}`}
                    onClick={() => setEditor({ scopeUnitId: rootUnit.id, phase })}
                  >
                    Customize
                  </Button>
                </div>
                <ul data-testid={`chains-published-list-${phase}`} className="space-y-1">
                  {published.length === 0 ? (
                    <li key="empty-published" className="text-sm text-muted-foreground">No published root default.</li>
                  ) : null}
                  {published.map((version) => (
                    <li
                      key={version.versionId}
                      data-testid={`chains-published-route-${version.versionId}`}
                      className="space-y-1 rounded-md border px-3 py-2"
                    >
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        {`Published · version ${version.version}`}
                      </p>
                      <ChainsVersionSummary version={version} positionNames={positionNames} />
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
      ) : null}

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-medium">Unit exceptions</h3>
          {exceptions.length > 0 ? (
            <Button
              type="button"
              size="sm"
              data-testid="chains-create-exception"
              onClick={() => setCreateExceptionOpen(true)}
            >
              Create exception
            </Button>
          ) : null}
        </div>
        <p className="text-sm text-muted-foreground">
          A custom chain replaces the inherited chain for this unit and its descendants unless overridden
          by their own exception; it does not append to the inherited chain.
        </p>
        {exceptions.length === 0 ? (
          <div
            data-testid="chains-exceptions-empty"
            className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted/20 px-3 py-3"
          >
            <p className="text-sm text-muted-foreground">
              No unit exceptions. Units without their own published route use the nearest configured
              ancestor route.
            </p>
            <Button
              type="button"
              size="sm"
              data-testid="chains-create-exception"
              onClick={() => setCreateExceptionOpen(true)}
            >
              Create exception
            </Button>
          </div>
        ) : null}
        <ul className="space-y-2">
          {exceptions.map(({ unit, phase, version }) => (
            <li
              key={`${unit.id}-${phase}-${version.versionId}`}
              data-testid={`chains-exception-${unit.id}-${phase}`}
              className="space-y-1 rounded-md border px-3 py-2"
            >
              <p className="text-sm font-medium">{`${unit.name} — ${PHASE_LABEL[phase]}`}</p>
              <p className="text-sm text-muted-foreground">Custom at this unit</p>
              <ChainsVersionSummary version={version} positionNames={positionNames} />
              {exceptionDeleteTarget?.unitId === unit.id && exceptionDeleteTarget.phase === phase ? (
                <RouteExceptionDeletionSection
                  unitName={unit.name}
                  phase={phase}
                  confirming
                  deleting={deletingException}
                  error={exceptionDeleteError}
                  onConfirm={() => {
                    void handleDeleteException({ unitId: unit.id, phase })
                  }}
                  onCancel={() => {
                    setExceptionDeleteTarget(null)
                    setExceptionDeleteError(null)
                  }}
                />
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    data-testid={`chains-exception-view-${unit.id}-${phase}`}
                    onClick={() => setEditor({ scopeUnitId: unit.id, phase, readOnly: true })}
                  >
                    View
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    data-testid={`chains-exception-customize-${unit.id}-${phase}`}
                    data-action="edit-chain"
                    onClick={() => setEditor({ scopeUnitId: unit.id, phase, mode: 'edit', versionId: version.versionId })}
                  >
                    Edit chain
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    data-testid={`chains-exception-delete-${unit.id}-${phase}`}
                    disabled={deletingException}
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => {
                      setExceptionDeleteError(null)
                      setExceptionDeleteTarget({ unitId: unit.id, phase })
                    }}
                  >
                    Remove exception
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-medium">Stranded attempts</h3>
        <p className="text-sm text-muted-foreground">
          Attempts whose saved approvers are all inactive. Restarting requires a reason and
          preserves the old attempt and its decisions; the new attempt is built from current
          organization settings.
        </p>
        <ul data-testid="chains-stranded-list" className="space-y-2">
          {data.strandedAttempts.length === 0 ? (
            <li key="empty-stranded" className="text-sm text-muted-foreground">No stranded attempts.</li>
          ) : null}
          {data.strandedAttempts.map((attempt) => (
            <li
              key={attempt.instanceId}
              data-testid={`chains-stranded-${attempt.instanceId}`}
              data-request-id={attempt.requestId ?? undefined}
              className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2"
            >
              <p className="text-sm">
                {`${attempt.phase} · attempt ${attempt.attempt} · origin ${attempt.originUserId}`}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid={`chains-stranded-restart-${attempt.instanceId}`}
                onClick={() => setStrandedId(attempt.instanceId)}
              >
                Restart…
              </Button>
            </li>
          ))}
        </ul>
      </div>

      <InTreeModal
        open={Boolean(editor && editorUnit)}
        onClose={() => setEditor(null)}
        className="max-w-3xl"
        title={editor && editorUnit ? `${editorTitleVerb} ${PHASE_LABEL[editor.phase]} approval chain` : 'Approval chain editor'}
        ariaLabel={editor && editorUnit ? `${editorTitleVerb} approval chain` : 'Approval chain editor'}
      >
        {editor && editorUnit ? (
          <RouteEditorPanel
            key={editorRemountKey(editor, seed)}
            scopeUnitId={editor.scopeUnitId}
            scopeName={editorUnit.name}
            phase={editor.phase}
            positions={data.positions}
            users={activeUsers}
            unitNames={unitNames}
            initial={editorInitial}
            seedVersionId={seed?.versionId ?? null}
            seedScopeName={seedScopeName}
            editorMode={editorMode === 'view' ? 'edit' : editorMode ?? 'edit'}
            readOnly={editor.readOnly === true}
            onPublished={(result) => handleEditorPublished(editor, result)}
          />
        ) : null}
      </InTreeModal>
      <CreateExceptionDialog
        units={data.units}
        rootUnitId={data.rootUnitId}
        phaseVersions={versions}
        open={createExceptionOpen}
        onClose={() => setCreateExceptionOpen(false)}
        onCreate={beginCreateException}
        onEdit={beginCreateException}
      />
      {strandedId ? (
        <RestartAttemptDialog
          instanceId={strandedId}
          unitNames={unitNames}
          onClose={() => setStrandedId(null)}
        />
      ) : null}
    </section>
  )
}
