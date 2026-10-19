'use client'

import React, { useEffect, useRef } from 'react'
import { X } from 'lucide-react'

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

/**
 * Modal that stays in the React tree (no portal). Static markup tests and
 * Playwright locators still see the dialog children.
 *
 * The close control lives in the compact title header instead of a detached
 * empty lane. The card owns one bounded scroll region so long forms remain
 * usable while the title and close action stay visible.
 *
 * Accessibility: focus moves into the dialog on open, Tab is contained, and
 * focus returns to the trigger on close. Pass `title`/`titleId` for a visible
 * heading, or `labelledBy`/`ariaLabel` when the child owns the heading.
 */
export function InTreeModal({
  open,
  onClose,
  children,
  testId,
  title,
  titleId,
  labelledBy,
  ariaLabel,
  className = 'max-w-2xl',
  overlayZ = 'z-50',
}: {
  open: boolean
  onClose: () => void
  children: React.ReactNode
  testId?: string
  title?: React.ReactNode
  titleId?: string
  labelledBy?: string
  ariaLabel?: string
  className?: string
  overlayZ?: string
}) {
  const cardRef = useRef<HTMLDivElement>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  const onCloseRef = useRef(onClose)

  // Keep the latest callback available to the one open/close lifecycle effect.
  // Parent panels commonly pass an inline callback; changing it must not tear
  // down the focus trap or restore focus while the modal remains open.
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (!open) return
    restoreFocusRef.current = document.activeElement as HTMLElement | null
    // Initial focus: the close button leads, which is safe and predictable.
    const initialFocus = cardRef.current?.querySelector<HTMLElement>(FOCUSABLE)
    initialFocus?.focus()
    if (!initialFocus) cardRef.current?.focus()

    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        // Nested dismissible controls (for example Radix Select) handle Escape
        // first and mark it prevented; respect that before closing this modal.
        if (event.defaultPrevented) return
        onCloseRef.current()
        return
      }
      const card = cardRef.current
      if (event.key !== 'Tab' || !card) return
      const nodes = Array.from(card.querySelectorAll<HTMLElement>(FOCUSABLE))
        .filter((node) => !node.hasAttribute('disabled'))
      if (nodes.length === 0) return
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      const active = document.activeElement
      if (event.shiftKey && (active === first || !card.contains(active))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      restoreFocusRef.current?.focus?.()
    }
  }, [open])

  if (!open) return null

  const headingId = labelledBy ?? titleId

  return (
    <div
      data-testid={testId}
      className={`fixed inset-0 ${overlayZ} flex items-start justify-center overflow-y-auto overscroll-contain bg-black/80 p-4 sm:items-center`}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        aria-label={headingId ? undefined : ariaLabel}
        tabIndex={-1}
        className={`relative my-4 flex max-h-[calc(100dvh-2rem)] w-full flex-col overflow-hidden rounded-lg border bg-card text-card-foreground shadow-xl sm:my-6 ${className}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div
          data-testid="modal-header"
          className="flex shrink-0 items-start justify-between gap-4 border-b bg-card px-6 py-4"
        >
          {title ? (
            <h2 id={titleId ?? labelledBy} className="min-w-0 flex-1 truncate text-base font-semibold leading-6">
              {title}
            </h2>
          ) : labelledBy ? null : (
            <h2 className="sr-only">{ariaLabel ?? 'Dialog'}</h2>
          )}
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {children}
        </div>
      </div>
    </div>
  )
}
