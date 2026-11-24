'use client'

// Clean-start route editor (Plan C Task 9, owner-revised: publish-direct).
// Edits a versioned route definition for one (scope unit, phase): ordered
// position-id steps with position-name Selects and a named "Approval limit"
// Select. Steps auto-sort by position rank (the route model requires strictly
// ascending ranks) and a position already used in another step cannot be
// picked again. Publish is the ONLY write: it refuses when B2
// findLimitConflicts is non-empty and writes nothing otherwise (mirrored
// client-side by draftLimitConflicts). "Test with a submitter" opens the
// SubmitterTestDialog with the CURRENT editor state (in-memory only).
// Publish affects future attempts only.

import React, { useMemo, useState } from 'react'
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
import { findLimitConflicts } from '@/lib/approval-routes/definition'
import type { PositionNode } from '@/lib/organization/model'
import { publishRoute } from '@/server-actions/approval-routes'
import { SubmitterTestDialog } from '@/components/organization/SubmitterTestDialog'
import { useTranslations } from '@/lib/i18n/client'

type RoutePublishFeedback =
  | { key: 'admin.publishFailed' }
  | { key: 'admin.routePublishConflictCount'; values: { count: number } }
  | { key: 'admin.routePublished'; values: { version: string } }

export interface EditorStep {
  order: number
  positionId: string
}

/** Route steps are always persisted in ascending position-rank order. Empty
 * placeholders remain at the end while an editor is choosing a position. */
export function normalizeEditorSteps(
  current: ReadonlyArray<EditorStep>,
  positions: ReadonlyArray<PositionNode>,
): EditorStep[] {
  const rankOf = new Map(positions.map((row) => [row.id, row.rank] as const))
  return [...current]
    .sort((left, right) => {
      const leftRank = left.positionId ? rankOf.get(left.positionId) ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER
      const rightRank = right.positionId ? rankOf.get(right.positionId) ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER
      return leftRank - rightRank || left.order - right.order
    })
    .map((step, index) => ({ ...step, order: index + 1 }))
}

/**
 * Client mirror of the server's publish refusal: B2 findLimitConflicts over
 * the current editor draft. A non-empty result disables Publish and renders
 * the conflicting steps; publishRoute returns the identical list and writes
 * nothing if invoked anyway.
 */
export function draftLimitConflicts(
  steps: ReadonlyArray<{ order: number; positionId: string }>,
  approvalLimitPositionId: string | null,
  positions: ReadonlyArray<PositionNode>,
): ReadonlyArray<{ order: number; positionId: string; problem: 'EXCEEDS_LIMIT' }> {
  if (!approvalLimitPositionId) return []
  return findLimitConflicts(
    {
      id: 'editor-draft',
      scopeUnitId: 'editor',
      phase: 'REQUEST',
      version: 0,
      approvalLimitPositionId,
      status: 'DRAFT',
      steps: steps.map((step) => ({ order: step.order, positionId: step.positionId })),
    },
    new Map(positions.map((row) => [row.id, row])),
  )
}

export function editorComplete(
  steps: ReadonlyArray<EditorStep>,
  approvalLimitPositionId: string | null,
): boolean {
  return (
    approvalLimitPositionId !== null
    && steps.length > 0
    && steps.every((step) => step.positionId.length > 0)
    && steps.every((step, index) => step.order === index + 1)
  )
}

export type RouteEditorMode = 'create' | 'edit' | 'customize'

export interface RouteEditorPublishedResult {
  versionId: string
  approvalLimitPositionId: string
  steps: ReadonlyArray<EditorStep>
}

export function RouteEditorPanel({
  scopeUnitId,
  scopeName,
  phase,
  positions,
  users,
  unitNames = new Map(),
  initial,
  seedVersionId = null,
  seedScopeName = null,
  editorMode = 'edit',
  readOnly = false,
  onPublished,
}: {
  scopeUnitId: string
  scopeName: string
  phase: ApprovalPhase
  positions: readonly PositionNode[]
  users: ReadonlyArray<{ id: string; name: string }>
  unitNames?: ReadonlyMap<string, string>
  initial?: { approvalLimitPositionId: string; steps: ReadonlyArray<EditorStep> } | null
  seedVersionId?: string | null
  /** Name of the inherited source used to seed a new destination-scoped draft. */
  seedScopeName?: string | null
  editorMode?: RouteEditorMode
  readOnly?: boolean
  onPublished?: (result: RouteEditorPublishedResult) => void
}) {
  const t = useTranslations()
  const [approvalLimitPositionId, setApprovalLimitPositionId] = useState<string | null>(
    initial?.approvalLimitPositionId ?? null,
  )
  const [steps, setSteps] = useState<EditorStep[]>(
    initial ? initial.steps.map((step) => ({ ...step })) : [],
  )
  const [feedback, setFeedback] = useState<RoutePublishFeedback | null>(null)
  const [saving, setSaving] = useState(false)
  const [showSubmitterTest, setShowSubmitterTest] = useState(false)

  const activePositions = useMemo(
    () => positions.filter((row) => row.isActive).slice().sort((left, right) => (
      left.rank - right.rank || left.name.localeCompare(right.name)
    )),
    [positions],
  )
  const positionNames = useMemo(
    () => new Map(activePositions.map((row) => [row.id, row.name])),
    [activePositions],
  )
  const conflicts = useMemo(
    () => draftLimitConflicts(steps, approvalLimitPositionId, positions),
    [steps, approvalLimitPositionId, positions],
  )
  const complete = editorComplete(steps, approvalLimitPositionId)
  const headingVerb = readOnly
    ? t('admin.view')
    : editorMode === 'create'
      ? t('admin.createExceptionFor')
      : editorMode === 'customize'
        ? t('admin.customize')
        : t('admin.edit')

  function addStep() {
    setSteps((current) => normalizeEditorSteps([...current, { order: current.length + 1, positionId: '' }], positions))
  }

  function removeStep(order: number) {
    setSteps((current) => normalizeEditorSteps(current
      .filter((step) => step.order !== order)
      .map((step, index) => ({ ...step, order: index + 1 })), positions))
  }

  function changeStep(order: number, positionId: string) {
    setSteps((current) => normalizeEditorSteps(current.map((step) => (
      step.order === order ? { ...step, positionId } : step
    )), positions))
  }

  async function handlePublish() {
    setFeedback(null)
    setSaving(true)
    try {
      const result = await publishRoute({
        scopeUnitId,
        phase,
        approvalLimitPositionId: approvalLimitPositionId ?? '',
        steps: steps.map((step) => ({ order: step.order, positionId: step.positionId })),
      })
      if (!result.published) {
        setFeedback({ key: 'admin.routePublishConflictCount', values: { count: result.conflicts.length } })
        return
      }
      setFeedback({ key: 'admin.routePublished', values: { version: result.versionId } })
      onPublished?.({
        versionId: result.versionId,
        approvalLimitPositionId: approvalLimitPositionId ?? '',
        steps: steps.map((step) => ({ ...step })),
      })
    } catch {
      setFeedback({ key: 'admin.publishFailed' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <section
      data-testid={`route-editor-${scopeUnitId}-${phase}`}
      data-editor-version={seedVersionId ?? ''}
      className="space-y-4 rounded-lg border bg-card p-4"
    >
      <h3 className="text-base font-semibold">{t('admin.routeEditorHeading', { action: headingVerb, name: scopeName, phase })}</h3>

      {!readOnly && editorMode !== 'customize' ? (
        <p data-testid="route-editor-replacement-copy" className="text-sm text-muted-foreground">
          {t('admin.publishReplacementHelp')}
        </p>
      ) : null}
      {editorMode === 'create' && seedScopeName ? (
        <p data-testid="route-editor-seed-copy" className="text-sm text-muted-foreground">
          {t('admin.routeSeeded', { phase, ancestor: seedScopeName, name: scopeName })}
        </p>
      ) : null}
      {editorMode === 'create' && !seedScopeName ? (
        <p data-testid="route-editor-blank-seed" className="text-sm text-muted-foreground">
          {t('admin.routeBlank', { phase, name: scopeName })}
        </p>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor={`route-editor-limit-select-${scopeUnitId}-${phase}`}>{t('admin.approvalLimit')}</Label>
        <Select
          value={approvalLimitPositionId ?? ''}
          onValueChange={setApprovalLimitPositionId}
          disabled={readOnly}
        >
          <SelectTrigger
            id={`route-editor-limit-select-${scopeUnitId}-${phase}`}
            data-testid="route-editor-limit-select"
            className="w-64"
          >
            <SelectValue placeholder={t('admin.selectApprovalLimit')} />
          </SelectTrigger>
          <SelectContent>
            {activePositions.map((position) => (
              <SelectItem key={position.id} value={position.id}>
                {t('admin.positionRank', { name: position.name, rank: position.rank })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {t('admin.aboveApprovalLimit')}
        </p>
      </div>

      <ol className="space-y-2">
        {steps.map((step) => {
          const usedElsewhere = new Set(
            steps.filter((other) => other.order !== step.order).map((other) => other.positionId),
          )
          return (
          <li key={step.order} className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">{t('admin.stepNumber', { order: step.order })}</span>
            <Select
              value={step.positionId}
              onValueChange={(value) => changeStep(step.order, value)}
              disabled={readOnly}
            >
              <SelectTrigger data-testid={`route-editor-step-${step.order}`} className="w-64">
                <SelectValue placeholder={t('admin.selectPosition')} />
              </SelectTrigger>
              <SelectContent>
                {activePositions.map((position) => (
                  <SelectItem
                    key={position.id}
                    value={position.id}
                    disabled={usedElsewhere.has(position.id)}
                  >
                    {t('admin.positionRank', { name: position.name, rank: position.rank })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!readOnly ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid={`route-editor-remove-step-${step.order}`}
                onClick={() => removeStep(step.order)}
              >
                {t('admin.remove')}
              </Button>
            ) : null}
          </li>
          )
          })}
      </ol>

      {!readOnly ? (
        <Button type="button" variant="outline" size="sm" data-testid="route-editor-add-step" onClick={addStep}>
          {t('admin.addApprovalStep')}
        </Button>
      ) : null}

      {conflicts.length > 0 ? (
        <div
          data-testid="route-editor-conflicts"
          role="alert"
          className="space-y-1 rounded-md border border-destructive/40 bg-destructive/5 p-3"
        >
          <p className="text-sm font-medium">
            {t('admin.publishBlocked')}
          </p>
          <ul className="list-disc space-y-1 pl-4 text-sm">
            {conflicts.map((conflict) => (
              <li
                key={`${conflict.order}-${conflict.positionId}`}
                data-testid={`route-editor-conflict-${conflict.order}`}
              >
                {t('admin.stepPosition', { order: conflict.order, name: positionNames.get(conflict.positionId) ?? conflict.positionId })} ({conflict.problem})
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {feedback ? (
        feedback.key === 'admin.routePublished' ? (
          <p role="status" className="text-sm text-muted-foreground">{t(feedback.key, feedback.values)}</p>
        ) : (
          <p role="alert" className="text-sm text-destructive">
            {t(feedback.key, 'values' in feedback ? feedback.values : undefined)}
          </p>
        )
      ) : null}

      {!readOnly ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            data-testid="route-editor-publish"
            disabled={saving || !complete || conflicts.length > 0}
            onClick={() => {
              void handlePublish()
            }}
          >
            {t('admin.publish')}
          </Button>
          <Button
            type="button"
            variant="outline"
            data-testid="route-editor-test-submitter"
            disabled={!complete}
            onClick={() => setShowSubmitterTest(true)}
          >
            {t('admin.testWithSubmitter')}
          </Button>
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">
        {t('admin.publishHelp')}
      </p>

      {showSubmitterTest ? (
        <SubmitterTestDialog
          phase={phase}
          users={users}
          unitNames={unitNames}
          draft={{
            approvalLimitPositionId: approvalLimitPositionId ?? '',
            steps: steps.map((step) => ({ order: step.order, positionId: step.positionId })),
          }}
          onClose={() => setShowSubmitterTest(false)}
        />
      ) : null}
    </section>
  )
}
