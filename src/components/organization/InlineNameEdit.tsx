'use client'

import React, { useEffect, useId, useState } from 'react'
import { Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export type InlineNameEditSession = {
  original: string
  draft: string
  error: string | null
  editing: boolean
}

export function startInlineNameEdit(original: string): InlineNameEditSession {
  return { original, draft: original, error: null, editing: true }
}

export function typeInlineNameEdit(session: InlineNameEditSession, draft: string): InlineNameEditSession {
  return { ...session, draft }
}

export function cancelInlineNameEdit(session: InlineNameEditSession): InlineNameEditSession {
  return { original: session.original, draft: session.original, error: null, editing: false }
}

export async function submitInlineNameEdit(
  session: InlineNameEditSession,
  onSave: (next: string) => Promise<void>,
): Promise<InlineNameEditSession> {
  const next = session.draft.trim()
  try {
    await onSave(next)
    return { original: next, draft: next, error: null, editing: false }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    return { ...session, error, editing: true }
  }
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
  const [session, setSession] = useState<InlineNameEditSession>({
    original: props.value,
    draft: props.value,
    error: null,
    editing: false,
  })

  useEffect(() => {
    setSession((current) => {
      if (current.editing) return current
      if (current.original === props.value) return current
      return { original: props.value, draft: props.value, error: null, editing: false }
    })
  }, [props.value])

  return (
    <InlineNameEditView
      session={session}
      errorId={errorId}
      disabled={props.disabled}
      onStart={() => {
        if (props.disabled) return
        setSession((current) => startInlineNameEdit(current.original))
      }}
      onDraftChange={(draft) => {
        setSession((current) => typeInlineNameEdit(current, draft))
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          void submitInlineNameEdit(session, props.onSave).then(setSession)
        } else if (event.key === 'Escape') {
          event.preventDefault()
          setSession((current) => cancelInlineNameEdit(current))
        }
      }}
    />
  )
}
