'use client'

import * as React from 'react'
import type { ChangeEvent, ReactNode } from 'react'
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Crop,
  RotateCcw,
  TextCursorInput,
  Trash2,
} from 'lucide-react'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { MAX_INLINE_ALT_LENGTH } from '@/lib/inline-images/policy'
import { INLINE_IMAGE_ALIGNMENTS, type InlineImageAlignment } from './inline-image-extension'

export type InlineImageToolbarProps = {
  alt: string
  align: InlineImageAlignment
  editable: boolean
  removePending: boolean
  /** Flips below the frame when the clip container lacks space above. */
  placement?: 'above' | 'below'
  onAltChange: (value: string) => void
  onAlignChange: (align: InlineImageAlignment) => void
  /** Wired by the NodeView; the crop session itself lands with the crop task. */
  onCrop: () => void
  onResetSize: () => void
  onRemove: () => void
}

const TOOLBAR_BUTTON
  = 'inline-flex h-6 w-6 items-center justify-center rounded text-slate-600 hover:bg-slate-100 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500'

const TOOLBAR_INPUT
  = 'h-6 w-28 rounded border border-slate-300 px-1.5 text-xs text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-40'

function stopEditorSelection(event: { stopPropagation: () => void }) {
  event.stopPropagation()
}

function ToolbarIconButton({
  label,
  onClick,
  disabled,
  pressed,
  children,
}: {
  label: string
  onClick: () => void
  disabled: boolean
  pressed?: boolean
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={pressed}
          disabled={disabled}
          onMouseDown={stopEditorSelection}
          onClick={onClick}
          className={TOOLBAR_BUTTON}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

/** Floating toolbar shown while its image node is selected. */
export function InlineImageToolbar({
  alt,
  align,
  editable,
  removePending,
  placement = 'above',
  onAltChange,
  onAlignChange,
  onCrop,
  onResetSize,
  onRemove,
}: InlineImageToolbarProps) {
  const onAltInput = (event: ChangeEvent<HTMLInputElement>) => {
    onAltChange(event.currentTarget.value.slice(0, MAX_INLINE_ALT_LENGTH))
  }

  return (
    <TooltipProvider delayDuration={200}>
      <span
        contentEditable={false}
        role="toolbar"
        aria-label="Image actions"
        data-placement={placement}
        className="inline-image-floating-toolbar"
      >
        <span className="inline-flex items-center gap-1">
          <TextCursorInput className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
          <input
            type="text"
            aria-label="Image alt text"
            value={alt}
            maxLength={MAX_INLINE_ALT_LENGTH}
            disabled={!editable}
            onMouseDown={stopEditorSelection}
            onChange={onAltInput}
            className={TOOLBAR_INPUT}
          />
        </span>
        <span className="inline-image-toolbar-divider" aria-hidden="true" />
        {INLINE_IMAGE_ALIGNMENTS.map((alignment) => (
          <ToolbarIconButton
            key={alignment}
            label={`Align ${alignment}`}
            pressed={align === alignment}
            disabled={!editable}
            onClick={() => onAlignChange(alignment)}
          >
            {alignment === 'left' && <AlignLeft className="h-4 w-4" aria-hidden="true" />}
            {alignment === 'center' && <AlignCenter className="h-4 w-4" aria-hidden="true" />}
            {alignment === 'right' && <AlignRight className="h-4 w-4" aria-hidden="true" />}
          </ToolbarIconButton>
        ))}
        <span className="inline-image-toolbar-divider" aria-hidden="true" />
        <ToolbarIconButton label="Crop image" disabled={!editable} onClick={onCrop}>
          <Crop className="h-4 w-4" aria-hidden="true" />
        </ToolbarIconButton>
        <ToolbarIconButton label="Reset image size" disabled={!editable} onClick={onResetSize}>
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
        </ToolbarIconButton>
        <ToolbarIconButton label="Remove image" disabled={!editable || removePending} onClick={onRemove}>
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </ToolbarIconButton>
      </span>
    </TooltipProvider>
  )
}

export default InlineImageToolbar
