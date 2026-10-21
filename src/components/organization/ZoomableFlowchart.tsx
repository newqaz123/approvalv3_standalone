'use client'

import React, { useCallback, useLayoutEffect, useRef, useState } from 'react'

export const ZOOM_MIN = 0.25
export const ZOOM_MAX = 2
export const ZOOM_STEP = 0.1

/** Zoom stays in a sane visual band; garbage input snaps back to 100%. */
export function clampZoom(scale: number): number {
  if (!Number.isFinite(scale)) return 1
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, scale))
}

/**
 * Fit scales the whole tree down so it is fully visible inside the available
 * canvas width (the canvas frame already excludes the sticky manage drawer on
 * lg, because the drawer is a flex sibling of the tree column). Fit never
 * upscales, and it is deliberately NOT clamped to the manual +/- band: a tree
 * whose fitted scale is below ZOOM_MIN must still fit, so Fit may return
 * scales under the manual minimum. The manual − / + buttons stay clamped to
 * [ZOOM_MIN, ZOOM_MAX].
 */
export function fitScaleFor(contentWidth: number, availableWidth: number): number {
  if (!(contentWidth > 0) || !(availableWidth > 0)) return 1
  return Math.min(1, availableWidth / contentWidth)
}

function stepZoom(scale: number, direction: 1 | -1): number {
  return clampZoom(Math.round((scale + direction * ZOOM_STEP) * 100) / 100)
}

/**
 * Zoom wrapper for the Organization-tab flowchart canvas. Only the flowchart
 * scales: the toolbar, the manage drawer, and the unassigned dock live
 * outside the transformed div. The canvas is width:max-content so the tree
 * lays out at its natural width and transform-scaling magnifies the WHOLE
 * tree (the tree's own overflow-x stays inert). The scaled canvas sits inside
 * a scaled-size layout wrapper ("sizer") so the frame's scrollable area equals
 * the scaled box: scaling uses transform-origin top left, which keeps BOTH
 * tree edges inside the frame after Fit (a top-center origin on a
 * natural-width canvas shifts the fitted tree right by (W − F)/2 and clips
 * the far edge, and pushes the left edge into unreachable negative scroll
 * space above 100%). Before the first measurement the sizer mirrors the old
 * canvas box (w-max min-w-full) so static/SSR markup keeps the frame-anchored
 * layout; once the ResizeObserver reports the natural tree size the sizer's
 * explicit scaled width (with minWidth 0, so it can shrink below the frame)
 * takes over, and mx-auto centers it whenever it is narrower than the frame
 * (auto margins resolve to 0 when it is wider, so scrolling still starts at
 * the left edge). A height shim keeps page flow equal to the scaled
 * height, so zooming never leaves dead space below the canvas. The shim and
 * sizer derive from the tree's NATURAL size, which a ResizeObserver keeps
 * current: collapsing a branch or re-wrapping a title resizes the tree
 * without touching zoom or the children prop. Zoom state is component state
 * on purpose: it persists across drawer/tab interactions within the session
 * and deliberately resets on reload.
 */
export function ZoomableFlowchart({ children, toolbarExtras }: {
  children: React.ReactNode
  /** Workspace-provided toolbar content (e.g. the Unassigned chip) rendered
   *  left of the zoom controls; the toolbar is sticky so it stays visible
   *  while the canvas and page scroll. */
  toolbarExtras?: React.ReactNode
}) {
  const frameRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(1)
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null)

  const applyFit = useCallback(() => {
    const frame = frameRef.current
    const canvas = canvasRef.current
    if (!frame || !canvas) return
    const tree = canvas.querySelector('[data-testid="organization-tree"]')
    const contentWidth = tree instanceof HTMLElement ? tree.scrollWidth : canvas.scrollWidth
    setZoom(fitScaleFor(contentWidth, frame.clientWidth))
  }, [])

  // Transform does not affect layout, so the frame needs an explicit height
  // equal to the scaled canvas and the canvas needs the scaled-size wrapper;
  // both derive from the natural tree size measured here. ResizeObserver (not
  // a zoom/children effect) tracks collapse and title rewraps.
  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const tree = canvas.querySelector('[data-testid="organization-tree"]')
    const target = tree instanceof HTMLElement ? tree : canvas
    const measure = () => {
      const width = target.offsetWidth
      const height = target.offsetHeight
      setNaturalSize((prev) => (prev && prev.width === width && prev.height === height ? prev : { width, height }))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(target)
    return () => observer.disconnect()
  }, [children])

  // Floor the scaled width so a fitted canvas never becomes wider than the
  // frame by a rounding pixel (which would reintroduce a horizontal
  // scrollbar); the height shim keeps the previous ceil headroom for page
  // flow below the canvas.
  const scaledWidth = naturalSize ? Math.floor(naturalSize.width * zoom) : null
  const scaledHeight = naturalSize ? Math.ceil(naturalSize.height * zoom) : null

  return (
    <div data-testid="flowchart-zoom" className="organization-flowchart-zoom">
      <div
        data-testid="flowchart-zoom-toolbar"
        role="group"
        aria-label="Flowchart zoom"
        className="organization-zoom-toolbar sticky top-0 z-20 mb-2 flex flex-wrap items-center justify-between gap-1 rounded-lg border border-slate-200 bg-background/95 px-1.5 py-1 shadow-sm backdrop-blur"
      >
        <div className="flex min-w-0 items-center gap-1">
          {toolbarExtras}
        </div>
        <div className="flex items-center gap-1">
        <button
          type="button"
          data-testid="flowchart-zoom-out"
          aria-label="Zoom out"
          disabled={zoom <= ZOOM_MIN}
          onClick={() => setZoom((current) => stepZoom(current, -1))}
          className="inline-flex h-8 min-h-8 min-w-8 items-center justify-center rounded-md border border-slate-200 bg-white text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          −
        </button>
        <span
          data-testid="flowchart-zoom-label"
          aria-live="polite"
          className="inline-flex min-w-[3.25rem] items-center justify-center text-xs tabular-nums text-muted-foreground"
        >
          {Math.round(zoom * 100)}%
        </span>
        <button
          type="button"
          data-testid="flowchart-zoom-in"
          aria-label="Zoom in"
          disabled={zoom >= ZOOM_MAX}
          onClick={() => setZoom((current) => stepZoom(current, 1))}
          className="inline-flex h-8 min-h-8 min-w-8 items-center justify-center rounded-md border border-slate-200 bg-white text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          +
        </button>
        <button
          type="button"
          data-testid="flowchart-zoom-fit"
          aria-label="Fit"
          onClick={applyFit}
          className="inline-flex h-8 min-h-8 items-center justify-center rounded-md border border-slate-200 bg-white px-2.5 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Fit
        </button>
        </div>
      </div>
      <div
        ref={frameRef}
        data-testid="flowchart-zoom-frame"
        className="organization-flowchart-zoom-frame overflow-x-auto"
        style={scaledHeight !== null ? { height: `${scaledHeight}px` } : undefined}
      >
        <div
          data-testid="flowchart-zoom-sizer"
          className="organization-flowchart-zoom-sizer mx-auto w-max min-w-full"
          style={
            scaledWidth !== null && scaledHeight !== null
              ? { width: `${scaledWidth}px`, height: `${scaledHeight}px`, minWidth: 0 }
              : undefined
          }
        >
          <div
            ref={canvasRef}
            data-testid="flowchart-zoom-canvas"
            className={`organization-flowchart-zoom-canvas w-max${naturalSize ? '' : ' min-w-full'}`}
            style={{ transform: `scale(${zoom})`, transformOrigin: 'top left' }}
          >
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}
