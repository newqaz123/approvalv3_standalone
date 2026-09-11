'use client'

// Clean-start approval chains panel (Plan C Task 9): the company-wide
// configuration surface opened by the workspace header action "Approval
// chains" — NOT another form repeated under each unit. Root defaults are
// separate per phase; unit exceptions are explicit published overrides
// labeled "Custom at this unit"; drafts and published versions render as
// visibly distinct lists; the RouteEditorPanel handles Add approval step /
// Approval limit editing with limit-conflict blocking; the
// SubmitterTestDialog resolves actual people side-effect-free; stranded
// attempts restart through the RestartAttemptDialog (required reason).
// Copy contract: publishing a root default affects future attempts only —
// it is NOT a global on/off switch.

import React, { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { ApprovalPhase } from '@/lib/approval-routes/definition'
import type { ApprovalChainsData } from '@/server-actions/approval-routes'
import { RouteEditorPanel } from '@/components/organization/RouteEditorPanel'
import { RestartAttemptDialog } from '@/components/organization/RestartAttemptDialog'

const PHASES: readonly ApprovalPhase[] = ['REQUEST', 'SOLUTION', 'FINAL']

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

export function ApprovalChainsPanel({
  data,
  initialEditor = null,
}: {
  data: ApprovalChainsData
  initialEditor?: { scopeUnitId: string; phase: ApprovalPhase; readOnly?: boolean } | null
}) {
  const [editor, setEditor] = useState(initialEditor)
  const [strandedId, setStrandedId] = useState<string | null>(null)

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
  const editorInitial = useMemo(() => {
    if (!editor) return null
    const published = data.versions.find(
      (row) =>
        row.scopeUnitId === editor.scopeUnitId
        && row.phase === editor.phase
        && row.status === 'PUBLISHED',
    )
    const draft = data.versions.find(
      (row) =>
        row.scopeUnitId === editor.scopeUnitId
        && row.phase === editor.phase
        && row.status === 'DRAFT',
    )
    const seed = draft ?? published ?? null
    return seed && seed.approvalLimitPositionId
      ? {
          approvalLimitPositionId: seed.approvalLimitPositionId,
          steps: seed.steps.map((step) => ({ order: step.order, positionId: step.positionId })),
        }
      : null
  }, [data.versions, editor])

  const exceptions = useMemo(
    () => data.units
      .filter((row) => row.id !== data.rootUnitId)
      .flatMap((unit) =>
        PHASES.flatMap((phase) =>
          data.versions
            .filter((row) => row.scopeUnitId === unit.id && row.phase === phase && row.status === 'PUBLISHED')
            .map((version) => ({ unit, phase, version })),
        ),
      ),
    [data.units, data.versions, data.rootUnitId],
  )

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
        Company-wide route configuration. Root defaults are separate per phase. Publishing a root
        default changes the route that future attempts resolve when no nearer unit exception
        applies — it is not a global on/off switch and affects future attempts only. Unit
        exceptions are explicit, versioned overrides; the nearest configured ancestor route
        applies per phase.
      </p>

      {rootUnit ? (
        <div className="space-y-4">
          {PHASES.map((phase) => {
            const published = data.versions.filter(
              (row) =>
                row.scopeUnitId === rootUnit.id && row.phase === phase && row.status === 'PUBLISHED',
            )
            const drafts = data.versions.filter(
              (row) =>
                row.scopeUnitId === rootUnit.id && row.phase === phase && row.status === 'DRAFT',
            )
            return (
              <div
                key={phase}
                data-testid={`chains-root-${phase}`}
                className="space-y-2 rounded-md border p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-medium">{`Root default — ${phase}`}</h3>
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
                <section data-testid={`chains-section-drafts-${phase}`} className="space-y-1">
                  <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Drafts (not published)
                  </h4>
                  <ul data-testid={`chains-draft-list-${phase}`} className="space-y-1">
                    {drafts.length === 0 ? (
                      <li key="empty-draft" className="text-sm text-muted-foreground">No drafts.</li>
                    ) : null}
                    {drafts.map((version) => (
                      <li
                        key={version.versionId}
                        data-testid={`chains-draft-${version.versionId}`}
                        className="space-y-1 rounded-md border border-dashed px-3 py-2"
                      >
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          {`Draft · version ${version.version} — never affects attempts`}
                        </p>
                        <ChainsVersionSummary version={version} positionNames={positionNames} />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          data-testid={`chains-draft-edit-${version.versionId}`}
                          onClick={() => setEditor({ scopeUnitId: rootUnit.id, phase })}
                        >
                          Continue editing
                        </Button>
                      </li>
                    ))}
                  </ul>
                </section>
              </div>
            )
          })}
        </div>
      ) : null}

      <div className="space-y-3">
        <h3 className="text-sm font-medium">Unit exceptions</h3>
        {exceptions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No unit exceptions. Units without their own published route use the nearest configured
            ancestor route.
          </p>
        ) : null}
        <ul className="space-y-2">
          {exceptions.map(({ unit, phase, version }) => (
            <li
              key={`${unit.id}-${phase}-${version.versionId}`}
              data-testid={`chains-exception-${unit.id}-${phase}`}
              className="space-y-1 rounded-md border px-3 py-2"
            >
              <p className="text-sm font-medium">{`${unit.name} — ${phase}`}</p>
              <p className="text-sm text-muted-foreground">Custom at this unit</p>
              <ChainsVersionSummary version={version} positionNames={positionNames} />
              <div className="flex gap-2">
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
                  onClick={() => setEditor({ scopeUnitId: unit.id, phase })}
                >
                  Customize
                </Button>
              </div>
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

      {editor && editorUnit ? (
        <RouteEditorPanel
          key={`${editor.scopeUnitId}-${editor.phase}`}
          scopeUnitId={editor.scopeUnitId}
          scopeName={editorUnit.name}
          phase={editor.phase}
          positions={data.positions}
          users={activeUsers}
          unitNames={unitNames}
          initial={editorInitial}
          readOnly={editor.readOnly === true}
        />
      ) : null}
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
