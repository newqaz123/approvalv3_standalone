'use client'

// Add a sub-unit straight from the organization tree: a "+ Add unit" button
// below the hovered unit card opens a small popover asking for the name only
// — the parent is the card the admin is already looking at. Calls the SAME
// createOrganizationUnit action as the header Create unit dialog; that action
// revalidates /admin/organization, so the new card arrives without a router
// refresh (and this component stays renderable outside the app router).

import React, { useId, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { createOrganizationUnit } from '@/server-actions/organization'
import { useTranslations } from '@/lib/i18n/client'

/** Presentational form body so pending/error states stay SSR-testable. */
export function AddChildUnitFormView({
  parentName,
  name,
  error,
  saving,
  onNameChange,
  onSave,
  onCancel,
}: {
  parentName: string
  name: string
  error: string | null
  saving: boolean
  onNameChange?: (name: string) => void
  onSave?: () => void
  onCancel?: () => void
}): React.JSX.Element {
  const t = useTranslations()
  const inputId = useId()
  const ready = name.trim().length > 0
  return (
    <form
      data-testid="add-child-unit-form"
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault()
        if (!ready || saving) return
        onSave?.()
      }}
    >
      <p className="break-words text-sm font-medium">{t('admin.newChildUnder')} {parentName}</p>
      <div className="space-y-2">
        <Label htmlFor={inputId}>{t('admin.unitName')}</Label>
        <Input
          id={inputId}
          data-testid="add-child-unit-name-input"
          value={name}
          autoComplete="off"
          onChange={(event) => onNameChange?.(event.target.value)}
        />
      </div>
      {error ? (
        <p role="alert" data-testid="add-child-unit-error" className="break-words text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" data-testid="add-child-unit-save" disabled={saving || !ready}>
          {t('admin.create')}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="add-child-unit-cancel"
          disabled={saving}
          onClick={onCancel}
        >
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  )
}

export function AddChildUnitPopover({
  unit,
  open,
  onOpenChange,
  onCreated,
  restoreFocusRef,
}: {
  unit: { id: string; name: string }
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated?: () => void
  /** A visible, focusable element on the unit card (its header). */
  restoreFocusRef?: React.RefObject<HTMLElement | null>
}): React.JSX.Element {
  const t = useTranslations()
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  // Synchronous guard: a second Enter can land before the saving state
  // re-renders the disabled button.
  const savingRef = useRef(false)
  // One editing session per open popover. Dismissing never waits on the
  // server: closing starts a new session, and a request from an abandoned
  // session may no longer touch the form.
  const sessionRef = useRef(0)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const interactedOutsideRef = useRef(false)

  function handleOpenChange(next: boolean) {
    if (next) {
      interactedOutsideRef.current = false
    } else {
      sessionRef.current += 1
      savingRef.current = false
      setSaving(false)
      setName('')
      setError(null)
    }
    onOpenChange(next)
  }

  async function handleSave() {
    const trimmed = name.trim()
    if (trimmed.length === 0 || savingRef.current) return
    const session = sessionRef.current
    savingRef.current = true
    setSaving(true)
    setError(null)
    try {
      await createOrganizationUnit({ name: trimmed, parentId: unit.id })
    } catch (err) {
      if (session !== sessionRef.current) return
      // Failure keeps the typed name so the admin can correct it.
      savingRef.current = false
      setSaving(false)
      setError(t('admin.createUnitFailed'))
      return
    }
    // The unit exists even if the admin dismissed the popover meanwhile.
    onCreated?.()
    if (session === sessionRef.current) handleOpenChange(false)
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      {/* Out of flow (see .organization-unit-add-child in globals.css):
          revealing the button never shifts cards or connector lines. */}
      <div
        data-testid={`unit-add-child-slot-${unit.id}`}
        data-open={String(open)}
        className="organization-unit-add-child"
      >
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            ref={triggerRef}
            data-testid={`unit-add-child-${unit.id}`}
            className="h-6 min-h-6 rounded-full bg-background px-2.5 text-xs"
          >
            {t('admin.addUnitPlus')}
          </Button>
        </PopoverTrigger>
      </div>
      {/* The popover positions against this always-laid-out point, not the
          button: the button is display:none on touch devices, where the
          overflow menu opens the same popover. */}
      <PopoverAnchor asChild>
        <span
          aria-hidden="true"
          data-testid={`unit-add-child-anchor-${unit.id}`}
          className="organization-unit-add-child-anchor"
        />
      </PopoverAnchor>
      <PopoverContent
        side="bottom"
        align="center"
        className="w-72"
        onInteractOutside={() => {
          interactedOutsideRef.current = true
        }}
        onCloseAutoFocus={(event) => {
          // Radix would refocus the trigger, but by now the button is hidden
          // again (pointer away, or a touch device) and focus would fall to
          // the page body. Focusing the card first re-reveals the button via
          // :focus-within; where it stays hidden, focus rests on the card.
          event.preventDefault()
          if (interactedOutsideRef.current) return
          restoreFocusRef?.current?.focus()
          triggerRef.current?.focus()
        }}
      >
        <AddChildUnitFormView
          parentName={unit.name}
          name={name}
          error={error}
          saving={saving}
          onNameChange={setName}
          onSave={() => {
            void handleSave()
          }}
          onCancel={() => handleOpenChange(false)}
        />
      </PopoverContent>
    </Popover>
  )
}
