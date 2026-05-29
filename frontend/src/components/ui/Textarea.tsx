/**
 * Textarea — dark-theme textarea with project styling. Replaces the
 * `w-full bg-bg/60 border border-border rounded-md p-3 font-mono text-[0.88rem]
 * leading-relaxed text-text outline-none focus:border-gold/60 resize-y` class
 * string duplicated across EncounterStrategy, ZoneOverview, RolesSettingsPage.
 *
 * Tailwind Preflight isn't loaded, so the explicit appearance-none + bg reset
 * matter — a raw <textarea> would inherit the UA's white background.
 */
import type { TextareaHTMLAttributes } from 'react'

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  /** Use the monospace font (markdown editors, regex inputs). */
  mono?: boolean
}

export function Textarea({ mono = false, className = '', ...rest }: TextareaProps) {
  const cls = [
    'appearance-none w-full bg-bg/60 border border-border rounded-md p-3 text-[0.88rem]',
    'leading-relaxed text-text outline-none focus:border-gold/60 resize-y',
    mono ? 'font-mono' : '',
    className,
  ].filter(Boolean).join(' ')
  return <textarea className={cls} {...rest} />
}
