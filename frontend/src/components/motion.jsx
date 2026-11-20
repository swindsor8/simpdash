// Motion-language helpers shared across the dashboard, powered by GSAP +
// ScrollTrigger and tuned per theme via motionConfig.js. CSS owns static
// transitions & hovers (see MOTION LANGUAGE in index.css); GSAP handles
// number tweening, view transitions, scroll-triggered reveals, scroll-linked
// progress bars, smooth expandable panels, sliding nav indicators, pointer
// spotlights, SVG stroke draw-ins, and modal/form entrances. Every GSAP helper
// respects prefers-reduced-motion and clears inline transform/opacity/filter on
// completion so CSS :hover never conflicts.

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

// AnimatedNumber — tweens its displayed value from old → new via GSAP.
// Interrupted updates smoothly retarget from the live value. Pass `from={0}` to
// count up from zero on first mount (e.g. speed test hero numbers). Snaps
// immediately under prefers-reduced-motion or the Win98 theme.
export function AnimatedNumber({ value, format = Math.round, from, duration }) {
  const initial = typeof from === 'number' && typeof value === 'number' && shouldAnimate() ? from : value
  const [display, setDisplay] = useState(initial)
  const proxyRef = useRef({ val: typeof initial === 'number' ? initial : 0 })
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
    const dur = typeof duration === 'number' ? duration : tokenMs('--motion-medium') / 1000
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
  }, [value, duration])

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
// (Login, SetupPassword, popovers, toasts, expandable drawers, sidebar boot).
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

// Expandable — smooth GSAP height + opacity reveal for collapsible panels
// (storage pools, guest services/docker, batch update confirm/excludes, update
// banner, setup guides). Refreshes ScrollTrigger once height settles.
export function Expandable({ open, className = '', children }) {
  const [rendered, setRendered] = useState(open)
  const wrapRef = useRef(null)
  const skipInitialOpenRef = useRef(open)

  useEffect(() => {
    if (open) setRendered(true)
  }, [open])

  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return

    // If mounted already open, skip animating the initial paint.
    if (skipInitialOpenRef.current) {
      skipInitialOpenRef.current = false
      return
    }

    const profile = getThemeProfile()
    if (!shouldAnimate() || !profile.expand) {
      if (!open) setRendered(false)
      return
    }

    const { duration, ease } = profile.expand
    gsap.killTweensOf(el)

    if (open) {
      gsap.fromTo(
        el,
        { height: 0, opacity: 0, y: -4, overflow: 'hidden' },
        {
          height: 'auto',
          opacity: 1,
          y: 0,
          duration,
          ease,
          clearProps: 'height,overflow,transform,opacity',
          onComplete: () => ScrollTrigger.refresh(),
        },
      )
    } else {
      gsap.to(el, {
        height: 0,
        opacity: 0,
        y: -4,
        overflow: 'hidden',
        duration: Math.max(0.14, duration * 0.75),
        ease: 'power2.inOut',
        onComplete: () => {
          setRendered(false)
          ScrollTrigger.refresh()
        },
      })
    }

    return () => gsap.killTweensOf(el)
  }, [open, rendered])

  if (!rendered) return null
  return (
    <div ref={wrapRef} className={className}>
      {children}
    </div>
  )
}

// ScrollProgressBar — 2px theme-accented reading bar along the top of the
// content pane, scrubbed smoothly by GSAP from the active Lenis scroll container.
export function ScrollProgressBar({ scrollerRef, theme, resetKey }) {
  const barRef = useRef(null)

  useEffect(() => {
    const scroller = scrollerRef?.current
    const bar = barRef.current
    if (!scroller || !bar) return

    const profile = getThemeProfile(theme)
    if (!shouldAnimate(theme) || !profile.scrollBar) {
      gsap.set(bar, { scaleX: 0, opacity: 0 })
      return
    }

    const setScale = gsap.quickTo(bar, 'scaleX', { duration: 0.14, ease: 'power2.out' })
    const setOpacity = gsap.quickTo(bar, 'opacity', { duration: 0.2, ease: 'power2.out' })

    const update = () => {
      const max = scroller.scrollHeight - scroller.clientHeight
      if (max <= 24) {
        setScale(0)
        setOpacity(0)
        return
      }
      const p = Math.max(0, Math.min(1, scroller.scrollTop / max))
      setScale(p)
      setOpacity(p > 0.005 ? 1 : 0)
    }

    update()
    scroller.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update, { passive: true })

    let ro = null
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(update)
      ro.observe(scroller)
      if (scroller.firstElementChild) ro.observe(scroller.firstElementChild)
    }

    return () => {
      scroller.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
      ro?.disconnect()
      gsap.killTweensOf(bar)
    }
  }, [scrollerRef, theme, resetKey])

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none sticky top-0 left-0 right-0 z-30 h-[2px] -mb-[2px] overflow-hidden"
    >
      <div
        ref={barRef}
        className="scroll-progress-fill h-full w-full origin-left"
        style={{ transform: 'scaleX(0)', opacity: 0 }}
      />
    </div>
  )
}

// useSlidingIndicator — glides a floating highlight pill vertically behind the
// active item in a sidebar <nav> using GSAP.
export function useSlidingIndicator(navRef, indicatorRef, activeKey, theme) {
  const placedRef = useRef(false)

  useLayoutEffect(() => {
    const nav = navRef.current
    const pill = indicatorRef.current
    if (!nav || !pill) return

    const activeEl = nav.querySelector('[aria-current="page"]')
    if (!activeEl) {
      gsap.set(pill, { opacity: 0 })
      return
    }

    const y = activeEl.offsetTop
    const height = activeEl.offsetHeight
    const profile = getThemeProfile(theme)

    if (!placedRef.current || !shouldAnimate(theme) || !profile.navGlide) {
      placedRef.current = true
      gsap.set(pill, { y, height, opacity: 1 })
      return
    }

    gsap.to(pill, {
      y,
      height,
      opacity: 1,
      duration: profile.navGlide.duration,
      ease: profile.navGlide.ease,
      overwrite: 'auto',
    })
  }, [navRef, indicatorRef, activeKey, theme])
}

// useCardSpotlight — attaches a subtle, GSAP-interpolated pointer spotlight
// (--mx, --my, --spot-o) to a card surface. Disabled on touch devices, reduced
// motion, and flat/retro themes (retro, mario, win98).
export function useCardSpotlight(cardRef, enabled = true) {
  useEffect(() => {
    const el = cardRef.current
    if (!enabled || !el || typeof window === 'undefined') return
    if (window.matchMedia?.('(pointer: coarse)').matches) return

    const state = { x: 0, y: 0, o: 0 }
    let qx = null
    let qy = null
    let qo = null

    const ensureTweens = () => {
      if (qx) return
      qx = gsap.quickTo(state, 'x', {
        duration: 0.25,
        ease: 'power2.out',
        onUpdate: () => el.style.setProperty('--mx', `${state.x.toFixed(1)}px`),
      })
      qy = gsap.quickTo(state, 'y', {
        duration: 0.25,
        ease: 'power2.out',
        onUpdate: () => el.style.setProperty('--my', `${state.y.toFixed(1)}px`),
      })
      qo = gsap.quickTo(state, 'o', {
        duration: 0.28,
        ease: 'power2.out',
        onUpdate: () => el.style.setProperty('--spot-o', state.o.toFixed(3)),
      })
    }

    const onMove = (e) => {
      const profile = getThemeProfile()
      if (!shouldAnimate() || !profile.spotlight) return
      ensureTweens()
      const rect = el.getBoundingClientRect()
      qx(e.clientX - rect.left)
      qy(e.clientY - rect.top)
      qo(1)
    }

    const onLeave = () => {
      if (!qo) return
      qo(0)
    }

    el.addEventListener('pointermove', onMove, { passive: true })
    el.addEventListener('pointerleave', onLeave, { passive: true })
    return () => {
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerleave', onLeave)
      gsap.killTweensOf(state)
    }
  }, [cardRef, enabled])
}

// useStrokeDraw — animates an SVG <polyline>/<path> stroke drawing itself left
// to right once on first data mount (oscilloscope trace feel for sparklines).
export function useStrokeDraw(pathRef, ready) {
  const drawnRef = useRef(false)

  useLayoutEffect(() => {
    const el = pathRef.current
    if (!el || !ready || drawnRef.current) return
    drawnRef.current = true

    const profile = getThemeProfile()
    if (!shouldAnimate() || !profile.sparkDraw || typeof el.getTotalLength !== 'function') return

    const len = el.getTotalLength()
    if (!len || !Number.isFinite(len)) return

    const ctx = gsap.context(() => {
      gsap.fromTo(
        el,
        { strokeDasharray: len, strokeDashoffset: len },
        {
          strokeDashoffset: 0,
          duration: profile.sparkDraw.duration,
          ease: profile.sparkDraw.ease,
          clearProps: 'strokeDasharray,strokeDashoffset',
        },
      )
    })

    return () => ctx.revert()
  }, [pathRef, ready])
}

// usePopPulse — brief celebratory scale pop when a trigger value flips true
// (e.g. copied IP badge, saved check, active theme pill).
export function usePopPulse(ref, trigger) {
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !trigger || !shouldAnimate()) return
    const ctx = gsap.context(() => {
      gsap.fromTo(
        el,
        { scale: 0.86 },
        { scale: 1, duration: 0.28, ease: 'back.out(2)', clearProps: 'transform' },
      )
    })
    return () => ctx.revert()
  }, [ref, trigger])
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
