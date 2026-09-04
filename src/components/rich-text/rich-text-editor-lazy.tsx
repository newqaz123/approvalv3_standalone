'use client'

import { Component, type ReactNode } from 'react'
import dynamic from 'next/dynamic'
import { FormattedTextarea } from '@/components/ui/formatted-textarea'
import type { RichTextEditorProps } from '@/components/rich-text/rich-text-editor'
import { RichTextEditorSkeleton } from '@/components/rich-text/rich-text-editor-skeleton'
import { sanitizeRichText } from '@/lib/rich-text-sanitizer'

const RichTextEditorInner = dynamic<RichTextEditorProps>(
  () => import('@/components/rich-text/rich-text-editor'),
  {
    ssr: false,
    loading: () => <RichTextEditorSkeleton />,
  },
)

class ChunkErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

/**
 * Controlled rich-text field. Shows a toolbar-shaped skeleton while the
 * TipTap chunk loads, and degrades to FormattedTextarea if chunk loading
 * hard-fails.
 */
export function RichTextEditor(props: RichTextEditorProps) {
  return (
    <ChunkErrorBoundary
      fallback={
        <FormattedTextarea
          value={props.value}
          onChange={(e) => props.onChange(sanitizeRichText(e.target.value))}
          disabled={props.disabled}
          rows={5}
        />
      }
    >
      <RichTextEditorInner {...props} />
    </ChunkErrorBoundary>
  )
}
