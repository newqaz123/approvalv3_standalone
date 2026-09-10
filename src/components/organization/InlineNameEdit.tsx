'use client'

import React, { useEffect, useId, useRef, useState } from 'react'
import { Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

/**
 * epoch is the current editor identity. pendingEpoch is the in-flight save's
 * epoch, or null. Pending keeps the input enabled so the user can type or
 * Escape; stale completions must not restore a canceled editor or overwrite
 * newer input. Duplicate Enter is ignored while pendingEpoch !== null.
 */
export type InlineNameEditSession = {
  original: string
  draft: string
  error: string | null
  editing: boolean
  epoch: number
  pendingEpoch: number | null
}

function idleSession(original: string, epoch = 0): InlineNameEditSession {
  return { original, draft: original, error: null, editing: false, epoch, pendingEpoch: null }
}

export function startInlineNameEdit(original: string, priorEpoch = 0): InlineNameEditSession {
  return { original, draft: original, error: null, editing: true, epoch: priorEpoch + 1, pendingEpoch: null }
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
    return { original: next, draft: next, error: null, editing: false, epoch: session.epoch, pendingEpoch: session.pendingEpoch }
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
  if (key !== 'Enter' || !session.editing || session.pendingEpoch !== null) {
    return { session, submit: false }
  }
  return { session: { ...session, pendingEpoch: session.epoch }, submit: true }
}

export function applyInlineNameEditResult(
  session: InlineNameEditSession,
  epoch: number,
  result: InlineNameEditSession,
): InlineNameEditSession {
  if (session.pendingEpoch !== epoch) return session
  if (session.epoch !== epoch) {
    return { ...session, pendingEpoch: null }
  }
  return { ...result, epoch: session.epoch, pendingEpoch: null }
}

export function InlineNameEditView({
  session,
  errorId,
  disabled,
  onStart,
  onDraftChange,
  onKeyDown,
}: {
  session: InlineNameEditSession
  errorId: string
  disabled?: boolean
  onStart: () => void
  onDraftChange: (draft: string) => void
  onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void
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

  function commit(next: InlineNameEditSession) {
    sessionRef.current = next
    setSession(next)
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
          const next = handleInlineNameEditKeyDown(sessionRef.current, 'Enter')
          commit(next.session)
          if (!next.submit) return
          const epoch = next.session.epoch
          void submitInlineNameEdit(next.session, props.onSave).then((result) => {
            commit(applyInlineNameEditResult(sessionRef.current, epoch, result))
          })
        } else if (event.key === 'Escape') {
          event.preventDefault()
          commit(handleInlineNameEditKeyDown(sessionRef.current, 'Escape').session)
        }
      }}
    />
  )
}
