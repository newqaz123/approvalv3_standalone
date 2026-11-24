'use client'

// Clean-start RestartAttemptDialog (Plan C Task 9): wraps the B7 admin-only
// stranded-attempt restart with the required reason textarea. It first
// loads the read-only replacement-chain preview (previewReplacementChain),
// then — only after a non-empty trimmed reason is entered — restarts via
// restartStrandedAttempt. Restart itself grants nothing: it supersedes the
// old attempt and creates a new one from current organization settings;
// the old attempt and its decisions are preserved.

import React, { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { previewReplacementChain, restartStrandedAttempt } from '@/server-actions/approvals'
import type { ReplacementChainPreview } from '@/server-actions/approvals'
import { useTranslations } from '@/lib/i18n/client'

/** The restart reason is required: trimmed non-empty text. */
export function restartReasonValid(reason: string): boolean {
  return reason.trim().length > 0
}

export type RestartConfirmState = {
  reason: string
  instanceId: string
  preview: ReplacementChainPreview | null
  previewInstanceId: string | null
  loading: boolean
  restarting: boolean
  restarted: boolean
}

/** Preview is usable only when it belongs to the current instance and has loaded. */
export function restartPreviewReady(state: {
  instanceId: string
  preview: ReplacementChainPreview | null
  previewInstanceId: string | null
  loading: boolean
}): boolean {
  return (
    state.loading === false
    && state.preview !== null
    && state.previewInstanceId === state.instanceId
  )
}

/** Confirm is enabled only with a valid reason and a current-instance preview. */
export function restartConfirmEnabled(state: RestartConfirmState): boolean {
  return (
    restartPreviewReady(state)
    && restartReasonValid(state.reason)
    && state.restarting === false
    && state.restarted === false
  )
}

/** Handler must not call restart unless confirm would be enabled. */
export function canSubmitRestart(state: RestartConfirmState): boolean {
  return restartConfirmEnabled(state)
}

/** Drop any prior preview when the stranded instance identity changes. */
export function restartPreviewAfterInstanceChange(): {
  preview: null
  previewInstanceId: null
  loading: true
  error: null
  restarted: false
} {
  return {
    preview: null,
    previewInstanceId: null,
    loading: true,
    error: null,
    restarted: false,
  }
}

export function ReplacementChainPreviewView({
  preview,
}: {
  preview: ReplacementChainPreview
}) {
  const t = useTranslations()
  return (
    <div data-testid="restart-preview" className="space-y-2 rounded-md border p-3">
      <p className="text-sm font-medium">{t('admin.replacementPreview')}</p>
      <p className="text-sm text-muted-foreground">
        {t('admin.restartPreviewHelp', { phase: preview.phase })}
      </p>
      {preview.autoApproved ? (
        <p className="text-sm" data-testid="restart-preview-auto-approved">
          {t('admin.restartAutoApproved')}
        </p>
      ) : null}
      <ol className="space-y-1">
        {preview.steps.map((step) => (
          <li
            key={`${step.order}-${step.requiredPositionId}`}
            data-testid={`restart-preview-step-${step.order}`}
            className="text-sm"
          >
            {step.skipped
              ? t('admin.vacantStep', { order: step.order })
              : t('admin.stepPosition', { order: step.order, name: step.candidates.map(candidate => candidate.name).join(', ') })}
          </li>
        ))}
      </ol>
    </div>
  )
}

export function RestartAttemptDialogView({
  instanceId,
  reason,
  preview,
  previewInstanceId,
  loading,
  error,
  restarting,
  restarted,
  onReasonChange,
  onRestart,
  onClose,
}: {
  instanceId: string
  reason: string
  preview: ReplacementChainPreview | null
  previewInstanceId: string | null
  loading: boolean
  error: string | null
  restarting: boolean
  restarted: boolean
  onReasonChange?: (reason: string) => void
  onRestart?: () => void
  onClose?: () => void
}) {
  const t = useTranslations()
  const confirmEnabled = restartConfirmEnabled({
    reason,
    instanceId,
    preview,
    previewInstanceId,
    loading,
    restarting,
    restarted,
  })
  return (
    <section
      data-testid="restart-attempt-dialog"
      className="space-y-3 rounded-lg border bg-card p-4"
    >
      <h3 className="text-base font-semibold">{t('admin.restartStranded')}</h3>
      <p className="text-sm text-muted-foreground">
        {t('admin.restartStrandedHelp')}
      </p>
      {loading ? (
        <p className="text-sm text-muted-foreground">{t('admin.loadingReplacement')}</p>
      ) : null}
      {preview && previewInstanceId === instanceId ? (
        <ReplacementChainPreviewView preview={preview} />
      ) : null}
      <div className="space-y-2">
        <Label htmlFor="restart-reason-input">
          {t('admin.reasonRequired')}
        </Label>
        <Textarea
          id="restart-reason-input"
          data-testid="restart-reason-input"
          value={reason}
          onChange={(event) => onReasonChange?.(event.target.value)}
          placeholder={t('admin.restartReasonPlaceholder')}
          className="min-h-20"
        />
        {!restartReasonValid(reason) ? (
          <p className="text-xs text-muted-foreground">{t('admin.restartReasonRequired')}</p>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">{error}</p>
      ) : null}
      {restarted ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t('admin.restartSucceeded')}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          data-testid="restart-confirm"
          disabled={!confirmEnabled}
          onClick={() => {
            onRestart?.()
          }}
        >
          {t('admin.restartAttempt')}
        </Button>
        {onClose ? (
          <Button type="button" variant="outline" data-testid="restart-close" onClick={onClose}>
            {t('admin.close')}
          </Button>
        ) : null}
      </div>
    </section>
  )
}

export function RestartAttemptDialog({
  instanceId,
  onClose,
  onRestarted,
  loadPreview = previewReplacementChain,
  runRestart = restartStrandedAttempt,
}: {
  instanceId: string
  unitNames?: ReadonlyMap<string, string>
  onClose?: () => void
  onRestarted?: (result: { oldInstanceId: string; newInstanceId: string }) => void
  loadPreview?: (input: { instanceId: string }) => Promise<ReplacementChainPreview>
  runRestart?: (input: { instanceId: string; reason: string }) => Promise<{
    oldInstanceId: string
    newInstanceId: string
  }>
}) {
  const [preview, setPreview] = useState<ReplacementChainPreview | null>(null)
  const [previewInstanceId, setPreviewInstanceId] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(true)
  const [restarting, setRestarting] = useState(false)
  const t = useTranslations()
  const [error, setError] = useState<string | null>(null)
  const [restarted, setRestarted] = useState(false)

  useEffect(() => {
    let cancelled = false
    const reset = restartPreviewAfterInstanceChange()
    setPreview(reset.preview)
    setPreviewInstanceId(reset.previewInstanceId)
    setLoading(reset.loading)
    setError(reset.error)
    setRestarted(reset.restarted)
    loadPreview({ instanceId })
      .then((result) => {
        if (cancelled) return
        setPreview(result)
        setPreviewInstanceId(instanceId)
        setError(null)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setPreview(null)
        setPreviewInstanceId(null)
        setError(t('admin.restartPreviewFailed'))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [instanceId, loadPreview])

  async function handleRestart() {
    if (!canSubmitRestart({
      reason,
      instanceId,
      preview,
      previewInstanceId,
      loading,
      restarting,
      restarted,
    })) {
      return
    }
    setError(null)
    setRestarting(true)
    try {
      const result = await runRestart({ instanceId, reason })
      setRestarted(true)
      onRestarted?.(result)
    } catch (err) {
      setError(t('admin.restartFailed'))
    } finally {
      setRestarting(false)
    }
  }

  return (
    <RestartAttemptDialogView
      instanceId={instanceId}
      reason={reason}
      preview={preview}
      previewInstanceId={previewInstanceId}
      loading={loading}
      error={error}
      restarting={restarting}
      restarted={restarted}
      onReasonChange={setReason}
      onRestart={() => {
        void handleRestart()
      }}
      onClose={onClose}
    />
  )
}
