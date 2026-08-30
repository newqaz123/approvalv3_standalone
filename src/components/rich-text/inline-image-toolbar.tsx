'use client'

import * as React from 'react'
import type { ReactNode } from 'react'
import {
  Crop,
  RotateCcw,
  RotateCw,
  Scaling,
  Trash2,
} from 'lucide-react'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

export type InlineImageToolbarProps = {
  editable: boolean
  removePending: boolean
  /** Flips below the frame when the clip container lacks space above. */
  placement?: 'above' | 'below'
  onRotateLeft: () => void
  onRotateRight: () => void
  onCrop: () => void
  onResetSize: () => void
  onRemove: () => void
}

const TOOLBAR_BUTTON
  = 'inline-image-toolbar-button inline-flex items-center justify-center rounded text-slate-600 hover:bg-slate-100 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500'

function stopEditorSelection(event: { stopPropagation: () => void }) {
  event.stopPropagation()
}

function ToolbarIconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string
  onClick: () => void
  disabled: boolean
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
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
  editable,
  removePending,
  placement = 'above',
  onRotateLeft,
  onRotateRight,
  onCrop,
  onResetSize,
  onRemove,
}: InlineImageToolbarProps) {
  return (
    <TooltipProvider delayDuration={200}>
      <span
        contentEditable={false}
        role="toolbar"
        aria-label="Image actions"
        data-placement={placement}
        className="inline-image-floating-toolbar"
      >
        <ToolbarIconButton label="Rotate image left" disabled={!editable} onClick={onRotateLeft}>
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
        </ToolbarIconButton>
        <ToolbarIconButton label="Rotate image right" disabled={!editable} onClick={onRotateRight}>
          <RotateCw className="h-4 w-4" aria-hidden="true" />
        </ToolbarIconButton>
        <span className="inline-image-toolbar-divider" aria-hidden="true" />
        <ToolbarIconButton label="Crop image" disabled={!editable} onClick={onCrop}>
          <Crop className="h-4 w-4" aria-hidden="true" />
        </ToolbarIconButton>
        <ToolbarIconButton label="Reset image size" disabled={!editable} onClick={onResetSize}>
          <Scaling className="h-4 w-4" aria-hidden="true" />
        </ToolbarIconButton>
        <ToolbarIconButton label="Remove image" disabled={!editable || removePending} onClick={onRemove}>
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </ToolbarIconButton>
      </span>
    </TooltipProvider>
  )
}

export default InlineImageToolbar
