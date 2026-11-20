// Theme-aware motion profiles for Lenis smooth scrolling and GSAP animations.
// Kept pure (no DOM/GSAP side effects on import) so it can be unit-tested
// directly in Node alongside copy.test.js and RadialGauge.test.js.
//
// Each theme's parameters mirror the CSS motion personality in index.css:
//   - nocturne / default : calm, technical, trustworthy (ease-out, zero bounce)
//   - glass              : silky liquid float (lower Lenis lerp, softer lift)
//   - retro              : neobrutalist stamp (snappy stepped timing)
//   - mario              : 8-bit playful pop (crisp bounce)
//   - terminal           : CRT phosphor warmup (brightness flash, no vertical float)
//   - win98              : authentic 1998 desktop (native scroll, instant snap)

export const THEME_MOTION = {
  nocturne: {
    lenis: { lerp: 0.11, wheelMultiplier: 0.95 },
    reveal: { y: 12, duration: 0.34, ease: 'power3.out', stagger: 0.045 },
    view: { y: 8, duration: 0.24, ease: 'power2.out' },
    modal: { y: 10, scale: 0.97, duration: 0.22, ease: 'power3.out' },
    numberEase: 'power3.out',
    instant: false,
  },
  default: {
    lenis: { lerp: 0.11, wheelMultiplier: 0.95 },
    reveal: { y: 12, duration: 0.34, ease: 'power3.out', stagger: 0.045 },
    view: { y: 8, duration: 0.24, ease: 'power2.out' },
    modal: { y: 10, scale: 0.97, duration: 0.22, ease: 'power3.out' },
    numberEase: 'power3.out',
    instant: false,
  },
  glass: {
    lenis: { lerp: 0.075, wheelMultiplier: 0.9 },
    reveal: { y: 20, duration: 0.5, ease: 'power4.out', stagger: 0.055 },
    view: { y: 14, duration: 0.34, ease: 'power3.out' },
    modal: { y: 16, scale: 0.95, duration: 0.3, ease: 'power3.out' },
    numberEase: 'power3.out',
    instant: false,
  },
  retro: {
    lenis: { lerp: 0.2, wheelMultiplier: 1.0 },
    reveal: { x: 3, y: 3, scale: 0.97, duration: 0.18, ease: 'steps(4)', stagger: 0.035 },
    view: { y: 4, duration: 0.14, ease: 'steps(3)' },
    modal: { y: 6, scale: 0.97, duration: 0.16, ease: 'steps(3)' },
    numberEase: 'power2.out',
    instant: false,
  },
  mario: {
    lenis: { lerp: 0.18, wheelMultiplier: 1.0 },
    reveal: { y: 14, scaleY: 0.9, duration: 0.26, ease: 'back.out(1.4)', stagger: 0.04 },
    view: { y: 8, duration: 0.2, ease: 'steps(4)' },
    modal: { y: 12, scale: 0.94, duration: 0.22, ease: 'back.out(1.5)' },
    numberEase: 'power2.out',
    instant: false,
  },
  terminal: {
    lenis: { lerp: 0.16, wheelMultiplier: 1.0 },
    // Phosphor panels don't float vertically — they warm up from high brightness.
    reveal: { y: 0, filter: 'brightness(2.2)', duration: 0.3, ease: 'power2.out', stagger: 0.04 },
    view: { y: 0, duration: 0.16, ease: 'power2.out' },
    modal: { y: 0, scale: 0.98, duration: 0.16, ease: 'power2.out' },
    numberEase: 'power2.out',
    instant: false,
  },
  win98: {
    lenis: null,
    reveal: null,
    view: null,
    modal: null,
    numberEase: 'none',
    instant: true,
  },
}

export function getActiveTheme(explicitTheme) {
  if (explicitTheme) return explicitTheme
  if (typeof document !== 'undefined') {
    return document.documentElement.getAttribute('data-theme') || 'nocturne'
  }
  return 'nocturne'
}

export function getThemeProfile(explicitTheme) {
  const id = getActiveTheme(explicitTheme)
  return THEME_MOTION[id] || THEME_MOTION.nocturne
}

export function prefersReducedMotion() {
  return (
    typeof window !== 'undefined' &&
    Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
  )
}

export function shouldUseLenis(explicitTheme, reduced = prefersReducedMotion()) {
  if (reduced) return false
  const profile = getThemeProfile(explicitTheme)
  return Boolean(profile.lenis)
}

export function shouldAnimate(explicitTheme, reduced = prefersReducedMotion()) {
  if (reduced) return false
  const profile = getThemeProfile(explicitTheme)
  return !profile.instant
}
