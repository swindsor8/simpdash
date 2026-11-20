import { createContext, useContext, useEffect, useRef, useState } from 'react'
import Lenis from 'lenis'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { getThemeProfile, prefersReducedMotion, shouldUseLenis } from '../lib/motionConfig'

gsap.registerPlugin(ScrollTrigger)

// Context exposing the active scrollable container element so nested views
// can bind GSAP ScrollTrigger to the Lenis-driven pane without prop drilling.
export const ScrollContainerContext = createContext(null)

export function useScrollContainer() {
  return useContext(ScrollContainerContext)
}

function useReducedMotionLive() {
  const [reduced, setReduced] = useState(() => prefersReducedMotion())
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = (e) => setReduced(e.matches)
    setReduced(mq.matches)
    mq.addEventListener?.('change', onChange)
    return () => mq.removeEventListener?.('change', onChange)
  }, [])
  return reduced
}

// Elements that own their own scroll behavior (xterm.js, textareas, selects,
// modals, or anything explicitly marked with data-lenis-prevent).
function shouldPreventLenis(node) {
  if (!node || typeof node.closest !== 'function') return false
  return Boolean(node.closest('[data-lenis-prevent], .xterm, .xterm-viewport, textarea, select'))
}

// useSmoothScroll attaches a Lenis instance to a scrollable container pane
// (e.g. Dashboard's flex-1 content pane or Scripts' catalog pane), synced with
// GSAP's ticker and ScrollTrigger. Automatically disables on prefers-reduced-motion
// or the Win98 theme, and resets scroll to top when `resetKey` changes.
export function useSmoothScroll(wrapperRef, contentRef, { theme, enabled = true, resetKey } = {}) {
  const lenisRef = useRef(null)
  const reduced = useReducedMotionLive()
  const active = enabled && shouldUseLenis(theme, reduced)

  useEffect(() => {
    const wrapper = wrapperRef.current
    const content = contentRef?.current || wrapper?.firstElementChild
    if (!wrapper || !content || !active) {
      lenisRef.current = null
      return
    }

    const profile = getThemeProfile(theme)
    const lenis = new Lenis({
      wrapper,
      content,
      lerp: profile.lenis.lerp,
      wheelMultiplier: profile.lenis.wheelMultiplier,
      smoothWheel: true,
      autoRaf: false,
      prevent: shouldPreventLenis,
    })
    lenisRef.current = lenis

    const onScroll = () => ScrollTrigger.update()
    lenis.on('scroll', onScroll)

    const tick = (time) => lenis.raf(time * 1000)
    gsap.ticker.add(tick)
    gsap.ticker.lagSmoothing(0)

    // Keep Lenis bounds and ScrollTrigger positions in sync when cards expand,
    // filters narrow, or async views finish loading.
    let resizeRaf = null
    const scheduleResize = () => {
      if (resizeRaf !== null) return
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = null
        lenis.resize()
        ScrollTrigger.refresh()
      })
    }

    let ro = null
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(scheduleResize)
      ro.observe(content)
      ro.observe(wrapper)
    }

    return () => {
      if (resizeRaf !== null) cancelAnimationFrame(resizeRaf)
      ro?.disconnect()
      gsap.ticker.remove(tick)
      lenis.off('scroll', onScroll)
      lenis.destroy()
      lenisRef.current = null
    }
  }, [wrapperRef, contentRef, theme, active])

  // Snap back to top when switching views/categories and refresh ScrollTrigger.
  useEffect(() => {
    if (resetKey === undefined) return
    const wrapper = wrapperRef.current
    if (lenisRef.current) {
      lenisRef.current.scrollTo(0, { immediate: true })
    } else if (wrapper) {
      wrapper.scrollTop = 0
    }
    const raf = requestAnimationFrame(() => {
      lenisRef.current?.resize()
      ScrollTrigger.refresh()
    })
    return () => cancelAnimationFrame(raf)
  }, [resetKey, wrapperRef])

  return lenisRef
}
