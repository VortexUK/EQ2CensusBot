import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'

export type CensusHealth = 'up' | 'down' | 'unknown'
type Listener = (data: unknown, fetchedAt: number) => void

interface CensusStream {
  health: CensusHealth
  /** Subscribe to refresh records for a given key (`<name_lower>:<world>` or `guild:<g>:<w>`). */
  subscribe: (key: string, cb: Listener) => () => void
}

type StreamMessage =
  | { type: 'health'; status: CensusHealth }
  | { type: 'character' | 'guild'; key: string; data: unknown; fetched_at: number }

const Ctx = createContext<CensusStream>({ health: 'unknown', subscribe: () => () => {} })
export const useCensusStream = () => useContext(Ctx)

export function CensusStreamProvider({ children }: { children: ReactNode }) {
  const [health, setHealth] = useState<CensusHealth>('unknown')
  const listeners = useRef<Map<string, Set<Listener>>>(new Map())

  useEffect(() => {
    const es = new EventSource('/api/census/stream', { withCredentials: true })
    es.onmessage = e => {
      let msg: StreamMessage
      try {
        msg = JSON.parse(e.data as string) as StreamMessage
      } catch {
        return
      }
      if (msg.type === 'health') {
        setHealth(msg.status)
        return
      }
      if (msg.type === 'character' || msg.type === 'guild') {
        listeners.current.get(msg.key)?.forEach(cb => cb(msg.data, msg.fetched_at))
      }
    }
    es.onerror = () => setHealth('down')
    return () => es.close()
  }, [])

  const subscribe = useCallback((key: string, cb: Listener) => {
    let set = listeners.current.get(key)
    if (!set) { set = new Set(); listeners.current.set(key, set) }
    set.add(cb)
    return () => set!.delete(cb)
  }, [])

  return <Ctx.Provider value={{ health, subscribe }}>{children}</Ctx.Provider>
}
