import type { ReactNode } from 'react'

/**
 * DiscordButton — the standard "Sign in with Discord" link. Used by the
 * login gate, the user widget when signed out, and the claim flow.
 *
 * Three copies of this previously existed with subtle text-colour drift
 * (#fff in two, var(--text) in one). This is the canonical version.
 */
interface DiscordButtonProps {
  href?: string
  children?: ReactNode
}

export function DiscordButton({ href = '/api/auth/login', children = 'Sign in with Discord' }: DiscordButtonProps) {
  return (
    <a
      href={href}
      className={[
        'inline-block no-underline rounded-md',
        'px-4 py-2 text-[0.95rem] font-semibold tracking-[0.02em]',
        'bg-discord text-white',
        'hover:brightness-110 transition-[filter] duration-150',
      ].join(' ')}
    >
      {children}
    </a>
  )
}
