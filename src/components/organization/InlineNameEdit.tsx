'use client'

import React, { useEffect, useId, useRef, useState } from 'react'
import { Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

/**
 * epoch is the current editor identity. pendingEpoch is the in-flight save's
 * epoch, or null. saveQueued records a submit intent (Enter or blur) that
 * arrived while a save was in flight: the component serializes it as ONE
 * follow-up save of the LATEST draft after the in-flight save settles —
 * success or failure — so a blurred newer draft is never silently dropped.
 * Escape clears the queue and teardown never flushes it; an already-issued
 * server write is outside our control and is never "canceled". Pending keeps
 * the input enabled so the user can type or Escape; stale completions must
 * not restore a canceled editor or overwrite newer input. A second Enter OR
 * blur while pendingEpoch !== null only (re)sets the same queue flag, so an
 * Enter save followed by the input's blur (outside click or Tab) never
 * writes twice. Blur on an unchanged draft just closes the editor — an
 * unchanged value is never written.
 */
export type InlineNameEditSession = {
  original: string
  draft: string
  error: string | null
  editing: boolean
  epoch: number
  pendingEpoch: number | null
  saveQueued: boolean
}

function idleSession(original: string, epoch = 0): InlineNameEditSession {
  return { original, draft: original, error: null, editing: false, epoch, pendingEpoch: null, saveQueued: false }
}

export function startInlineNameEdit(original: string, priorEpoch = 0): InlineNameEditSession {
  return { original, draft: original, error: null, editing: true, epoch: priorEpoch + 1, pendingEpoch: null, saveQueued: false }
}

export function typeInlineNameEdit(session: InlineNameEditSession, draft: string): InlineNameEditSession {
  if (session.pendingEpoch !== null) {
    return { ...session, draft, epoch: session.epoch + 1 }
  }
  return { ...session, draft }
}

export function cancelInlineNameEdit(session: InlineNameEditSession): InlineNameEditSession {
  return idleSession(session.original, session.epoch + 1)
}

export async function submitInlineNameEdit(
  session: InlineNameEditSession,
  onSave: (next: string) => Promise<void>,
): Promise<InlineNameEditSession> {
  const next = session.draft.trim()
  try {
    await onSave(next)
    return { original: next, draft: next, error: null, editing: false, epoch: session.epoch, pendingEpoch: session.pendingEpoch, saveQueued: false }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    return { ...session, error, editing: true }
  }
}

export function handleInlineNameEditKeyDown(
  session: InlineNameEditSession,
  key: string,
): { session: InlineNameEditSession; submit: boolean } {
  if (key === 'Escape') {
    return { session: cancelInlineNameEdit(session), submit: false }
  }
  if (key !== 'Enter') {
    return { session, submit: false }
  }
  return requestInlineNameEditSubmit(session)
}

/**
 * Shared save decision for Enter and blur (outside click or Tab). Only an
 * editing session with no save in flight may submit; an unchanged trimmed
 * draft closes the editor without calling onSave. While a save is in flight
 * the intent is QUEUED (one deduplicated flag) instead of dropped, so the
 * serialized follow-up submits the latest draft after the in-flight save
 * settles; anything else is a no-op, so Escape (which leaves editing=false)
 * can never be followed by a blur resave.
 */
export function requestInlineNameEditSubmit(
  session: InlineNameEditSession,
): { session: InlineNameEditSession; submit: boolean } {
  if (!session.editing) {
    return { session, submit: false }
  }
  if (session.pendingEpoch !== null) {
    return { session: { ...session, saveQueued: true }, submit: false }
  }
  if (session.draft.trim() === session.original) {
    return { session: cancelInlineNameEdit(session), submit: false }
  }
  return { session: { ...session, pendingEpoch: session.epoch, saveQueued: false }, submit: true }
}

/**
 * Consumes the queued submit intent and turns it into the follow-up request
 * against the LATEST session; the component calls this once an in-flight
 * save has settled (success or failure). The queue dies with the editor:
 * cancelInlineNameEdit (Escape) never leaves it set, and teardown never
 * reaches this flush.
 */
export function takeQueuedInlineNameEditSubmit(
  session: InlineNameEditSession,
): { session: InlineNameEditSession; submit: boolean } {
  if (!session.saveQueued || session.pendingEpoch !== null) {
    return { session, submit: false }
  }
  return requestInlineNameEditSubmit({ ...session, saveQueued: false })
}

export function applyInlineNameEditResult(
  session: InlineNameEditSession,
  epoch: number,
  result: InlineNameEditSession,
): InlineNameEditSession {
  if (session.pendingEpoch !== epoch) return session
  if (session.epoch !== epoch) {
    // A newer draft exists: never reopen or overwrite it. A success (the
    // result closed the editor) must still reconcile the persisted baseline —
    // the server now holds the saved name — so the queued follow-up compares
    // the draft against reality instead of a stale original; a failure
    // persisted nothing, so only the in-flight slot is cleared.
    if (!result.editing) {
      return { ...session, original: result.original, error: null, pendingEpoch: null }
    }
    return { ...session, pendingEpoch: null }
  }
  return { ...result, epoch: session.epoch, pendingEpoch: null, saveQueued: false }
}

export function InlineNameEditView({
  session,
  errorId,
  disabled,
  onStart,
  onDraftChange,
  onKeyDown,
  onBlur,
}: {
  session: InlineNameEditSession
  errorId: string
  disabled?: boolean
  onStart: () => void
  onDraftChange: (draft: string) => void
  onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void
  onBlur: () => void
}) {
  if (!session.editing) {
    return (
      <span data-testid="inline-name-edit" className="inline-flex items-center gap-1">
        <span>{session.original}</span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 min-h-7 min-w-7"
          aria-label="Rename"
          data-testid="inline-name-edit-pencil"
          disabled={disabled}
          onClick={onStart}
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      </span>
    )
  }

  return (
    <span data-testid="inline-name-edit" className="inline-flex flex-wrap items-center gap-1">
      <Input
        data-testid="inline-name-edit-input"
        value={session.draft}
        onChange={(event) => onDraftChange(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
        aria-invalid={session.error ? true : undefined}
        aria-describedby={session.error ? errorId : undefined}
        disabled={disabled}
        className="h-8 min-h-8 w-auto max-w-xs"
      />
      {session.error ? (
        <span
          id={errorId}
          role="alert"
          data-testid="inline-name-edit-error"
          className="text-sm text-destructive"
        >
          {session.error}
        </span>
      ) : null}
    </span>
  )
}

export function InlineNameEdit(props: {
  value: string
  onSave: (next: string) => Promise<void>
  disabled?: boolean
}): React.JSX.Element {
  const errorId = useId()
  const [session, setSession] = useState<InlineNameEditSession>(() => idleSession(props.value))
  const sessionRef = useRef(session)
  sessionRef.current = session
  // Entity teardown (row unmount) invalidates queued follow-up work: a settle
  // that lands after unmount must never issue a NEW save. Already-issued
  // server writes are outside our control and are not "canceled".
  const aliveRef = useRef(true)
  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  function commit(next: InlineNameEditSession) {
    sessionRef.current = next
    setSession(next)
  }

  function startSave(request: { session: InlineNameEditSession; submit: boolean }) {
    commit(request.session)
    if (!request.submit) return
    const epoch = request.session.epoch
    void submitInlineNameEdit(request.session, props.onSave).then((result) => {
      commit(applyInlineNameEditResult(sessionRef.current, epoch, result))
      flushQueuedSave()
    })
  }

  // Enter, blur, and the serialized follow-up all funnel through the same
  // request: one decision function, one in-flight save, no duplicate writes
  // and no unchanged-value writes.
  function runSave() {
    startSave(requestInlineNameEditSubmit(sessionRef.current))
  }

  // Serialized follow-up (review P1): a submit intent that arrived while a
  // save was in flight runs once that save settles — success OR failure —
  // against the latest draft, with no second focus/blur required. Escape
  // already cleared the queue (cancel), and teardown leaves this a no-op.
  function flushQueuedSave() {
    if (!aliveRef.current) return
    startSave(takeQueuedInlineNameEditSubmit(sessionRef.current))
  }

  useEffect(() => {
    const current = sessionRef.current
    if (current.editing) return
    if (current.original === props.value) return
    commit(idleSession(props.value, current.epoch))
  }, [props.value])

  return (
    <InlineNameEditView
      session={session}
      errorId={errorId}
      disabled={props.disabled}
      onStart={() => {
        if (props.disabled) return
        const current = sessionRef.current
        commit(startInlineNameEdit(current.original, current.epoch))
      }}
      onDraftChange={(draft) => {
        commit(typeInlineNameEdit(sessionRef.current, draft))
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          runSave()
        } else if (event.key === 'Escape') {
          event.preventDefault()
          commit(handleInlineNameEditKeyDown(sessionRef.current, 'Escape').session)
        }
      }}
      onBlur={runSave}
    />
  )
}
