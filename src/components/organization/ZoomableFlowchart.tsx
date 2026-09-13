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
 * upscales: a tree narrower than the canvas stays at 100%.
 */
export function fitScaleFor(contentWidth: number, availableWidth: number): number {
  if (!(contentWidth > 0) || !(availableWidth > 0)) return 1
  return clampZoom(Math.min(1, availableWidth / contentWidth))
}

function stepZoom(scale: number, direction: 1 | -1): number {
  return clampZoom(Math.round((scale + direction * ZOOM_STEP) * 100) / 100)
}

/**
 * Zoom wrapper for the Organization-tab flowchart canvas. Only the flowchart
 * scales: the toolbar, the manage drawer, and the unassigned dock live
 * outside the transformed div. The canvas is width:max-content so the tree
 * lays out at its natural width and transform-scaling magnifies the WHOLE
 * tree (the tree's own overflow-x stays inert); the frame scrolls when the
 * scaled canvas exceeds the column. A height shim keeps page flow equal to
 * the scaled height, so zooming never leaves dead space below the canvas.
 * Zoom state is component state on purpose: it persists across drawer/tab
 * interactions within the session and deliberately resets on reload.
 */
export function ZoomableFlowchart({ children }: { children: React.ReactNode }) {
  const frameRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(1)
  const [scaledHeight, setScaledHeight] = useState<number | null>(null)

  const applyFit = useCallback(() => {
    const frame = frameRef.current
    const canvas = canvasRef.current
    if (!frame || !canvas) return
    const tree = canvas.querySelector('[data-testid="organization-tree"]')
    const contentWidth = tree instanceof HTMLElement ? tree.scrollWidth : canvas.scrollWidth
    setZoom(fitScaleFor(contentWidth, frame.clientWidth))
  }, [])

  // Transform does not affect layout, so the frame needs an explicit height
  // equal to the scaled canvas; otherwise a shrunk canvas leaves a hole and
  // an enlarged one overlaps the sections below.
  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const tree = canvas.querySelector('[data-testid="organization-tree"]')
    const naturalHeight = tree instanceof HTMLElement ? tree.offsetHeight : canvas.offsetHeight
    setScaledHeight(Math.ceil(naturalHeight * zoom))
  }, [zoom, children])

  return (
    <div data-testid="flowchart-zoom" className="organization-flowchart-zoom">
      <div
        data-testid="flowchart-zoom-toolbar"
        role="group"
        aria-label="Flowchart zoom"
        className="mb-2 flex items-center justify-end gap-1"
      >
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
      <div
        ref={frameRef}
        className="organization-flowchart-zoom-frame overflow-x-auto"
        style={scaledHeight !== null ? { height: `${scaledHeight}px` } : undefined}
      >
        <div
          ref={canvasRef}
          data-testid="flowchart-zoom-canvas"
          className="organization-flowchart-zoom-canvas w-max min-w-full"
          style={{ transform: `scale(${zoom})`, transformOrigin: 'top center' }}
        >
          {children}
        </div>
      </div>
    </div>
  )
}
