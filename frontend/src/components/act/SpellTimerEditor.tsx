import { Checkbox, Field, inputCls } from './primitives'
import type { SpellTimerDraft } from './types'
import { hexToArgb } from './types'

// ── Shared SpellTimerEditor sub-form ──────────────────────────────────────────

interface SpellTimerEditorProps {
  draft: SpellTimerDraft
  onChange: (next: SpellTimerDraft) => void
  nameEditable?: boolean
  /** Fired on blur of the name field (no-op when nameEditable is false). */
  onNameBlur?: (name: string) => void
}

export function SpellTimerEditor({ draft, onChange, nameEditable = true, onNameBlur }: SpellTimerEditorProps) {
  return (
    <>
      <Field label="Timer name *">
        {nameEditable ? (
          <input
            type="text"
            value={draft.name}
            onChange={e => onChange({ ...draft, name: e.target.value })}
            onBlur={e => onNameBlur?.(e.target.value)}
            placeholder="e.g. Doom Cooldown"
            className={inputCls}
          />
        ) : (
          <div className={inputCls + ' text-text-muted cursor-not-allowed select-none'}>
            {draft.name}
            <span className="ml-2 text-[0.72rem] text-gold-dim uppercase tracking-[0.06em]">(in use — rename blocked)</span>
          </div>
        )}
      </Field>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        <Field label="Duration (s)">
          <input
            type="number"
            min={1}
            value={draft.timer_duration_s}
            onChange={e => onChange({ ...draft, timer_duration_s: Number(e.target.value) })}
            className={inputCls}
          />
        </Field>
        <Field label="Warning (s)">
          <input
            type="number"
            min={0}
            value={draft.warning_value}
            onChange={e => onChange({ ...draft, warning_value: Number(e.target.value) })}
            className={inputCls}
          />
        </Field>
        <Field label="Fill colour">
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={draft.fill_color_hex}
              onChange={e => {
                const hex = e.target.value
                onChange({
                  ...draft,
                  fill_color_hex: hex,
                  fill_color_packed: hexToArgb(hex, draft.fill_color_packed),
                })
              }}
              className="h-8 w-12 border border-border rounded-sm bg-bg/60"
            />
            <code className="font-mono text-[0.78rem] text-text-muted">{draft.fill_color_hex}</code>
          </div>
        </Field>
      </div>

      <Field label="Tooltip">
        <input
          type="text"
          value={draft.tooltip}
          onChange={e => onChange({ ...draft, tooltip: e.target.value })}
          className={inputCls}
        />
      </Field>

      <div className="flex items-center gap-4 flex-wrap text-[0.85rem]">
        <Checkbox
          label="Panel 1"
          checked={draft.panel1}
          onChange={v => onChange({ ...draft, panel1: v })}
        />
        <Checkbox
          label="Panel 2"
          checked={draft.panel2}
          onChange={v => onChange({ ...draft, panel2: v })}
        />
        <Checkbox
          label="Absolute"
          checked={draft.absolute}
          onChange={v => onChange({ ...draft, absolute: v })}
        />
        <Checkbox
          label="Master ticks"
          checked={draft.only_master_ticks}
          onChange={v => onChange({ ...draft, only_master_ticks: v })}
        />
      </div>
    </>
  )
}
