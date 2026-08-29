import {
  clampInlineImageDisplayWidth,
} from '@/lib/inline-images/presentation'

export type InlineImageResizeEdge = 'left' | 'right'
export type InlineImageResizeKey = 'ArrowLeft' | 'ArrowRight' | 'Home'

export type InlineImageResizeSession = {
  preview(pointerX: number): number
  commit(): number | null
  cancel(): number
  keyboard(key: 'ArrowLeft' | 'ArrowRight' | 'Home', shiftKey: boolean): number | null
}

export const INLINE_IMAGE_KEYBOARD_STEP = 1
export const INLINE_IMAGE_KEYBOARD_LARGE_STEP = 10

/**
 * Cancels a live session. `clearPreview` runs AFTER `cancel()` so the restore
 * preview cancel reports cannot survive as a lingering local width — the
 * rendered width falls back to the committed/natural width.
 */
export function discardInlineImageResizeSession(
  session: InlineImageResizeSession | null,
  clearPreview: () => void,
): void {
  if (session) session.cancel()
  clearPreview()
}

/** Minimal structural keydown surface the escape guard depends on. */
export type InlineImageResizeEscapeEvent = {
  key: string
  preventDefault(): void
  stopPropagation(): void
}

export type InlineImageResizeEscapeTarget = {
  addEventListener(
    type: 'keydown',
    listener: (event: InlineImageResizeEscapeEvent) => void,
    options?: { capture?: boolean },
  ): void
  removeEventListener(
    type: 'keydown',
    listener: (event: InlineImageResizeEscapeEvent) => void,
    options?: { capture?: boolean },
  ): void
}

/**
 * While a pointer-captured resize drag is live, Escape must cancel the drag
 * itself. The guard listens on the window CAPTURE phase (pointer-down
 * preventDefault keeps the handle from receiving focus, so target handlers
 * never fire) and stops the event so dialog-level Escape dismissal (Radix)
 * cannot close the surrounding dialog mid-drag. Returns a detach function.
 */
export function attachInlineImageResizeEscapeGuard(
  target: InlineImageResizeEscapeTarget,
  discard: () => void,
): () => void {
  const onKeyDown = (event: InlineImageResizeEscapeEvent) => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    discard()
  }
  target.addEventListener('keydown', onKeyDown, { capture: true })
  return () => target.removeEventListener('keydown', onKeyDown, { capture: true })
}

/**
 * Pure resize session for one drag or one keyboard action.
 *
 * `preview` clamps the pointer delta against the editor width and reports the
 * candidate width; it never touches the document. `commit` reports the final
 * width exactly once (null resets the width to the natural size, e.g. the Home
 * key). `cancel` restores the starting width without committing. A finished
 * session ignores further input so a pointer-up can never double-commit.
 */
export function createInlineImageResizeSession(input: {
  edge: 'left' | 'right'
  startPointerX: number
  startWidth: number
  editorWidth: number
  onPreview: (width: number) => void
  onCommit: (width: number | null) => void
}): InlineImageResizeSession {
  const clamp = (width: number) => clampInlineImageDisplayWidth(width, input.editorWidth)
  const startWidth = clamp(input.startWidth)
  const direction = input.edge === 'right' ? 1 : -1

  let currentWidth = startWidth
  let previewed = false
  let resetRequested = false
  let finished = false

  return {
    preview(pointerX) {
      if (finished) return currentWidth
      const delta = direction * (pointerX - input.startPointerX)
      currentWidth = clamp(startWidth + delta)
      previewed = true
      input.onPreview(currentWidth)
      return currentWidth
    },

    commit() {
      if (finished) return null
      finished = true
      if (resetRequested) {
        input.onCommit(null)
        return null
      }
      if (!previewed) return null
      input.onCommit(currentWidth)
      return currentWidth
    },

    cancel() {
      if (!finished && previewed) input.onPreview(startWidth)
      finished = true
      currentWidth = startWidth
      return startWidth
    },

    keyboard(key, shiftKey) {
      if (finished) return null
      if (key === 'Home') {
        resetRequested = true
        return null
      }
      const step = (key === 'ArrowRight' ? 1 : -1)
        * (shiftKey ? INLINE_IMAGE_KEYBOARD_LARGE_STEP : INLINE_IMAGE_KEYBOARD_STEP)
      currentWidth = clamp(currentWidth + step)
      previewed = true
      input.onPreview(currentWidth)
      return currentWidth
    },
  }
}
