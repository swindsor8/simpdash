// Motion-language helpers shared across the dashboard, powered by GSAP +
// ScrollTrigger and tuned per theme via motionConfig.js. CSS owns static
// transitions & hovers (see MOTION LANGUAGE in index.css); GSAP handles
// number tweening, view transitions, scroll-triggered reveals, and modal/form
// entrances. Every GSAP helper respects prefers-reduced-motion and clears
// inline transform/opacity/filter on completion so CSS :hover never conflicts.

import { useState, useEffect, useLayoutEffect, useRef } from 'react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { getThemeProfile, prefersReducedMotion, shouldAnimate } from '../lib/motionConfig'
import { useScrollContainer } from '../hooks/useSmoothScroll'

gsap.registerPlugin(ScrollTrigger)

// Read a motion token's duration in ms (e.g. "--motion-medium" → 300), so JS
// tweens stay in lockstep with the CSS tokens instead of hardcoding numbers.
const tokenMs = (name) => {
  if (typeof window === 'undefined') return 300
  return parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || 300
}

// AnimatedNumber — tweens its displayed value from old → new over --motion-medium
// via GSAP. Interrupted updates smoothly retarget from the live value. Snaps
// immediately under prefers-reduced-motion or the Win98 theme.
export function AnimatedNumber({ value, format = Math.round }) {
  const [display, setDisplay] = useState(value)
  const proxyRef = useRef({ val: typeof value === 'number' ? value : 0 })
  const tweenRef = useRef(null)

  useEffect(() => {
    tweenRef.current?.kill()
    tweenRef.current = null

    if (typeof value !== 'number' || !shouldAnimate()) {
      if (typeof value === 'number') proxyRef.current.val = value
      setDisplay(value)
      return
    }

    if (proxyRef.current.val === value) return

    const profile = getThemeProfile()
    const dur = tokenMs('--motion-medium') / 1000
    tweenRef.current = gsap.to(proxyRef.current, {
      val: value,
      duration: dur,
      ease: profile.numberEase || 'power3.out',
      overwrite: 'auto',
      onUpdate: () => setDisplay(proxyRef.current.val),
      onComplete: () => {
        proxyRef.current.val = value
        setDisplay(value)
      },
    })

    return () => {
      tweenRef.current?.kill()
      tweenRef.current = null
    }
  }, [value])

  return format(display)
}

// useViewTransition — subtle theme-aware GSAP entrance when switching sidebar
// views. Only fires when `triggerKey` changes (not on live theme toggles).
// Runs inside gsap.context() so React 18 StrictMode cleans up safely.
export function useViewTransition(containerRef, triggerKey, theme) {
  const themeRef = useRef(theme)
  themeRef.current = theme

  useLayoutEffect(() => {
    const el = containerRef.current
    const activeTheme = themeRef.current
    if (!el || !shouldAnimate(activeTheme)) return
    const profile = getThemeProfile(activeTheme)
    const v = profile.view
    if (!v) return

    const ctx = gsap.context(() => {
      gsap.from(el, {
        opacity: 0,
        y: v.y || 0,
        duration: v.duration,
        ease: v.ease,
        clearProps: 'transform,opacity',
      })
    }, containerRef)

    return () => ctx.revert()
  }, [containerRef, triggerKey])
}

// useScrollReveal — GSAP ScrollTrigger.batch entrance for [data-reveal] items,
// bound to the active Lenis scroll container from ScrollContainerContext (or an
// explicit scrollerRef). Elements are marked data-revealed="1" upon completion
// so live WebSocket re-renders never replay or flicker already-visible cards.
export function useScrollReveal(containerRef, { selector = '[data-reveal]', deps = [], theme, scrollerRef } = {}) {
  const ctxScrollerRef = useScrollContainer()
  const activeScrollerRef = scrollerRef || ctxScrollerRef

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return

    const targets = Array.from(container.querySelectorAll(selector)).filter(
      (el) => el.dataset.revealed !== '1',
    )
    if (targets.length === 0) return

    if (!shouldAnimate(theme)) {
      for (const el of targets) el.dataset.revealed = '1'
      return
    }

    const profile = getThemeProfile(theme)
    const r = profile.reveal
    if (!r) {
      for (const el of targets) el.dataset.revealed = '1'
      return
    }

    const scroller = activeScrollerRef?.current || undefined
    const fromVars = { opacity: 0 }
    const toVars = {
      opacity: 1,
      duration: r.duration,
      ease: r.ease,
      stagger: r.stagger,
      overwrite: 'auto',
      clearProps: 'transform,opacity,filter',
    }

    if (r.x) { fromVars.x = r.x; toVars.x = 0 }
    if (r.y) { fromVars.y = r.y; toVars.y = 0 }
    if (r.scale) { fromVars.scale = r.scale; toVars.scale = 1 }
    if (r.scaleY) { fromVars.scaleY = r.scaleY; toVars.scaleY = 1 }
    if (r.filter) { fromVars.filter = r.filter; toVars.filter = 'brightness(1)' }

    const ctx = gsap.context(() => {
      gsap.set(targets, fromVars)
      ScrollTrigger.batch(targets, {
        scroller,
        start: 'top 95%',
        once: true,
        onEnter: (batch) => {
          gsap.to(batch, {
            ...toVars,
            onComplete: () => {
              for (const el of batch) el.dataset.revealed = '1'
            },
          })
        },
      })
    }, containerRef)

    const raf = requestAnimationFrame(() => ScrollTrigger.refresh())
    return () => {
      cancelAnimationFrame(raf)
      ctx.revert()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef, activeScrollerRef, selector, theme, ...deps])
}

// useModalEntrance — backdrop fade + dialog pop-in tuned to the active theme.
export function useModalEntrance(backdropRef, dialogRef, theme) {
  useLayoutEffect(() => {
    const backdrop = backdropRef?.current
    const dialog = dialogRef?.current
    if ((!backdrop && !dialog) || !shouldAnimate(theme)) return

    const profile = getThemeProfile(theme)
    const m = profile.modal
    if (!m) return

    const ctx = gsap.context(() => {
      if (backdrop) {
        gsap.from(backdrop, {
          opacity: 0,
          duration: Math.min(0.2, m.duration),
          ease: 'power2.out',
          clearProps: 'opacity',
        })
      }
      if (dialog) {
        gsap.from(dialog, {
          opacity: 0,
          y: m.y || 0,
          scale: m.scale || 1,
          duration: m.duration,
          ease: m.ease,
          clearProps: 'transform,opacity',
        })
      }
    })

    return () => ctx.revert()
  }, [backdropRef, dialogRef, theme])
}

// useStaggerMount — one-shot GSAP stagger for compact non-scrolled groups
// (Login, SetupPassword, popovers, toasts, expandable drawers).
export function useStaggerMount(containerRef, selector, { theme, deps = [] } = {}) {
  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container || !shouldAnimate(theme)) return

    const targets = selector ? Array.from(container.querySelectorAll(selector)) : [container]
    if (targets.length === 0) return

    const profile = getThemeProfile(theme)
    const r = profile.reveal
    if (!r) return

    const fromVars = { opacity: 0, duration: r.duration, ease: r.ease, stagger: r.stagger, clearProps: 'transform,opacity,filter' }
    if (r.x) fromVars.x = r.x
    if (r.y) fromVars.y = Math.min(r.y, 12)
    if (r.scale) fromVars.scale = r.scale
    if (r.filter) fromVars.filter = r.filter

    const ctx = gsap.context(() => {
      gsap.from(targets, fromVars)
    }, containerRef)

    return () => ctx.revert()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef, selector, theme, ...deps])
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
export function useStatusGlow(status) {
  const [cls, setCls] = useState(null)
  const prev = useRef(status)

  useEffect(() => {
    if (prev.current === status) return // also skips the first render (prev init = status)
    prev.current = status
    if (prefersReducedMotion()) return
    const up = status === 'running' || status === 'online'
    setCls(up ? 'glow-success' : 'glow-neutral')
    const t = setTimeout(() => setCls(null), tokenMs('--motion-slow'))
    return () => clearTimeout(t)
  }, [status])

  return cls
}
