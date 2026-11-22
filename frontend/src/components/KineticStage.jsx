// KineticStage — full-viewport living motion engine for the "Kinetic" theme.
// Combines four zero-dependency React Bits + GSAP primitives:
//   1. WebGL2 Procedural Plasma Beams + Flowing Silk Aurora + Interactive Orb
//      (inspired by React Bits Beams + Aurora + Silk, with graceful 2D fallback)
//   2. 2D Interactive FX Layer: React Bits ClickSpark bursts + shockwave rings,
//      bioluminescent drifting Particles, and a subtle fast-cursor plasma Ribbon
//   3. Global MagicBento Controller: proximity-illuminated chromatic card borders
//      (--kb-x, --kb-y, --kb-prox) + GSAP 3D perspective micro-tilt on hover
//   4. GSAP Kinetic Ignition: non-blocking shockwave ring + card wave cascade on
//      entering the theme.
//
// Completely unmounted (returns null) on all other themes; strictly respects
// prefers-reduced-motion and pauses rendering when the tab is hidden.

import { useEffect, useRef } from 'react'
import gsap from 'gsap'
import { prefersReducedMotion } from '../lib/motionConfig'

// ============================================================================
// WebGL2 Plasma Beams + Iridescent Aurora Shader
// ============================================================================
const VERTEX_SRC = `#version 300 es
in vec2 aPos;
void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
}`

const FRAGMENT_SRC = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform vec2 uMouse;
uniform float uVel;
out vec4 outColor;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p = rot * p * 2.02;
    a *= 0.5;
  }
  return v;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  float aspect = uRes.x / max(uRes.y, 1.0);
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  vec2 m = (uMouse - 0.5) * vec2(aspect, 1.0);

  float t = uTime * 0.24;
  float surge = clamp(uVel, 0.0, 1.8);

  // Domain-warped flowing silk aurora field
  vec2 warpA = vec2(
    fbm(p * 1.45 + vec2(t * 0.45, -t * 0.28)),
    fbm(p * 1.45 + vec2(-t * 0.32 + 4.2, t * 0.36 + 1.9))
  );
  vec2 warpB = vec2(
    fbm(p * 2.1 + warpA * 1.15 + vec2(-t * 0.25, t * 0.4)),
    fbm(p * 2.1 + warpA * 1.15 + vec2(t * 0.35 + 7.1, -t * 0.22 + 3.4))
  );
  float silk = fbm(p * 1.9 + warpB * 0.95);

  // Diagonal volumetric light beams (React Bits Beams feel)
  float diag1 = p.x * 0.72 + p.y * 0.69;
  float diag2 = p.x * 0.56 - p.y * 0.82;
  float s1 = sin(diag1 * 3.1 - t * 1.45 + warpA.x * 2.1);
  float s2 = sin(diag1 * 2.0 + t * 0.95 + warpB.y * 2.5 + 1.4);
  float s3 = sin(diag2 * 2.4 - t * 0.8 + silk * 2.8 + 0.6);
  float beam1 = exp(-(s1 * s1) * 5.2);
  float beam2 = exp(-(s2 * s2) * 4.4);
  float beam3 = exp(-(s3 * s3) * 6.0);

  // Pointer-reactive gravitational plasma bloom
  float md = length(p - m);
  float orb = exp(-md * md * 3.4) * (0.42 + surge * 0.14);
  float rd = md - 0.24 - sin(uTime * 1.6) * 0.025;
  float orbRing = exp(-(rd * rd) * 95.0) * 0.20;

  // Deep obsidian void base
  vec3 col = vec3(0.020, 0.016, 0.052);

  // Chromatic kinetic palette
  vec3 violet  = vec3(0.49, 0.23, 0.93);
  vec3 magenta = vec3(1.00, 0.18, 0.59);
  vec3 cyan    = vec3(0.00, 0.94, 1.00);
  vec3 gold    = vec3(1.00, 0.72, 0.12);

  // Layer ambient aurora ribbons
  col += violet  * smoothstep(0.28, 0.86, silk) * 0.22;
  col += magenta * smoothstep(0.38, 0.92, warpB.x) * 0.16;
  col += cyan    * smoothstep(0.42, 0.92, warpB.y) * 0.15;

  // Layer kinetic diagonal beams (intensify slightly with scroll momentum)
  float energy = 1.0 + surge * 0.35;
  col += mix(violet, magenta, clamp(warpA.x, 0.0, 1.0)) * beam1 * 0.24 * energy;
  col += mix(cyan, violet, clamp(warpB.y, 0.0, 1.0))    * beam2 * 0.20 * energy;
  col += mix(magenta, gold, 0.45) * beam3 * beam1 * 0.26 * energy;

  // Interactive cursor plasma orb + harmonic ring
  vec3 orbTint = mix(cyan, magenta, 0.5 + 0.5 * sin(uTime * 0.9 + md * 4.0));
  col += orbTint * orb * 0.32;
  col += mix(violet, cyan, 0.6) * orbRing;

  // Subtle architectural precision dot matrix etched in the dark void
  vec2 gridUv = fract(gl_FragCoord.xy / 42.0) - 0.5;
  float dotDist = length(gridUv);
  float dotMask = smoothstep(0.055, 0.015, dotDist);
  float dotBoost = 0.035 + exp(-md * md * 7.0) * 0.16;
  col += mix(violet, cyan, 0.55) * dotMask * dotBoost;

  // Soft vignette to keep center & edges richly grounded
  float vig = 1.0 - smoothstep(0.42, 1.38, length(p * vec2(0.82, 1.0)));
  col *= mix(0.68, 1.06, vig);

  // Subtle triangular dithering to eliminate dark gradient banding
  float d = (hash(gl_FragCoord.xy + fract(uTime)) - 0.5) / 255.0;
  outColor = vec4(clamp(col + d, 0.0, 1.0), 1.0);
}`

function compileShader(gl, type, src) {
  const s = gl.createShader(type)
  if (!s) return null
  gl.shaderSource(s, src)
  gl.compileShader(s)
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    gl.deleteShader(s)
    return null
  }
  return s
}

const SPARK_COLORS = ['#00f0ff', '#ff2e97', '#a855f7', '#fbbf24', '#38bdf8', '#f472b6']

// Track once-per-session auto-ignition while allowing re-ignition on theme switch
const IGNITION_SESSION_KEY = 'sd-kinetic-ignited'
const IGNITION_SWITCH_KEY = 'sd-kinetic-switched'

export default function KineticStage({ theme }) {
  const bgCanvasRef = useRef(null)
  const fxCanvasRef = useRef(null)
  const shockOuterRef = useRef(null)
  const shockInnerRef = useRef(null)
  const flashRef = useRef(null)

  // Shared live pointer + scroll velocity refs for WebGL & 2D FX
  const mouseRef = useRef({ x: 0.5, y: 0.5, tx: 0.5, ty: 0.5, px: -999, py: -999 })
  const velRef = useRef({ current: 0, target: 0 })

  const active = theme === 'kinetic'

  // --------------------------------------------------------------------------
  // 1. WebGL2 Plasma Beams + Aurora Canvas (with Canvas 2D animated fallback)
  // --------------------------------------------------------------------------
  useEffect(() => {
    if (!active) return
    const canvas = bgCanvasRef.current
    if (!canvas) return

    const reduced = prefersReducedMotion()
    let alive = true
    let raf = 0
    const started = performance.now()

    const onPointer = (e) => {
      const w = Math.max(1, window.innerWidth)
      const h = Math.max(1, window.innerHeight)
      mouseRef.current.tx = e.clientX / w
      mouseRef.current.ty = 1 - e.clientY / h
      mouseRef.current.px = e.clientX
      mouseRef.current.py = e.clientY
    }
    const onScrollVel = (e) => {
      const v = Math.min(1.8, Math.abs(Number(e.detail) || 0))
      if (v > velRef.current.target) velRef.current.target = v
    }
    window.addEventListener('pointermove', onPointer, { passive: true })
    window.addEventListener('sd-scroll-velocity', onScrollVel)

    // Attempt WebGL2 first
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'low-power',
    })

    let glCleanup = null
    let renderFn = null

    if (gl) {
      const vs = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SRC)
      const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SRC)
      const prog = vs && fs ? gl.createProgram() : null
      if (prog) {
        gl.attachShader(prog, vs)
        gl.attachShader(prog, fs)
        gl.bindAttribLocation(prog, 0, 'aPos')
        gl.linkProgram(prog)
        gl.deleteShader(vs)
        gl.deleteShader(fs)

        if (gl.getProgramParameter(prog, gl.LINK_STATUS)) {
          gl.useProgram(prog)
          const buf = gl.createBuffer()
          gl.bindBuffer(gl.ARRAY_BUFFER, buf)
          gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
          gl.enableVertexAttribArray(0)
          gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)

          const uRes = gl.getUniformLocation(prog, 'uRes')
          const uTime = gl.getUniformLocation(prog, 'uTime')
          const uMouse = gl.getUniformLocation(prog, 'uMouse')
          const uVel = gl.getUniformLocation(prog, 'uVel')

          const resizeGl = () => {
            const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
            const w = Math.max(1, Math.floor(window.innerWidth * dpr))
            const h = Math.max(1, Math.floor(window.innerHeight * dpr))
            if (canvas.width !== w || canvas.height !== h) {
              canvas.width = w
              canvas.height = h
            }
          }
          resizeGl()
          window.addEventListener('resize', resizeGl, { passive: true })

          const onLost = (e) => { e.preventDefault(); alive = false }
          canvas.addEventListener('webglcontextlost', onLost)

          renderFn = (now) => {
            const m = mouseRef.current
            m.x += (m.tx - m.x) * 0.06
            m.y += (m.ty - m.y) * 0.06
            velRef.current.current += (velRef.current.target - velRef.current.current) * 0.12
            velRef.current.target *= 0.88

            gl.viewport(0, 0, canvas.width, canvas.height)
            gl.uniform2f(uRes, canvas.width, canvas.height)
            gl.uniform1f(uTime, reduced ? 4.2 : (now - started) / 1000)
            gl.uniform2f(uMouse, m.x, m.y)
            gl.uniform1f(uVel, velRef.current.current)
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
          }

          glCleanup = () => {
            window.removeEventListener('resize', resizeGl)
            canvas.removeEventListener('webglcontextlost', onLost)
            gl.deleteBuffer(buf)
            gl.deleteProgram(prog)
          }
        } else {
          gl.deleteProgram(prog)
        }
      }
    }

    // Graceful Canvas 2D animated aurora + beams fallback if WebGL2 unavailable
    if (!renderFn) {
      const ctx = canvas.getContext('2d')
      if (ctx) {
        const resize2d = () => {
          const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
          canvas.width = Math.max(1, Math.floor(window.innerWidth * dpr))
          canvas.height = Math.max(1, Math.floor(window.innerHeight * dpr))
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        }
        resize2d()
        window.addEventListener('resize', resize2d, { passive: true })
        glCleanup = () => window.removeEventListener('resize', resize2d)

        renderFn = (now) => {
          const w = window.innerWidth
          const h = window.innerHeight
          const t = reduced ? 2.5 : (now - started) / 1000
          ctx.fillStyle = '#05040d'
          ctx.fillRect(0, 0, w, h)

          const orbs = [
            { x: w * (0.25 + 0.16 * Math.sin(t * 0.35)), y: h * (0.3 + 0.15 * Math.cos(t * 0.28)), r: Math.max(w, h) * 0.48, c: 'rgba(124,58,237,0.22)' },
            { x: w * (0.75 + 0.14 * Math.cos(t * 0.31)), y: h * (0.28 + 0.18 * Math.sin(t * 0.24)), r: Math.max(w, h) * 0.44, c: 'rgba(255,46,151,0.18)' },
            { x: w * (0.5 + 0.2 * Math.sin(t * 0.22 + 2)), y: h * (0.78 + 0.12 * Math.cos(t * 0.33)), r: Math.max(w, h) * 0.46, c: 'rgba(0,240,255,0.16)' },
          ]
          ctx.globalCompositeOperation = 'lighter'
          for (const o of orbs) {
            const g = ctx.createRadialGradient(o.x, o.y, 0, o.x, o.y, o.r)
            g.addColorStop(0, o.c)
            g.addColorStop(1, 'transparent')
            ctx.fillStyle = g
            ctx.fillRect(0, 0, w, h)
          }
          ctx.globalCompositeOperation = 'source-over'
        }
      }
    }

    const loop = (now) => {
      raf = 0
      if (!alive || !renderFn) return
      if (!document.hidden) renderFn(now)
      if (!reduced) raf = requestAnimationFrame(loop)
    }

    const onVis = () => {
      if (document.hidden && raf) {
        cancelAnimationFrame(raf)
        raf = 0
      } else if (!document.hidden && !reduced && !raf && alive) {
        raf = requestAnimationFrame(loop)
      }
    }
    document.addEventListener('visibilitychange', onVis)
    raf = requestAnimationFrame(loop)

    return () => {
      alive = false
      if (raf) cancelAnimationFrame(raf)
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('pointermove', onPointer)
      window.removeEventListener('sd-scroll-velocity', onScrollVel)
      glCleanup?.()
    }
  }, [active])

  // --------------------------------------------------------------------------
  // 2. 2D FX Canvas: React Bits ClickSpark + Ambient Particles + Micro-Ribbon
  // --------------------------------------------------------------------------
  useEffect(() => {
    if (!active || prefersReducedMotion()) return
    const canvas = fxCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let alive = true
    let raf = 0
    let w = window.innerWidth
    let h = window.innerHeight
    const isFine = window.matchMedia?.('(pointer: fine)').matches

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      w = window.innerWidth
      h = window.innerHeight
      canvas.width = Math.max(1, Math.floor(w * dpr))
      canvas.height = Math.max(1, Math.floor(h * dpr))
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    window.addEventListener('resize', resize, { passive: true })

    // Bioluminescent ambient drifters (React Bits Particles inspired)
    const particles = Array.from({ length: 34 }, (_, i) => ({
      x: ((i * 197.3) % 100) / 100 * w,
      y: ((i * 313.7) % 100) / 100 * h,
      vx: (Math.sin(i * 1.9) * 0.22),
      vy: -(0.14 + (i % 5) * 0.06),
      r: 1.1 + (i % 3) * 0.65,
      color: SPARK_COLORS[i % SPARK_COLORS.length],
      phase: i * 0.7,
    }))

    // ClickSpark particles & shockwave rings
    const sparks = []
    const rings = []
    // Fast-cursor plasma ribbon trail
    const trail = []

    const onDown = (e) => {
      const x = e.clientX
      const y = e.clientY
      const count = 12
      const baseAngle = Math.random() * Math.PI * 2
      for (let i = 0; i < count; i++) {
        const angle = baseAngle + (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.28
        const speed = 2.6 + Math.random() * 4.4
        sparks.push({
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          len: 7 + Math.random() * 9,
          life: 1,
          decay: 0.028 + Math.random() * 0.018,
          color: SPARK_COLORS[(i + Math.floor(Math.random() * 3)) % SPARK_COLORS.length],
        })
      }
      rings.push({
        x,
        y,
        r: 4,
        maxR: 48,
        life: 1,
        color: SPARK_COLORS[Math.floor(Math.random() * 3)],
      })
      if (sparks.length > 140) sparks.splice(0, sparks.length - 140)
    }

    let lastMoveX = -999
    let lastMoveY = -999
    const onMove = (e) => {
      if (!isFine) return
      const dx = e.clientX - lastMoveX
      const dy = e.clientY - lastMoveY
      const speed = Math.hypot(dx, dy)
      lastMoveX = e.clientX
      lastMoveY = e.clientY
      if (speed > 2) {
        trail.push({
          x: e.clientX,
          y: e.clientY,
          life: Math.min(1, 0.45 + speed / 42),
        })
        if (trail.length > 14) trail.shift()
      }
    }

    window.addEventListener('pointerdown', onDown, { passive: true })
    window.addEventListener('pointermove', onMove, { passive: true })

    let tick = 0
    const draw = () => {
      raf = 0
      if (!alive) return
      if (!document.hidden) {
        tick++
        ctx.clearRect(0, 0, w, h)
        const mx = mouseRef.current.px
        const my = mouseRef.current.py

        // 1. Ambient drifting particles with gentle magnetic swirl near cursor
        for (let i = 0; i < particles.length; i++) {
          const p = particles[i]
          p.x += p.vx + Math.sin(tick * 0.012 + p.phase) * 0.14
          p.y += p.vy
          if (mx > -100) {
            const dx = p.x - mx
            const dy = p.y - my
            const dist = Math.hypot(dx, dy)
            if (dist < 130 && dist > 1) {
              const force = (1 - dist / 130) * 0.42
              p.x += (dx / dist) * force
              p.y += (dy / dist) * force
            }
          }
          if (p.y < -12) { p.y = h + 12; p.x = (p.x + 137) % w }
          if (p.x < -12) p.x = w + 12
          if (p.x > w + 12) p.x = -12

          const alpha = 0.18 + 0.16 * Math.sin(tick * 0.03 + p.phase)
          ctx.beginPath()
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
          ctx.fillStyle = p.color
          ctx.globalAlpha = alpha
          ctx.fill()
        }

        // 2. Tapered velocity cursor plasma ribbon
        if (trail.length > 1) {
          for (let i = trail.length - 1; i >= 0; i--) {
            trail[i].life -= 0.075
            if (trail[i].life <= 0) trail.splice(i, 1)
          }
          if (trail.length > 1) {
            ctx.lineCap = 'round'
            ctx.lineJoin = 'round'
            for (let i = 1; i < trail.length; i++) {
              const a = trail[i - 1]
              const b = trail[i]
              const frac = i / trail.length
              ctx.beginPath()
              ctx.moveTo(a.x, a.y)
              ctx.lineTo(b.x, b.y)
              ctx.strokeStyle = i % 2 === 0 ? '#00f0ff' : '#ff2e97'
              ctx.lineWidth = Math.max(0.6, frac * 2.6)
              ctx.globalAlpha = Math.max(0, b.life * frac * 0.42)
              ctx.stroke()
            }
          }
        }

        // 3. ClickSpark expanding shockwave rings
        for (let i = rings.length - 1; i >= 0; i--) {
          const r = rings[i]
          r.r += (r.maxR - r.r) * 0.18
          r.life -= 0.048
          if (r.life <= 0) {
            rings.splice(i, 1)
            continue
          }
          ctx.beginPath()
          ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2)
          ctx.strokeStyle = r.color
          ctx.lineWidth = 1.6 * r.life
          ctx.globalAlpha = r.life * 0.65
          ctx.stroke()
        }

        // 4. ClickSpark directional plasma streaks
        ctx.lineCap = 'round'
        for (let i = sparks.length - 1; i >= 0; i--) {
          const s = sparks[i]
          s.x += s.vx
          s.y += s.vy
          s.vx *= 0.91
          s.vy *= 0.91
          s.life -= s.decay
          if (s.life <= 0) {
            sparks.splice(i, 1)
            continue
          }
          const mag = Math.hypot(s.vx, s.vy) || 1
          const nx = s.vx / mag
          const ny = s.vy / mag
          const tail = s.len * s.life
          ctx.beginPath()
          ctx.moveTo(s.x, s.y)
          ctx.lineTo(s.x - nx * tail, s.y - ny * tail)
          ctx.strokeStyle = s.color
          ctx.lineWidth = 1.9 * s.life
          ctx.globalAlpha = Math.min(1, s.life * 1.1)
          ctx.stroke()
        }

        ctx.globalAlpha = 1
      }
      raf = requestAnimationFrame(draw)
    }

    const onVis = () => {
      if (document.hidden && raf) {
        cancelAnimationFrame(raf)
        raf = 0
      } else if (!document.hidden && !raf && alive) {
        raf = requestAnimationFrame(draw)
      }
    }
    document.addEventListener('visibilitychange', onVis)
    raf = requestAnimationFrame(draw)

    return () => {
      alive = false
      if (raf) cancelAnimationFrame(raf)
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('resize', resize)
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
    }
  }, [active])

  // --------------------------------------------------------------------------
  // 3. MagicBento Proximity Border Glow + GSAP 3D Micro-Tilt Controller
  // --------------------------------------------------------------------------
  useEffect(() => {
    if (!active || prefersReducedMotion()) return
    if (typeof window === 'undefined' || window.matchMedia?.('(pointer: coarse)').matches) return

    let pendingFrame = 0
    let lastEvent = null
    let hoveredCard = null
    const touchedCards = new Set()

    const resetTilt = (card, fast = false) => {
      if (!card) return
      gsap.to(card, {
        rotateX: 0,
        rotateY: 0,
        y: 0,
        scale: 1,
        duration: fast ? 0.16 : 0.62,
        ease: fast ? 'power2.out' : 'elastic.out(1, 0.55)',
        overwrite: 'auto',
        clearProps: 'transform,transformPerspective',
      })
    }

    const isInteractiveBusy = (card) => {
      const ae = document.activeElement
      if (ae && card.contains(ae) && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) return true
      // Keep card flat while an inline ServiceLinkEditor popover is open inside it
      if (card.querySelector('[data-lenis-prevent]')) return true
      return false
    }

    const processPointer = () => {
      pendingFrame = 0
      const e = lastEvent
      if (!e) return
      const cx = e.clientX
      const cy = e.clientY
      const vh = window.innerHeight
      const PROXIMITY = 320

      const cards = document.querySelectorAll('.bg-\\[\\#13131e\\].rounded-2xl')
      let nextHovered = null

      for (let i = 0; i < cards.length; i++) {
        const card = cards[i]
        const r = card.getBoundingClientRect()
        // Skip cards far off-screen
        if (r.bottom < -PROXIMITY || r.top > vh + PROXIMITY || r.width === 0) {
          if (touchedCards.has(card)) {
            card.style.setProperty('--kb-prox', '0')
            touchedCards.delete(card)
          }
          continue
        }

        const dx = cx < r.left ? r.left - cx : cx > r.right ? cx - r.right : 0
        const dy = cy < r.top ? r.top - cy : cy > r.bottom ? cy - r.bottom : 0
        const dist = Math.hypot(dx, dy)

        if (dist < PROXIMITY) {
          const prox = Math.max(0, Math.min(1, 1 - dist / PROXIMITY))
          card.style.setProperty('--kb-x', `${(cx - r.left).toFixed(1)}px`)
          card.style.setProperty('--kb-y', `${(cy - r.top).toFixed(1)}px`)
          card.style.setProperty('--kb-prox', prox.toFixed(3))
          touchedCards.add(card)

          if (
            dist === 0 &&
            card.classList.contains('card-lift') &&
            !card.closest('[data-tilted-card]')
          ) {
            nextHovered = { card, rect: r }
          }
        } else if (touchedCards.has(card)) {
          card.style.setProperty('--kb-prox', '0')
          touchedCards.delete(card)
        }
      }

      const nextCard = nextHovered?.card || null
      if (hoveredCard && hoveredCard !== nextCard) {
        resetTilt(hoveredCard)
        hoveredCard = null
      }

      if (nextHovered && !isInteractiveBusy(nextHovered.card)) {
        const { card, rect } = nextHovered
        hoveredCard = card
        const px = (cx - rect.left) / Math.max(1, rect.width) - 0.5
        const py = (cy - rect.top) / Math.max(1, rect.height) - 0.5
        const wide = rect.width > 540
        const maxTilt = wide ? 1.5 : 4.2
        gsap.to(card, {
          rotateX: -py * maxTilt * 2,
          rotateY: px * maxTilt * 2,
          y: wide ? -3 : -5,
          scale: wide ? 1.004 : 1.014,
          transformPerspective: 920,
          duration: 0.32,
          ease: 'power3.out',
          overwrite: 'auto',
        })
      } else if (hoveredCard && isInteractiveBusy(hoveredCard)) {
        resetTilt(hoveredCard, true)
        hoveredCard = null
      }
    }

    const onMove = (e) => {
      lastEvent = e
      if (!pendingFrame) pendingFrame = requestAnimationFrame(processPointer)
    }

    const onLeave = () => {
      if (hoveredCard) {
        resetTilt(hoveredCard)
        hoveredCard = null
      }
      for (const c of touchedCards) c.style.setProperty('--kb-prox', '0')
      touchedCards.clear()
    }

    const onDown = (e) => {
      const card = e.target?.closest?.('.bg-\\[\\#13131e\\].rounded-2xl')
      if (!card) return
      const r = card.getBoundingClientRect()
      card.style.setProperty('--kb-x', `${(e.clientX - r.left).toFixed(1)}px`)
      card.style.setProperty('--kb-y', `${(e.clientY - r.top).toFixed(1)}px`)
      gsap.fromTo(
        card,
        { '--kb-pulse': 1 },
        { '--kb-pulse': 0, duration: 0.65, ease: 'power3.out', overwrite: 'auto' },
      )
    }

    window.addEventListener('pointermove', onMove, { passive: true })
    document.addEventListener('mouseleave', onLeave, { passive: true })
    window.addEventListener('pointerdown', onDown, { passive: true })

    return () => {
      if (pendingFrame) cancelAnimationFrame(pendingFrame)
      window.removeEventListener('pointermove', onMove)
      document.removeEventListener('mouseleave', onLeave)
      window.removeEventListener('pointerdown', onDown)
      if (hoveredCard) {
        gsap.killTweensOf(hoveredCard)
        gsap.set(hoveredCard, { clearProps: 'transform,transformPerspective' })
      }
      for (const c of touchedCards) {
        c.style.removeProperty('--kb-x')
        c.style.removeProperty('--kb-y')
        c.style.removeProperty('--kb-prox')
        c.style.removeProperty('--kb-pulse')
      }
      touchedCards.clear()
    }
  }, [active])

  // --------------------------------------------------------------------------
  // 4. GSAP Kinetic Ignition Choreography on switching to Kinetic (or 1st boot)
  // --------------------------------------------------------------------------
  useEffect(() => {
    if (!active || prefersReducedMotion()) return
    const switchedToKinetic = sessionStorage.getItem(IGNITION_SWITCH_KEY) === '1'
    const alreadyBooted = sessionStorage.getItem(IGNITION_SESSION_KEY) === '1'
    if (!switchedToKinetic && alreadyBooted) return

    const outer = shockOuterRef.current
    const inner = shockInnerRef.current
    const flash = flashRef.current
    if (!outer || !inner || !flash) return

    const ctx = gsap.context(() => {
      const tl = gsap.timeline({
        onComplete: () => {
          sessionStorage.setItem(IGNITION_SESSION_KEY, '1')
          sessionStorage.removeItem(IGNITION_SWITCH_KEY)
        },
      })
      tl.fromTo(
        flash,
        { opacity: 0.28 },
        { opacity: 0, duration: 0.72, ease: 'expo.out' },
        0,
      )
      tl.fromTo(
        outer,
        { scale: 0.12, opacity: 0.92 },
        { scale: 2.35, opacity: 0, duration: 0.88, ease: 'expo.out' },
        0,
      )
      tl.fromTo(
        inner,
        { scale: 0.08, opacity: 0.85 },
        { scale: 1.85, opacity: 0, duration: 0.76, ease: 'power4.out' },
        0.07,
      )

      // Cascade visible cards in a rapid kinetic wave on live theme switch
      if (switchedToKinetic) {
        const vh = window.innerHeight
        const visibleCards = Array.from(document.querySelectorAll('.bg-\\[\\#13131e\\].rounded-2xl')).filter((el) => {
          const r = el.getBoundingClientRect()
          return r.width > 0 && r.bottom > 0 && r.top < vh
        })
        if (visibleCards.length > 0) {
          gsap.fromTo(
            visibleCards,
            { y: 18, scale: 0.96, opacity: 0.45 },
            {
              y: 0,
              scale: 1,
              opacity: 1,
              duration: 0.56,
              stagger: 0.04,
              ease: 'back.out(1.45)',
              overwrite: 'auto',
              clearProps: 'transform,opacity',
            },
          )
        }
      }
    })

    return () => ctx.revert()
  }, [active, theme])

  if (!active) return null

  return (
    <>
      <canvas
        ref={bgCanvasRef}
        aria-hidden="true"
        className="fixed inset-0 w-full h-full pointer-events-none z-0"
      />
      <canvas
        ref={fxCanvasRef}
        aria-hidden="true"
        className="fixed inset-0 w-full h-full pointer-events-none z-[9990]"
      />
      {/* Non-blocking GSAP Kinetic Ignition shockwave rings */}
      <div
        aria-hidden="true"
        className="fixed inset-0 pointer-events-none z-[9995] overflow-hidden flex items-center justify-center"
      >
        <div
          ref={flashRef}
          className="absolute inset-0 opacity-0"
          style={{
            background:
              'radial-gradient(circle at 50% 50%, rgba(0,240,255,0.42), rgba(255,46,151,0.28) 38%, rgba(124,58,237,0.16) 65%, transparent 85%)',
          }}
        />
        <div
          ref={shockOuterRef}
          className="w-[64vmin] h-[64vmin] rounded-full opacity-0"
          style={{
            border: '2px solid rgba(0, 240, 255, 0.8)',
            boxShadow: '0 0 36px rgba(0, 240, 255, 0.55), inset 0 0 28px rgba(255, 46, 151, 0.45)',
          }}
        />
        <div
          ref={shockInnerRef}
          className="absolute w-[48vmin] h-[48vmin] rounded-full opacity-0"
          style={{
            border: '2px solid rgba(255, 46, 151, 0.85)',
            boxShadow: '0 0 28px rgba(124, 58, 237, 0.6)',
          }}
        />
      </div>
    </>
  )
}
