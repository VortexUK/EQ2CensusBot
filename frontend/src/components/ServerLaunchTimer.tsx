/**
 * Countdown timer to the EQ2 server launch.
 * Reads the launch date from /api/config so it can be updated via the
 * LAUNCH_DT env var without a frontend rebuild.
 * Hides automatically once the launch time has passed or if no date is set.
 */
import { Fragment, useEffect, useState } from 'react'

function pad(n: number) {
  return String(n).padStart(2, '0')
}

export default function ServerLaunchTimer() {
  const [launchMs, setLaunchMs] = useState<number | null>(null)
  const [timeLeft, setTimeLeft] = useState(0)

  // Fetch the launch date from server config once on mount
  useEffect(() => {
    fetch('/api/config', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then((data: { launch_dt?: string | null } | null) => {
        if (!data?.launch_dt) return
        const ms = new Date(data.launch_dt).getTime()
        if (!isNaN(ms) && ms > Date.now()) {
          setLaunchMs(ms)
          setTimeLeft(ms - Date.now())
        }
      })
      .catch(() => { /* silently suppress — timer simply won't show */ })
  }, [])

  // Tick every second once we have a launch time
  useEffect(() => {
    if (launchMs === null) return
    const id = setInterval(() => {
      setTimeLeft(Math.max(0, launchMs - Date.now()))
    }, 1000)
    return () => clearInterval(id)
  }, [launchMs])

  if (launchMs === null || timeLeft <= 0) return null

  const days    = Math.floor(timeLeft / 86_400_000)
  const hours   = Math.floor((timeLeft % 86_400_000) / 3_600_000)
  const minutes = Math.floor((timeLeft % 3_600_000) / 60_000)
  const seconds = Math.floor((timeLeft % 60_000) / 1_000)

  // Human-readable date line derived from the JS Date object
  const launchDate = new Date(launchMs)
  const dateLabel = launchDate.toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  }) + ' · ' + launchDate.toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit', timeZone: 'UTC', timeZoneName: 'short',
  })

  const units = [
    { value: days,    label: 'Days'    },
    { value: hours,   label: 'Hours'   },
    { value: minutes, label: 'Minutes' },
    { value: seconds, label: 'Seconds' },
  ]

  return (
    <div style={{
      margin: '1.5rem auto 0',
      maxWidth: 500,
      padding: '1.4rem 1.75rem 1.25rem',
      background: 'linear-gradient(180deg, rgba(30,24,15,0.85) 0%, rgba(18,14,8,0.92) 100%)',
      border: '1px solid rgba(var(--gold-rgb), 0.3)',
      borderRadius: 10,
      boxShadow: '0 0 32px rgba(var(--gold-rgb), 0.07), inset 0 1px 0 rgba(var(--gold-rgb), 0.12)',
      textAlign: 'center',
    }}>

      {/* Eyebrow */}
      <div style={{
        fontFamily: 'var(--font-heading)',
        fontSize: '0.68rem',
        fontWeight: 600,
        letterSpacing: '0.2em',
        textTransform: 'uppercase',
        color: 'rgba(var(--gold-rgb), 0.55)',
        marginBottom: '0.3rem',
      }}>
        ✦ &nbsp; Server Launch &nbsp; ✦
      </div>

      {/* Heading */}
      <div style={{
        fontFamily: 'var(--font-heading)',
        fontSize: '1.05rem',
        fontWeight: 700,
        letterSpacing: '0.05em',
        background: 'linear-gradient(135deg, var(--gold) 0%, var(--gold-bright) 50%, var(--gold) 100%)',
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        backgroundClip: 'text',
        display: 'inline-block',
        marginBottom: '1.2rem',
      }}>
        Norrath Awakens In…
      </div>

      {/* Countdown units */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: '0.6rem' }}>
        {units.map(({ value, label }, i) => (
          <Fragment key={label}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.3rem' }}>
              <div style={{
                fontFamily: 'var(--font-heading)',
                fontSize: '2rem',
                fontWeight: 700,
                lineHeight: 1,
                minWidth: '2.4ch',
                padding: '0.45rem 0.55rem',
                background: 'rgba(var(--gold-rgb), 0.07)',
                border: '1px solid rgba(var(--gold-rgb), 0.22)',
                borderRadius: 6,
                color: 'var(--gold-bright)',
                textShadow: '0 0 18px rgba(var(--gold-rgb), 0.5)',
                letterSpacing: '0.05em',
              }}>
                {pad(value)}
              </div>
              <div style={{
                fontSize: '0.58rem',
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
                color: 'rgba(var(--gold-rgb), 0.45)',
                fontWeight: 600,
              }}>
                {label}
              </div>
            </div>
            {/* Separator between units, not after last */}
            {i < units.length - 1 && (
              <div style={{
                alignSelf: 'flex-start',
                paddingTop: '0.55rem',
                fontSize: '1.4rem',
                color: 'rgba(var(--gold-rgb), 0.25)',
                lineHeight: 1,
                fontWeight: 300,
              }}>
                :
              </div>
            )}
          </Fragment>
        ))}
      </div>

      {/* Date line */}
      <div style={{
        marginTop: '1rem',
        fontSize: '0.72rem',
        color: 'rgba(var(--gold-rgb), 0.4)',
        letterSpacing: '0.1em',
        fontFamily: 'var(--font-heading)',
      }}>
        {dateLabel}
      </div>

    </div>
  )
}
