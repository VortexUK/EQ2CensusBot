import { useEffect, useRef, useState } from 'react'

export interface DropdownOption {
  value: string
  label: string
  group?: string  // optional: rows sharing a group get a right-aligned group caption
}

/**
 * Warcraft-Logs-style filter control: a flat "value ▾" button that opens a
 * themed popover of hover-highlighted rows (optionally grouped). Replaces the
 * boxy native <select> on the rankings filter bar. Themed in EQ2 gold/stone.
 */
export function FilterDropdown({
  value,
  options,
  onChange,
  placeholder = 'Select…',
  disabled = false,
}: {
  value: string
  options: DropdownOption[]
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const selected = options.find(o => o.value === value)

  const btnClass = disabled
    ? 'border-border bg-surface text-text-muted opacity-50 cursor-not-allowed'
    : open
      ? 'border-gold bg-surface-raised text-gold-bright'
      : 'border-border bg-surface text-text hover:border-gold/60 cursor-pointer'

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen(o => !o)}
        className={`flex appearance-none items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${btnClass}`}
      >
        <span className={selected ? '' : 'text-text-muted'}>{selected ? selected.label : placeholder}</span>
        <span className={`text-[0.7em] leading-none ${disabled ? 'text-text-muted' : 'text-gold'}`}>▾</span>
      </button>

      {open && !disabled && (
        <div className="absolute left-0 top-full z-50 mt-1 max-h-72 min-w-full overflow-auto rounded-md border border-gold/40 bg-surface-raised py-1 shadow-[0_10px_30px_rgba(0,0,0,0.65)]">
          {options.length === 0 && <div className="px-3 py-1.5 text-sm italic text-text-muted">No options</div>}
          {options.map((opt, i) => {
            const newGroup = opt.group && opt.group !== options[i - 1]?.group
            const isSel = opt.value === value
            return (
              <div key={opt.value || `__${i}`}>
                {newGroup && (
                  <div className="px-3 pb-0.5 pt-1.5 text-right text-[0.62rem] uppercase tracking-wider text-text-muted">
                    {opt.group}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => {
                    onChange(opt.value)
                    setOpen(false)
                  }}
                  className={`block w-full cursor-pointer appearance-none border-0 whitespace-nowrap px-3 py-1.5 text-left text-sm transition-colors ${
                    isSel
                      ? 'bg-gold/10 text-gold-bright'
                      : 'bg-transparent text-text hover:bg-gold/10 hover:text-gold-bright'
                  }`}
                >
                  {opt.label}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
