'use client'

// Clean-start "Test with a submitter" dialog (Plan C Task 9). Resolves the
// ACTUAL candidate people a future attempt would snapshot — without
// creating requests, saving snapshots, or publishing anything (the server
// action testWithSubmitter is read-only; its db port has no write method).
// Shows source, per-step candidates, skipped reasons, auto-approval and
// no-eligible outcomes exactly as the spec requires.

import React, { useState } from 'react'
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
import { testWithSubmitter } from '@/server-actions/approval-routes'
import type { SubmitterTestResult } from '@/server-actions/approval-routes'
import type { Translator } from '@/lib/i18n/messages'
import { useTranslations } from '@/lib/i18n/client'

function submitterSourceLabel(
  t: Translator,
  source: SubmitterTestResult['source'],
  unitNames: ReadonlyMap<string, string>,
  scopeUnitId: string,
): string {
  if (source === 'ROOT_DEFAULT') return t('admin.usesCompanyDefault')
  if (source === 'CUSTOM') return t('admin.customAtUnit')
  if (source === 'DRAFT') {
    return t('admin.submitterDraftSource', { name: unitNames.get(scopeUnitId) ?? scopeUnitId })
  }
  return t('admin.inheritedFrom', { name: unitNames.get(scopeUnitId) ?? scopeUnitId })
}

/**
 * Read-only rendering of a testWithSubmitter result. Exported so tests (and
 * future callers) can render a result without running the dialog flow.
 */
export function SubmitterTestResultView({
  result,
  unitNames,
}: {
  result: SubmitterTestResult
  unitNames: ReadonlyMap<string, string>
}) {
  const t = useTranslations()
  return (
    <div data-testid="submitter-test-result" className="space-y-3 rounded-md border p-3">
      <p data-testid="submitter-test-source" className="text-sm">
        {submitterSourceLabel(t, result.source, unitNames, result.scopeUnitId)}
        {result.routeVersionId === 'DRAFT' ? t('admin.unsavedDraft') : ''}
      </p>
      {result.autoApproved ? (
        <p data-testid="submitter-test-auto-approved" className="text-sm">
          {t('admin.submitterAutoApproved')}
        </p>
      ) : null}
      {result.noEligibleSteps ? (
        <p data-testid="submitter-test-no-eligible" className="text-sm">
          {t('admin.submitterVacantSteps')}
        </p>
      ) : null}
      <ol className="space-y-2">
        {result.steps.map((step) => (
          <li
            key={`${step.order}-${step.requiredPositionId}`}
            data-testid={`submitter-test-step-${step.order}`}
            className="space-y-1 rounded-md border px-3 py-2"
          >
            <p className="text-sm font-medium">{t('admin.stepPosition', { order: step.order, name: step.positionName })}</p>
            {step.skipped ? (
              <p className="text-sm text-muted-foreground" data-testid={`submitter-test-skip-${step.order}`}>
                {t('admin.submitterSkippedStep', { reason: step.skipReason ?? 'VACANT_POSITION' })}
              </p>
            ) : (
              <ul className="list-disc space-y-1 pl-4 text-sm">
                {step.candidates.map((candidate) => (
                  <li
                    key={candidate.id}
                    data-testid={`submitter-test-candidate-${step.order}-${candidate.id}`}
                  >
                    {candidate.name}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ol>
    </div>
  )
}

export function SubmitterTestDialog({
  phase,
  users,
  draft,
  unitNames = new Map(),
  onClose,
}: {
  phase: ApprovalPhase
  users: ReadonlyArray<{ id: string; name: string }>
  draft?: {
    approvalLimitPositionId: string
    steps: ReadonlyArray<{ order: number; positionId: string }>
  }
  unitNames?: ReadonlyMap<string, string>
  onClose?: () => void
}) {
  const t = useTranslations()
  const [submitterUserId, setSubmitterUserId] = useState('')
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<SubmitterTestResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    setError(null)
    setResult(null)
    setRunning(true)
    try {
      setResult(await testWithSubmitter({
        submitterUserId,
        phase,
        ...(draft ? { draft } : {}),
      }))
    } catch (err) {
      setError(t('admin.submitterTestFailed'))
    } finally {
      setRunning(false)
    }
  }

  return (
    <section
      data-testid="submitter-test-dialog"
      className="space-y-3 rounded-lg border bg-card p-4"
    >
      <h3 className="text-base font-semibold">{t('admin.testWithSubmitter')}</h3>
      <p className="text-sm text-muted-foreground">
        {t('admin.testWithSubmitterHelp')}
      </p>
      <div className="space-y-2">
        <Label htmlFor="submitter-test-user-select">{t('admin.submitter')}</Label>
        <Select value={submitterUserId} onValueChange={setSubmitterUserId}>
          <SelectTrigger id="submitter-test-user-select" data-testid="submitter-test-user-select" className="w-64">
            <SelectValue placeholder={t('admin.selectSubmitter')} />
          </SelectTrigger>
          <SelectContent>
            {users.map((user) => (
              <SelectItem key={user.id} value={user.id}>
                {user.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          data-testid="submitter-test-run"
          disabled={running || submitterUserId.length === 0}
          onClick={() => {
            void run()
          }}
        >
          {t('admin.runTest')}
        </Button>
        {onClose ? (
          <Button
            type="button"
            variant="outline"
            data-testid="submitter-test-close"
            onClick={onClose}
          >
            {t('admin.close')}
          </Button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">{error}</p>
      ) : null}
      {result ? <SubmitterTestResultView result={result} unitNames={unitNames} /> : null}
    </section>
  )
}
