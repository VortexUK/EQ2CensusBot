// Small rotating-triangle caret used by every accordion-style section in
// the app (parses list, parse detail, etc.). Single component so the
// rotation animation, colour, and size stay consistent.

export default function Caret({ open }: { open: boolean }) {
  return (
    <span style={{
      display: 'inline-block',
      width: '0.65rem',
      transform: `rotate(${open ? 90 : 0}deg)`,
      transition: 'transform 0.15s',
      fontSize: '0.7rem',
      color: 'var(--text-muted)',
    }}>
      ▶
    </span>
  )
}
