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

/** The restart reason is required: trimmed non-empty text. */
export function restartReasonValid(reason: string): boolean {
  return reason.trim().length > 0
}

export function ReplacementChainPreviewView({
  preview,
}: {
  preview: ReplacementChainPreview
}) {
  return (
    <div data-testid="restart-preview" className="space-y-2 rounded-md border p-3">
      <p className="text-sm font-medium">Replacement chain preview</p>
      <p className="text-sm text-muted-foreground">
        {`Built from current organization settings (attempt phase ${preview.phase}). Restart creates a new attempt; it grants no approval.`}
      </p>
      {preview.autoApproved ? (
        <p className="text-sm" data-testid="restart-preview-auto-approved">
          The new attempt would be auto-approved (origin at or above the limit).
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
              ? `Step ${step.order} — skipped (vacant)`
              : `Step ${step.order} — ${step.candidates.map((candidate) => candidate.name).join(', ')}`}
          </li>
        ))}
      </ol>
    </div>
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
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(true)
  const [restarting, setRestarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [restarted, setRestarted] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    loadPreview({ instanceId })
      .then((result) => {
        if (!cancelled) setPreview(result)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [instanceId, loadPreview])

  async function handleRestart() {
    setError(null)
    setRestarting(true)
    try {
      const result = await runRestart({ instanceId, reason })
      setRestarted(true)
      onRestarted?.(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRestarting(false)
    }
  }

  return (
    <section
      data-testid="restart-attempt-dialog"
      className="space-y-3 rounded-lg border bg-card p-4"
    >
      <h3 className="text-base font-semibold">Restart stranded attempt</h3>
      <p className="text-sm text-muted-foreground">
        Only application admins may restart an attempt whose saved approvers are all inactive. A
        reason is required; the old attempt and its decisions are preserved and a new attempt is
        created from current organization settings. Restart itself grants no approval.
      </p>
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading replacement chain preview…</p>
      ) : null}
      {preview ? <ReplacementChainPreviewView preview={preview} /> : null}
      <div className="space-y-2">
        <Label htmlFor="restart-reason-input">
          Reason (required)
        </Label>
        <Textarea
          id="restart-reason-input"
          data-testid="restart-reason-input"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Why this stranded attempt is being restarted"
          className="min-h-20"
        />
        {!restartReasonValid(reason) ? (
          <p className="text-xs text-muted-foreground">A reason is required before restarting.</p>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">{error}</p>
      ) : null}
      {restarted ? (
        <p role="status" className="text-sm text-muted-foreground">
          Restarted. The old attempt is preserved as history.
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          data-testid="restart-confirm"
          disabled={restarting || restarted || !restartReasonValid(reason)}
          onClick={() => {
            void handleRestart()
          }}
        >
          Restart attempt
        </Button>
        {onClose ? (
          <Button type="button" variant="outline" data-testid="restart-close" onClick={onClose}>
            Close
          </Button>
        ) : null}
      </div>
    </section>
  )
}
