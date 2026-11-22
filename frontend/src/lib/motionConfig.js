// Theme-aware motion profiles for Lenis smooth scrolling and GSAP animations.
// Kept pure (no DOM/GSAP side effects on import) so it can be unit-tested
// directly in Node alongside copy.test.js and RadialGauge.test.js.
//
// Each theme's parameters mirror the CSS motion personality in index.css:
//   - nocturne / default : calm, technical, trustworthy (ease-out, zero bounce)
//   - glass              : silky liquid float (lower Lenis lerp, softer lift)
//   - kinetic            : high-energy GSAP + React Bits showpiece (3D elastic choreography)
//   - retro              : neobrutalist stamp (snappy stepped timing)
//   - mario              : 8-bit playful pop (crisp bounce)
//   - terminal           : CRT phosphor warmup (brightness flash, no vertical float)
//   - win98              : authentic 1998 desktop (native scroll, instant snap)

export const THEME_MOTION = {
  nocturne: {
    lenis: { lerp: 0.11, wheelMultiplier: 0.95 },
    reveal: { y: 14, duration: 0.38, ease: 'power3.out', stagger: 0.05 },
    view: { y: 10, duration: 0.26, ease: 'power2.out' },
    modal: { y: 12, scale: 0.96, duration: 0.24, ease: 'power3.out' },
    gauge: { duration: 0.72, ease: 'power3.out' },
    expand: { duration: 0.28, ease: 'power2.out' },
    navGlide: { duration: 0.3, ease: 'power3.out' },
    sparkDraw: { duration: 0.65, ease: 'power2.out' },
    numberEase: 'power3.out',
    spotlight: true,
    scrollBar: true,
    instant: false,
  },
  default: {
    lenis: { lerp: 0.11, wheelMultiplier: 0.95 },
    reveal: { y: 14, duration: 0.38, ease: 'power3.out', stagger: 0.05 },
    view: { y: 10, duration: 0.26, ease: 'power2.out' },
    modal: { y: 12, scale: 0.96, duration: 0.24, ease: 'power3.out' },
    gauge: { duration: 0.72, ease: 'power3.out' },
    expand: { duration: 0.28, ease: 'power2.out' },
    navGlide: { duration: 0.3, ease: 'power3.out' },
    sparkDraw: { duration: 0.65, ease: 'power2.out' },
    numberEase: 'power3.out',
    spotlight: true,
    scrollBar: true,
    instant: false,
  },
  glass: {
    lenis: { lerp: 0.075, wheelMultiplier: 0.9 },
    reveal: { y: 22, duration: 0.54, ease: 'power4.out', stagger: 0.06 },
    view: { y: 16, duration: 0.36, ease: 'power3.out' },
    modal: { y: 18, scale: 0.94, duration: 0.32, ease: 'power3.out' },
    gauge: { duration: 0.9, ease: 'power4.out' },
    expand: { duration: 0.36, ease: 'power3.out' },
    navGlide: { duration: 0.4, ease: 'power4.out' },
    sparkDraw: { duration: 0.85, ease: 'power3.out' },
    numberEase: 'power3.out',
    spotlight: true,
    scrollBar: true,
    instant: false,
  },
  kinetic: {
    lenis: { lerp: 0.085, wheelMultiplier: 1.0 },
    reveal: { y: 32, scale: 0.92, rotateX: 10, filter: 'blur(7px)', duration: 0.68, ease: 'back.out(1.45)', stagger: 0.065 },
    view: { y: 20, scale: 0.985, filter: 'blur(5px)', duration: 0.45, ease: 'expo.out' },
    modal: { y: 26, scale: 0.88, rotateX: 8, duration: 0.44, ease: 'back.out(1.6)' },
    gauge: { duration: 1.15, ease: 'elastic.out(1, 0.58)' },
    expand: { duration: 0.42, ease: 'back.out(1.25)' },
    navGlide: { duration: 0.54, ease: 'elastic.out(1, 0.6)' },
    sparkDraw: { duration: 1.05, ease: 'expo.out' },
    numberEase: 'expo.out',
    spotlight: true,
    scrollBar: true,
    kinetic: true,
    instant: false,
  },
  retro: {
    lenis: { lerp: 0.2, wheelMultiplier: 1.0 },
    reveal: { x: 4, y: 4, scale: 0.96, duration: 0.2, ease: 'steps(4)', stagger: 0.04 },
    view: { y: 4, duration: 0.15, ease: 'steps(3)' },
    modal: { y: 6, scale: 0.96, duration: 0.16, ease: 'steps(3)' },
    gauge: { duration: 0.42, ease: 'steps(8)' },
    expand: { duration: 0.16, ease: 'steps(4)' },
    navGlide: { duration: 0.16, ease: 'steps(4)' },
    sparkDraw: { duration: 0.38, ease: 'steps(8)' },
    numberEase: 'power2.out',
    spotlight: false,
    scrollBar: true,
    instant: false,
  },
  mario: {
    lenis: { lerp: 0.18, wheelMultiplier: 1.0 },
    reveal: { y: 16, scaleY: 0.88, duration: 0.3, ease: 'back.out(1.6)', stagger: 0.045 },
    view: { y: 8, duration: 0.2, ease: 'steps(4)' },
    modal: { y: 14, scale: 0.92, duration: 0.24, ease: 'back.out(1.7)' },
    gauge: { duration: 0.65, ease: 'back.out(1.35)' },
    expand: { duration: 0.26, ease: 'back.out(1.2)' },
    navGlide: { duration: 0.24, ease: 'back.out(1.5)' },
    sparkDraw: { duration: 0.5, ease: 'power2.out' },
    numberEase: 'power2.out',
    spotlight: false,
    scrollBar: true,
    instant: false,
  },
  terminal: {
    lenis: { lerp: 0.16, wheelMultiplier: 1.0 },
    // Phosphor panels don't float vertically — they warm up from high brightness.
    reveal: { y: 0, filter: 'brightness(2.2)', duration: 0.32, ease: 'power2.out', stagger: 0.045 },
    view: { y: 0, duration: 0.16, ease: 'power2.out' },
    modal: { y: 0, scale: 0.98, duration: 0.16, ease: 'power2.out' },
    gauge: { duration: 0.55, ease: 'power2.out' },
    expand: { duration: 0.2, ease: 'power2.out' },
    navGlide: { duration: 0.18, ease: 'power2.out' },
    sparkDraw: { duration: 0.55, ease: 'none' },
    numberEase: 'power2.out',
    spotlight: true,
    scrollBar: true,
    instant: false,
  },
  win98: {
    lenis: null,
    reveal: null,
    view: null,
    modal: null,
    gauge: null,
    expand: null,
    navGlide: null,
    sparkDraw: null,
    numberEase: 'none',
    spotlight: false,
    scrollBar: false,
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
