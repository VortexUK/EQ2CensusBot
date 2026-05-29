/**
 * TEMP PROD DIAG v5 — comprehensive History + Location + Navigation API
 * monkey-patch to identify what's depleting Firefox's per-Document throttle
 * quota. The error message is "Too many calls to Location or History APIs"
 * — so we trap BOTH classes, on BOTH the prototype and the instance, with
 * setters on location.href / location.hash / location.search too.
 *
 * Imported as the FIRST line of main.tsx so the patch installs before any
 * library (react-router, Cloudflare bot script, etc.) can cache a reference
 * to the original methods.
 *
 * If after this patch the user clicks once and the prod console shows ONLY
 * our 1-2 expected calls AND THEN the 'Too many calls' warning fires from
 * sandbox eval — the depleter is Firefox-internal (tracking protection or
 * similar) and unreachable from our JS. We then have to either accept it
 * or refactor away from URL state.
 *
 * Revert by deleting this file + removing the import line in main.tsx.
 */

const TAG = '[history-trace v2026-05-29-prod-diag-v5]'

if (typeof window !== 'undefined') {
  console.warn(`${TAG} installing — patching History + Location APIs`)

  const trace = (label: string, ...args: unknown[]) => {
    console.warn(`${TAG} ${label}`, ...args, new Error().stack)
  }

  // ── History.prototype.pushState / replaceState ─────────────────────────────
  const HP = History.prototype
  const origProtoPush = HP.pushState
  const origProtoReplace = HP.replaceState
  HP.pushState = function (...args: Parameters<typeof HP.pushState>) {
    trace('History.prototype.pushState →', args[2])
    return origProtoPush.apply(this, args)
  }
  HP.replaceState = function (...args: Parameters<typeof HP.replaceState>) {
    trace('History.prototype.replaceState →', args[2])
    return origProtoReplace.apply(this, args)
  }

  // ── History instance methods (in case something cached them) ───────────────
  const histInstPush = window.history.pushState.bind(window.history)
  const histInstReplace = window.history.replaceState.bind(window.history)
  window.history.pushState = function (...args: Parameters<typeof window.history.pushState>) {
    trace('window.history.pushState →', args[2])
    return histInstPush(...args)
  }
  window.history.replaceState = function (...args: Parameters<typeof window.history.replaceState>) {
    trace('window.history.replaceState →', args[2])
    return histInstReplace(...args)
  }

  // ── History.go / back / forward ────────────────────────────────────────────
  const origGo = HP.go
  const origBack = HP.back
  const origForward = HP.forward
  HP.go = function (...args: Parameters<typeof HP.go>) {
    trace('History.prototype.go →', args[0])
    return origGo.apply(this, args)
  }
  HP.back = function () {
    trace('History.prototype.back')
    return origBack.apply(this)
  }
  HP.forward = function () {
    trace('History.prototype.forward')
    return origForward.apply(this)
  }

  // ── Location.assign / replace ──────────────────────────────────────────────
  const origLocAssign = window.location.assign.bind(window.location)
  const origLocReplace = window.location.replace.bind(window.location)
  window.location.assign = function (url: string | URL) {
    trace('location.assign →', url)
    return origLocAssign(url)
  }
  window.location.replace = function (url: string | URL) {
    trace('location.replace →', url)
    return origLocReplace(url)
  }

  // ── Location.href / hash / search / pathname setters ───────────────────────
  // Setters on a Location instance go through the Location.prototype descriptor.
  // Wrap each so any `location.href = ...` etc. is logged.
  const LocProto = Object.getPrototypeOf(window.location)
  for (const prop of ['href', 'hash', 'search', 'pathname'] as const) {
    const desc = Object.getOwnPropertyDescriptor(LocProto, prop)
    if (desc && desc.set && desc.get) {
      const origGet = desc.get
      const origSet = desc.set
      Object.defineProperty(LocProto, prop, {
        configurable: true,
        enumerable: desc.enumerable,
        get() { return origGet.call(this) },
        set(v) {
          trace(`location.${prop} =`, v)
          return origSet.call(this, v)
        },
      })
    }
  }

  // ── Navigation API (Chrome/Edge; not in Firefox yet but trap anyway) ───────
  if ('navigation' in window) {
    const nav = (window as unknown as { navigation: { navigate?: (...a: unknown[]) => unknown } }).navigation
    if (nav && typeof nav.navigate === 'function') {
      const origNavigate = nav.navigate.bind(nav)
      nav.navigate = function (...args: unknown[]) {
        trace('navigation.navigate →', args[0])
        return origNavigate(...args)
      }
    }
  }

  ;(window as unknown as { __historyTracedV5?: boolean }).__historyTracedV5 = true
  console.warn(`${TAG} installed — window.__historyTracedV5 = true`)
}

export {}
