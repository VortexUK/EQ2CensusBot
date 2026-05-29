/**
 * useTooltipPosition — compute fixed-position coords for a tooltip near a
 * mouse/tap point, flipping to the other side of the cursor when it would
 * overflow the viewport.
 *
 * Used by ItemTooltip, SpellScrollTooltip, AATree's node tooltip — all
 * pixel-perfect game-client recreations that share the same positioning
 * math but currently have three copies of it.
 */
import { useLayoutEffect, useRef, useState } from 'react'

interface Position { left: number; top: number }

interface Options {
  /** Pointer x (clientX). */
  x: number
  /** Pointer y (clientY). */
  y: number
  /** Tooltip width in px — used for the right-edge flip check. */
  width: number
  /** Tooltip height estimate in px — used for the bottom-edge flip check. */
  heightEstimate?: number
  /** Horizontal gap between pointer and tooltip (default 16). */
  marginX?: number
  /** Vertical gap (default 8). */
  marginY?: number
}

/** Returns {left, top} clamped to the viewport, flipping sides if needed. */
export function clampTooltipPosition({
  x, y, width, heightEstimate = 200, marginX = 16, marginY = 8,
}: Options): Position {
  const W = typeof window !== 'undefined' ? window.innerWidth  : 1920
  const H = typeof window !== 'undefined' ? window.innerHeight : 1080
  const left = x + marginX + width > W ? x - width - marginX : x + marginX
  const top  = y + marginY + heightEstimate > H ? y - heightEstimate - marginY : y + marginY
  return {
    left: Math.max(0, left),
    top:  Math.max(0, top),
  }
}

/**
 * Hook variant: measures the actual rendered height after mount, then
 * re-clamps. For tooltips with variable content size where the estimate is
 * too crude.
 */
export function useTooltipPosition(opts: Options) {
  const [pos, setPos] = useState<Position>(() => clampTooltipPosition(opts))
  const ref = useRef<HTMLDivElement | null>(null)

  useLayoutEffect(() => {
    setPos(clampTooltipPosition(opts))
    // After mount, re-measure with the real height.
    if (ref.current) {
      const h = ref.current.offsetHeight
      setPos(clampTooltipPosition({ ...opts, heightEstimate: h }))
    }
  }, [opts.x, opts.y, opts.width])

  return { ref, position: pos }
}
