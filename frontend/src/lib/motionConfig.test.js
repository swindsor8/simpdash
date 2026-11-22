// Self-check for theme-aware Lenis + GSAP motion profiles.
// Run: node src/lib/motionConfig.test.js
import assert from 'node:assert/strict'
import {
  THEME_MOTION,
  getThemeProfile,
  shouldUseLenis,
  shouldAnimate,
} from './motionConfig.js'

const ALL_THEMES = ['nocturne', 'default', 'retro', 'mario', 'win98', 'terminal', 'glass', 'kinetic']

for (const id of ALL_THEMES) {
  const p = getThemeProfile(id)
  assert.ok(p, `missing profile for ${id}`)
  assert.equal(p, THEME_MOTION[id], `profile mismatch for ${id}`)
  if (id !== 'win98') {
    assert.ok(p.gauge?.duration > 0, `missing gauge profile for ${id}`)
    assert.ok(p.expand?.duration > 0, `missing expand profile for ${id}`)
    assert.ok(p.navGlide?.duration > 0, `missing navGlide profile for ${id}`)
    assert.ok(p.sparkDraw?.duration > 0, `missing sparkDraw profile for ${id}`)
  }
}

// Unknown theme falls back cleanly to nocturne
assert.equal(getThemeProfile('nonexistent'), THEME_MOTION.nocturne)

// Reduced motion disables both Lenis and GSAP decorative animations on every theme
for (const id of ALL_THEMES) {
  assert.equal(shouldUseLenis(id, true), false, `lenis must be off under reduced motion (${id})`)
  assert.equal(shouldAnimate(id, true), false, `animations must be off under reduced motion (${id})`)
}

// Win98 stays authentic: no smooth scroll, instant snaps, no spotlight or scroll bar
assert.equal(shouldUseLenis('win98', false), false)
assert.equal(shouldAnimate('win98', false), false)
assert.equal(THEME_MOTION.win98.spotlight, false)
assert.equal(THEME_MOTION.win98.scrollBar, false)

// Neobrutalist / 8-bit skins keep flat surfaces without pointer spotlight glow
assert.equal(THEME_MOTION.retro.spotlight, false)
assert.equal(THEME_MOTION.mario.spotlight, false)

// Liquid Glass has softer inertia (lower lerp) than Nocturne; Retro is snappier
assert.ok(THEME_MOTION.glass.lenis.lerp < THEME_MOTION.nocturne.lenis.lerp)
assert.ok(THEME_MOTION.retro.lenis.lerp > THEME_MOTION.nocturne.lenis.lerp)

// Terminal phosphor panels never float vertically
assert.equal(THEME_MOTION.terminal.reveal.y, 0)
assert.equal(THEME_MOTION.terminal.view.y, 0)

// Kinetic theme enables 3D reveals, elastic gauges, spotlight, and kinetic flag
assert.equal(THEME_MOTION.kinetic.kinetic, true)
assert.ok(THEME_MOTION.kinetic.reveal.rotateX > 0)
assert.ok(THEME_MOTION.kinetic.gauge.ease.startsWith('elastic'))
assert.equal(THEME_MOTION.kinetic.spotlight, true)
assert.equal(THEME_MOTION.kinetic.scrollBar, true)
assert.equal(shouldUseLenis('kinetic', false), true)
assert.equal(shouldAnimate('kinetic', false), true)

console.log('motionConfig profiles OK')
