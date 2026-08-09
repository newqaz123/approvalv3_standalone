'use client'

import * as React from 'react'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

export function wrapSelectionWithBold(
  value: string,
  selectionStart: number,
  selectionEnd: number,
): { value: string; selectionStart: number; selectionEnd: number } {
  const start = Math.max(0, Math.min(selectionStart, selectionEnd, value.length))
  const end = Math.max(0, Math.min(Math.max(selectionStart, selectionEnd), value.length))
  const before = value.slice(0, start)
  const selected = value.slice(start, end)
  const after = value.slice(end)

  if (start === end) {
    return {
      value: `${before}****${after}`,
      selectionStart: start + 2,
      selectionEnd: start + 2,
    }
  }

  return {
    value: `${before}**${selected}**${after}`,
    selectionStart: start + 2,
    selectionEnd: end + 2,
  }
}

export type FormattedTextareaProps = React.ComponentProps<'textarea'> & {
  toolbarClassName?: string
}

export const FormattedTextarea = React.forwardRef<HTMLTextAreaElement, FormattedTextareaProps>(
  ({ className, toolbarClassName, disabled, readOnly, onChange, value, ...props }, ref) => {
    const textareaRef = React.useRef<HTMLTextAreaElement | null>(null)
    const pendingSelectionRef = React.useRef<{ start: number; end: number } | null>(null)

    const setRefs = React.useCallback(
      (node: HTMLTextAreaElement | null) => {
        textareaRef.current = node
        if (typeof ref === 'function') {
          ref(node)
        } else if (ref) {
          ref.current = node
        }
      },
      [ref],
    )

    const restoreSelection = React.useCallback(() => {
      const pending = pendingSelectionRef.current
      const el = textareaRef.current
      if (!pending || !el) {
        return
      }

      el.focus()
      el.setSelectionRange(pending.start, pending.end)
      pendingSelectionRef.current = null
    }, [])

    React.useLayoutEffect(() => {
      restoreSelection()
    }, [value, restoreSelection])

    const emitChange = (nextValue: string) => {
      const el = textareaRef.current
      if (!el || !onChange) {
        return
      }

      const valueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        'value',
      )?.set
      valueSetter?.call(el, nextValue)

      onChange({
        target: el,
        currentTarget: el,
      } as React.ChangeEvent<HTMLTextAreaElement>)
    }

    const handleBoldClick = () => {
      const el = textareaRef.current
      if (!el || disabled || readOnly) {
        return
      }

      const currentValue = value !== undefined ? String(value ?? '') : el.value
      const next = wrapSelectionWithBold(
        currentValue,
        el.selectionStart ?? currentValue.length,
        el.selectionEnd ?? currentValue.length,
      )

      pendingSelectionRef.current = {
        start: next.selectionStart,
        end: next.selectionEnd,
      }

      if (onChange) {
        emitChange(next.value)
      } else {
        el.value = next.value
      }

      // Restore after controlled parents commit the updated value.
      requestAnimationFrame(() => {
        restoreSelection()
      })
    }

    return (
      <div className={cn('space-y-2', toolbarClassName)}>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label="Bold"
            data-testid="formatted-text-bold"
            disabled={Boolean(disabled || readOnly)}
            onClick={handleBoldClick}
          >
            Bold
          </Button>
        </div>
        <Textarea
          ref={setRefs}
          className={className}
          disabled={disabled}
          readOnly={readOnly}
          value={value}
          onChange={onChange}
          {...props}
        />
      </div>
    )
  },
)
FormattedTextarea.displayName = 'FormattedTextarea'
