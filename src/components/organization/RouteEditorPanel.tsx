'use client'

// Clean-start route editor (Plan C Task 9). Edits a versioned route
// definition for one (scope unit, phase): ordered position-id steps with
// position-name Selects and a named "Approval limit" Select. Lowering the
// limit below a step disables Publish and lists the conflicting steps until
// corrected (B2 findLimitConflicts, mirrored client-side by the exported
// draftLimitConflicts helper); the server refuses the same input with the
// same list and writes nothing. "Test with a submitter" opens the
// SubmitterTestDialog with the CURRENT editor draft (in-memory only).
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
import { publishRoute, saveRouteDraft } from '@/server-actions/approval-routes'
import { SubmitterTestDialog } from '@/components/organization/SubmitterTestDialog'

export interface EditorStep {
  order: number
  positionId: string
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

export function RouteEditorPanel({
  scopeUnitId,
  scopeName,
  phase,
  positions,
  users,
  unitNames = new Map(),
  initial,
  readOnly = false,
  onDraftSaved,
  onPublished,
}: {
  scopeUnitId: string
  scopeName: string
  phase: ApprovalPhase
  positions: readonly PositionNode[]
  users: ReadonlyArray<{ id: string; name: string }>
  unitNames?: ReadonlyMap<string, string>
  initial?: { approvalLimitPositionId: string; steps: ReadonlyArray<EditorStep> } | null
  readOnly?: boolean
  onDraftSaved?: (result: { versionId: string }) => void
  onPublished?: (result: { versionId: string }) => void
}) {
  const [approvalLimitPositionId, setApprovalLimitPositionId] = useState<string | null>(
    initial?.approvalLimitPositionId ?? null,
  )
  const [steps, setSteps] = useState<EditorStep[]>(
    initial ? initial.steps.map((step) => ({ ...step })) : [],
  )
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
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

  function addStep() {
    setSteps((current) => [...current, { order: current.length + 1, positionId: '' }])
  }

  function removeStep(order: number) {
    setSteps((current) => current
      .filter((step) => step.order !== order)
      .map((step, index) => ({ ...step, order: index + 1 })))
  }

  function changeStep(order: number, positionId: string) {
    setSteps((current) => current.map((step) => (
      step.order === order ? { ...step, positionId } : step
    )))
  }

  async function handleSaveDraft() {
    setError(null)
    setNotice(null)
    setSaving(true)
    try {
      const result = await saveRouteDraft({
        scopeUnitId,
        phase,
        approvalLimitPositionId: approvalLimitPositionId ?? '',
        steps: steps.map((step) => ({ order: step.order, positionId: step.positionId })),
      })
      setNotice(`Draft saved (version ${result.versionId})`)
      onDraftSaved?.(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  async function handlePublish() {
    setError(null)
    setNotice(null)
    setSaving(true)
    try {
      const result = await publishRoute({
        scopeUnitId,
        phase,
        approvalLimitPositionId: approvalLimitPositionId ?? '',
        steps: steps.map((step) => ({ order: step.order, positionId: step.positionId })),
      })
      if (!result.published) {
        setError(
          `Publication refused: ${result.conflicts.length} step(s) exceed the approval limit. ` +
          'Correct the flagged steps first.',
        )
        return
      }
      setNotice(`Published (version ${result.versionId})`)
      onPublished?.({ versionId: result.versionId })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section
      data-testid={`route-editor-${scopeUnitId}-${phase}`}
      className="space-y-4 rounded-lg border bg-card p-4"
    >
      <h3 className="text-base font-semibold">{`Customize ${scopeName} — ${phase}`}</h3>

      <div className="space-y-2">
        <Label htmlFor={`route-editor-limit-select-${scopeUnitId}-${phase}`}>Approval limit</Label>
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
            <SelectValue placeholder="Select approval limit position" />
          </SelectTrigger>
          <SelectContent>
            {activePositions.map((position) => (
              <SelectItem key={position.id} value={position.id}>
                {`${position.name} (rank ${position.rank})`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Steps above this position&apos;s rank exceed the limit.
        </p>
      </div>

      <ol className="space-y-2">
        {steps.map((step) => (
          <li key={step.order} className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">{`Step ${step.order}`}</span>
            <Select
              value={step.positionId}
              onValueChange={(value) => changeStep(step.order, value)}
              disabled={readOnly}
            >
              <SelectTrigger data-testid={`route-editor-step-${step.order}`} className="w-64">
                <SelectValue placeholder="Select position" />
              </SelectTrigger>
              <SelectContent>
                {activePositions.map((position) => (
                  <SelectItem key={position.id} value={position.id}>
                    {`${position.name} (rank ${position.rank})`}
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
                Remove
              </Button>
            ) : null}
          </li>
        ))}
      </ol>

      {!readOnly ? (
        <Button type="button" variant="outline" size="sm" data-testid="route-editor-add-step" onClick={addStep}>
          Add approval step
        </Button>
      ) : null}

      {conflicts.length > 0 ? (
        <div
          data-testid="route-editor-conflicts"
          role="alert"
          className="space-y-1 rounded-md border border-destructive/40 bg-destructive/5 p-3"
        >
          <p className="text-sm font-medium">
            Publication is blocked: the steps below exceed the lowered approval limit. Nothing was
            saved — correct the flagged steps first.
          </p>
          <ul className="list-disc space-y-1 pl-4 text-sm">
            {conflicts.map((conflict) => (
              <li
                key={`${conflict.order}-${conflict.positionId}`}
                data-testid={`route-editor-conflict-${conflict.order}`}
              >
                {`Step ${conflict.order} — ${positionNames.get(conflict.positionId) ?? conflict.positionId} (${conflict.problem})`}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-destructive">{error}</p>
      ) : null}
      {notice ? (
        <p role="status" className="text-sm text-muted-foreground">{notice}</p>
      ) : null}

      {!readOnly ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            data-testid="route-editor-save-draft"
            disabled={saving || !complete || conflicts.length > 0}
            onClick={() => {
              void handleSaveDraft()
            }}
          >
            Save draft
          </Button>
          <Button
            type="button"
            data-testid="route-editor-publish"
            disabled={saving || !complete || conflicts.length > 0}
            onClick={() => {
              void handlePublish()
            }}
          >
            Publish
          </Button>
          <Button
            type="button"
            variant="outline"
            data-testid="route-editor-test-submitter"
            disabled={!complete}
            onClick={() => setShowSubmitterTest(true)}
          >
            Test with a submitter
          </Button>
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Publish affects future attempts only. Existing approval attempts keep their captured
        snapshots.
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
