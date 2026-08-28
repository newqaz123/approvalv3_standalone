'use client'

import type { ChangeEvent } from 'react'
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import {
  INLINE_IMAGE_ALIGNMENTS,
  type InlineImageAlignment,
  type InlineImageExtensionOptions,
} from './inline-image-extension'
import { MAX_INLINE_ALT_LENGTH, parseInlineImageSrc } from '@/lib/inline-images/policy'

function extensionOptions(extension: NodeViewProps['extension']): InlineImageExtensionOptions {
  return extension.options as unknown as InlineImageExtensionOptions
}

function uploadError(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'Image upload failed'
}

function isAlignment(value: unknown): value is InlineImageAlignment {
  return INLINE_IMAGE_ALIGNMENTS.includes(value as InlineImageAlignment)
}

const INLINE_IMAGE_ALIGNMENT_LABELS: Record<InlineImageAlignment, string> = {
  left: 'Left',
  center: 'Center',
  right: 'Right',
}

/** Interactive view for one local upload or committed private image. */
export function InlineImageNodeView({
  node,
  editor,
  selected,
  extension,
  updateAttributes,
  deleteNode,
}: NodeViewProps) {
  const options = extensionOptions(extension)
  const src = typeof node.attrs.src === 'string' ? node.attrs.src : ''
  const uploadId = typeof node.attrs.uploadId === 'string' ? node.attrs.uploadId : ''
  const status = typeof node.attrs.status === 'string' ? node.attrs.status : ''
  const alt = typeof node.attrs.alt === 'string' ? node.attrs.alt : ''
  const align = isAlignment(node.attrs.align) ? node.attrs.align : 'center'
  const imageId = src ? parseInlineImageSrc(src) : null
  const isStable = imageId !== null && status !== 'error'
  const isLocalUpload = uploadId.length > 0 && options.localUploadIds?.has(uploadId) === true
  const coordinator = options.inlineImages

  const retry = () => {
    if (!uploadId || !coordinator || !options.fileByUploadId) return
    const file = options.fileByUploadId.get(uploadId)
    if (!file) return

    updateAttributes({ status: 'uploading', progress: 0, error: null })
    void coordinator
      .upload(uploadId, file, (progress) => {
        updateAttributes({ status: 'uploading', progress })
      })
      .then((upload) => {
        updateAttributes({
          src: upload.src,
          alt: alt.slice(0, MAX_INLINE_ALT_LENGTH),
          align,
          uploadId,
          status: 'success',
          progress: 100,
          error: null,
        })
      })
      .catch((error: unknown) => {
        updateAttributes({ status: 'error', progress: 0, error: uploadError(error) })
      })
  }

  const remove = () => {
    if (isLocalUpload && coordinator) {
      options.localUploadIds?.delete(uploadId)
      options.fileByUploadId?.delete(uploadId)
      options.insertionPositionByUploadId?.delete(uploadId)
      void coordinator.remove(uploadId, imageId ?? undefined).catch(() => undefined)
    }
    deleteNode()
  }

  const onAltChange = (event: ChangeEvent<HTMLInputElement>) => {
    updateAttributes({ alt: event.currentTarget.value.slice(0, MAX_INLINE_ALT_LENGTH) })
  }

  return (
    <NodeViewWrapper
      as="span"
      data-inline-image-node="true"
      data-align={align}
      className="inline-block max-w-full align-middle"
    >
      {isStable ? (
        <img
          src={src}
          alt={alt}
          data-align={align}
          draggable={false}
          className="block h-auto max-w-full"
        />
      ) : (
        <span
          role={status === 'error' ? 'alert' : 'status'}
          aria-busy={status === 'uploading'}
          className="inline-flex min-h-16 min-w-40 max-w-full flex-col items-center justify-center gap-1 rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-600"
        >
          {status === 'error' ? (
            <span>{typeof node.attrs.error === 'string' ? node.attrs.error : 'Image upload failed'}</span>
          ) : (
            <>
              <span>Uploading image…</span>
              <progress
                value={Math.max(0, Math.min(100, Number(node.attrs.progress) || 0))}
                max={100}
                aria-label="Image upload progress"
                className="w-full"
              />
            </>
          )}
          {status === 'error' && (
            <span className="flex gap-2" contentEditable={false}>
              <button
                type="button"
                onMouseDown={(event) => event.stopPropagation()}
                onClick={retry}
                disabled={!editor.isEditable}
                className="rounded border border-slate-300 px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50"
              >
                Retry
              </button>
              <button
                type="button"
                onMouseDown={(event) => event.stopPropagation()}
                onClick={remove}
                disabled={!editor.isEditable}
                className="rounded border border-slate-300 px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50"
              >
                Remove
              </button>
            </span>
          )}
        </span>
      )}

      {selected && isStable && (
        <span
          contentEditable={false}
          className="mt-2 flex flex-wrap items-end gap-2 rounded-md border border-slate-200 bg-white p-2 text-sm shadow-sm"
          role="group"
          aria-label="Image controls"
        >
          <label className="flex min-w-48 flex-1 flex-col gap-1">
            <span>Alt text</span>
            <input
              type="text"
              aria-label="Image alt text"
              value={alt}
              maxLength={MAX_INLINE_ALT_LENGTH}
              onChange={onAltChange}
              disabled={!editor.isEditable}
              className="rounded border border-slate-300 px-2 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50"
            />
          </label>
          <span className="flex gap-1" role="group" aria-label="Image alignment">
            {INLINE_IMAGE_ALIGNMENTS.map((alignment) => (
              <button
                key={alignment}
                type="button"
                aria-label={`Align ${alignment}`}
                aria-pressed={align === alignment}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={() => updateAttributes({ align: alignment })}
                disabled={!editor.isEditable}
                className="rounded border border-slate-300 px-2 py-1 capitalize focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50"
              >
                {INLINE_IMAGE_ALIGNMENT_LABELS[alignment]}
              </button>
            ))}
          </span>
          <button
            type="button"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={remove}
            disabled={!editor.isEditable}
            className="rounded border border-slate-300 px-2 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50"
          >
            Remove
          </button>
        </span>
      )}
    </NodeViewWrapper>
  )
}

export default InlineImageNodeView
