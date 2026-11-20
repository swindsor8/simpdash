// Self-check for theme-aware Lenis + GSAP motion profiles.
// Run: node src/lib/motionConfig.test.js
import assert from 'node:assert/strict'
import {
  THEME_MOTION,
  getThemeProfile,
  shouldUseLenis,
  shouldAnimate,
} from './motionConfig.js'

const ALL_THEMES = ['nocturne', 'default', 'retro', 'mario', 'win98', 'terminal', 'glass']

for (const id of ALL_THEMES) {
  const p = getThemeProfile(id)
  assert.ok(p, `missing profile for ${id}`)
  assert.equal(p, THEME_MOTION[id], `profile mismatch for ${id}`)
}

// Unknown theme falls back cleanly to nocturne
assert.equal(getThemeProfile('nonexistent'), THEME_MOTION.nocturne)

// Reduced motion disables both Lenis and GSAP decorative animations on every theme
for (const id of ALL_THEMES) {
  assert.equal(shouldUseLenis(id, true), false, `lenis must be off under reduced motion (${id})`)
  assert.equal(shouldAnimate(id, true), false, `animations must be off under reduced motion (${id})`)
}

// Win98 stays authentic: no smooth scroll, instant snaps
assert.equal(shouldUseLenis('win98', false), false)
assert.equal(shouldAnimate('win98', false), false)

// Liquid Glass has softer inertia (lower lerp) than Nocturne; Retro is snappier
assert.ok(THEME_MOTION.glass.lenis.lerp < THEME_MOTION.nocturne.lenis.lerp)
assert.ok(THEME_MOTION.retro.lenis.lerp > THEME_MOTION.nocturne.lenis.lerp)

// Terminal phosphor panels never float vertically
assert.equal(THEME_MOTION.terminal.reveal.y, 0)
assert.equal(THEME_MOTION.terminal.view.y, 0)

console.log('motionConfig profiles OK')
