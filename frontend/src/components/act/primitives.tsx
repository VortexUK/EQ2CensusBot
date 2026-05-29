import type { ReactNode } from 'react'

// ── Shared editor primitives ──────────────────────────────────────────────────

export const inputCls =
  'w-full bg-bg/60 border border-border rounded-sm px-2 py-1 text-text outline-none focus:border-gold/60 appearance-none'

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-gold-dim uppercase tracking-[0.08em] text-[0.7rem]">{label}</span>
      {children}
    </label>
  )
}

export function Checkbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        className="appearance-none w-4 h-4 border border-border rounded-sm bg-bg/60 checked:bg-gold/40 checked:border-gold cursor-pointer"
      />
      <span className="text-text">{label}</span>
    </label>
  )
}
