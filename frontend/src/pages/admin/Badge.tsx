// ── Local Badge component ─────────────────────────────────────────────────────
// Lightweight status badge used across the admin sub-tables.
// Phase 2c will replace this with the ui/Badge primitive.

export function Badge({ label, style }: { label: string; style?: React.CSSProperties }) {
  return (
    <span
      className="rounded-sm px-2 py-[2px] text-[0.72rem] font-semibold whitespace-nowrap"
      style={style}
    >
      {label}
    </span>
  )
}
