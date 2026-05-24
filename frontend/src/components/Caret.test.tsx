import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import Caret from './Caret'

describe('Caret', () => {
  it('renders the triangle glyph', () => {
    const { container } = render(<Caret open={false} />)
    expect(container.textContent).toBe('▶')
  })

  it('applies rotate(0deg) when closed', () => {
    const { container } = render(<Caret open={false} />)
    const span = container.querySelector('span')!
    expect(span.style.transform).toBe('rotate(0deg)')
  })

  it('applies rotate(90deg) when open', () => {
    const { container } = render(<Caret open={true} />)
    const span = container.querySelector('span')!
    expect(span.style.transform).toBe('rotate(90deg)')
  })

  it('keeps the same width regardless of open state (prevents row reflow)', () => {
    // If the closed/open caret had different widths, accordion sections
    // would shift their layout on toggle. The fixed 0.65rem width is
    // intentional — pin it so a future style edit doesn't regress.
    const closed = render(<Caret open={false} />).container.querySelector('span')!
    const open = render(<Caret open={true} />).container.querySelector('span')!
    expect(closed.style.width).toBe(open.style.width)
    expect(closed.style.width).toBe('0.65rem')
  })
})
