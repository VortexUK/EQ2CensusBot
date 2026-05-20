import { useState } from 'react'
import { createPortal } from 'react-dom'

export interface TooltipState {
  itemId: string
  x: number
  y: number
}

// Image URL cache — once loaded, the browser caches the PNG too, but this
// avoids a flicker on subsequent hovers of the same item.
const _loaded = new Set<string>()

const TIP_W = 478   // matches WIDTH_OUT in image/tooltip.py

export function ItemTooltip({ state }: { state: TooltipState }) {
  const [ready, setReady] = useState(_loaded.has(state.itemId))

  const src = `/api/item/${state.itemId}/image`

  // Clamp to viewport — prefer right of cursor, flip left if near edge
  const MARGIN = 12
  const x = state.x + 16 + TIP_W > window.innerWidth
    ? state.x - TIP_W - 8
    : state.x + 16
  const y = Math.max(MARGIN, state.y - 8)

  return createPortal(
    <div style={{
      position: 'fixed', left: x, top: y, zIndex: 9999,
      pointerEvents: 'none', userSelect: 'none',
      opacity: ready ? 1 : 0,        // hide until image is loaded to avoid flash
      transition: 'opacity 0.1s',
    }}>
      <img
        src={src}
        alt=""
        style={{ display: 'block', maxWidth: TIP_W }}
        onLoad={() => { _loaded.add(state.itemId); setReady(true) }}
      />
    </div>,
    document.body,
  )
}
