/**
 * useDebounce — debounces a callback. Returns a stable function that, when
 * called, schedules `fn` to fire after `delay` ms. Subsequent calls within
 * the window reset the timer. Cleared on unmount.
 *
 * Use for: search-as-you-type, hover-tooltip-after-150ms, save-on-idle.
 */
import { useEffect, useRef, useCallback } from 'react'

export function useDebounce<A extends unknown[]>(
  fn: (...args: A) => void,
  delay: number,
): (...args: A) => void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fnRef = useRef(fn)
  fnRef.current = fn

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current)
  }, [])

  return useCallback((...args: A) => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => fnRef.current(...args), delay)
  }, [delay])
}
