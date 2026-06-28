// Motion-language helpers shared across the dashboard. CSS owns the look (see
// the MOTION LANGUAGE block in index.css); these cover the few things pure CSS
// can't: tweening a displayed number, and detecting the WS-driven state changes
// that fire flashes/glows. All durations come from the same CSS tokens.

import { useState, useEffect, useRef } from 'react'

const reduceMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

// Read a motion token's duration in ms (e.g. "--motion-medium" → 300), so JS
// tweens stay in lockstep with the CSS tokens instead of hardcoding numbers.
const tokenMs = (name) => {
  if (typeof window === 'undefined') return 300
  return parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || 300
}

// AnimatedNumber — tweens its displayed value from old → new over --motion-medium
// with an ease-out curve via requestAnimationFrame. Interrupted changes tween
// from wherever the last one left off. Under reduced motion it snaps. `format`
// defaults to integer rounding (counts); pass one for decimals/units.
export function AnimatedNumber({ value, format = Math.round }) {
  const [display, setDisplay] = useState(value)
  const fromRef = useRef(value)
  const rafRef = useRef()

  useEffect(() => {
    if (reduceMotion() || typeof value !== 'number') {
      fromRef.current = value
      setDisplay(value)
      return
    }
    const from = fromRef.current
    if (from === value) return
    const dur = tokenMs('--motion-medium')
    const start = performance.now()
    cancelAnimationFrame(rafRef.current)
    const tick = (now) => {
      const t = Math.min(1, (now - start) / dur)
      const eased = 1 - Math.pow(1 - t, 3) // ease-out cubic, matches the tokens
      const cur = from + (value - from) * eased
      fromRef.current = cur
      setDisplay(cur)
      if (t < 1) rafRef.current = requestAnimationFrame(tick)
      else { fromRef.current = value; setDisplay(value) }
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [value])

  return format(display)
}

// useChangeFlash — true briefly whenever `value` actually changes. Coalesces a
// burst of changes within the flash window into a single flash (the off-timer
// is reset on each change, so it fades out once things settle) rather than
// strobing. Returns a key to re-trigger the CSS animation on each new flash.
export function useChangeFlash(value) {
  const [key, setKey] = useState(0)
  const prev = useRef(value)
  const off = useRef()
  const [on, setOn] = useState(false)

  useEffect(() => {
    if (prev.current === value || value == null) { prev.current = value; return }
    prev.current = value
    setOn(true)
    setKey((k) => k + 1)
    clearTimeout(off.current)
    off.current = setTimeout(() => setOn(false), tokenMs('--motion-medium'))
    return () => clearTimeout(off.current)
  }, [value])

  return on ? key : null
}

// usePowerMorph — watches the inflight flag for a power action and returns true
// for a brief success window after it clears (i.e. once the WS confirms the new
// status), so the button can hold a checkmark before reverting.
export function usePowerMorph(inflight) {
  const [done, setDone] = useState(false)
  const prev = useRef(inflight)

  useEffect(() => {
    if (prev.current && !inflight) {
      setDone(true)
      const t = setTimeout(() => setDone(false), 1100)
      prev.current = inflight
      return () => clearTimeout(t)
    }
    prev.current = inflight
  }, [inflight])

  return done
}

// useStatusGlow — returns a one-shot glow class whenever the entity's status
// actually changes (running → emerald glow, anything else → neutral). Fires from
// the status value itself, so an external Proxmox change glows just the same.
// The returned key forces the animation to restart on each change.
export function useStatusGlow(status) {
  const [cls, setCls] = useState(null)
  const prev = useRef(status)

  useEffect(() => {
    if (prev.current === status) return // also skips the first render (prev init = status)
    prev.current = status
    const up = status === 'running' || status === 'online'
    setCls(up ? 'glow-success' : 'glow-neutral')
    const t = setTimeout(() => setCls(null), tokenMs('--motion-slow'))
    return () => clearTimeout(t)
  }, [status])

  return cls
}
