// TerminalStage — full-CRT living motion engine for the Fallout 4 "Terminal"
// theme (RobCo / Pip-Boy green-phosphor CRT). Mirrors KineticStage's zero-dep
// React Bits + GSAP architecture while staying 100% faithful to monochrome P1
// phosphor CRT physics (zero rainbow colors, zero vertical panel float):
//   1. WebGL2 Procedural CRT Phosphor Glass + Rolling V-Sync Beam + Faint
//      Pip-Boy Radar Sweep + Interactive Electron-Gun Hotspot (with 2D fallback)
//   2. 2D Tactical HUD Overlay: V.A.T.S. ClickReticle & phosphor pixel sparks,
//      drifting hex telemetry dust, phosphor persistence trail & bezel axis ticks
//   3. Global Tactical Proximity Controller: illuminates nearby panel borders &
//      HUD corner brackets (--tb-x, --tb-y, --tb-prox, --tb-pulse) with zero
//      3D tilt so CRT panels stay rigidly locked to the raster plane
//   4. GSAP CRT Degauss & Raster Lock-In sweep when switching back into Terminal.
//
// Lazy-loaded only when theme === 'terminal'; strictly respects
// prefers-reduced-motion and pauses cleanly when the tab is hidden.

import { useEffect, useRef } from 'react'
import gsap from 'gsap'
import { prefersReducedMotion } from '../lib/motionConfig'

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
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p + 34.5);
  return fract(p.x * p.y);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  float aspect = uRes.x / max(uRes.y, 1.0);
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  vec2 m = (uMouse - 0.5) * vec2(aspect, 1.0);

  float t = uTime;
  float surge = clamp(uVel, 0.0, 1.8);

  // Base P1 CRT dark glass tint
  vec3 phosphor = vec3(0.102, 1.0, 0.251); // #1aff40
  vec3 mint     = vec3(0.55, 1.0, 0.68);
  vec3 col      = vec3(0.008, 0.036, 0.010);

  // Subtle curved CRT center phosphor dome glow
  float r2 = dot(p * vec2(0.76, 1.0), p * vec2(0.76, 1.0));
  col += phosphor * exp(-r2 * 2.1) * 0.055;

  // Rolling vertical V-Sync refresh beam (accelerates subtly with scroll)
  float scanY = fract(1.0 - t * 0.14);
  float dy = uv.y - scanY;
  float wrappedDy = dy - floor(dy + 0.5);
  float beam = exp(-(wrappedDy * wrappedDy) * 145.0) * (0.085 + surge * 0.065);
  float beamTail = smoothstep(-0.18, 0.0, wrappedDy) * smoothstep(0.015, 0.0, wrappedDy) * 0.04;
  col += phosphor * (beam + beamTail);

  // Faint Pip-Boy / RobCo tactical radar rings + rotating sweep sector
  float dist = length(p);
  float rf = fract(dist * 2.8 - t * 0.06) - 0.5;
  float ringA = exp(-(rf * rf) * 650.0);
  float angle = atan(p.y, p.x);
  float sweep = fract((angle + t * 0.42) / 6.2831853);
  float radarSector = smoothstep(0.76, 1.0, sweep) * smoothstep(0.85, 0.05, dist) * 0.048;
  float radarEdge   = smoothstep(0.985, 1.0, sweep) * smoothstep(0.85, 0.04, dist) * 0.095;
  col += phosphor * (ringA * 0.032 + radarSector + radarEdge);

  // Fine oscilloscope telemetry grid lines etched softly into the tube
  vec2 grid = abs(fract(gl_FragCoord.xy / 48.0 - 0.5) - 0.5) / (1.0 / 48.0);
  float lineMask = 1.0 - min(min(grid.x, grid.y), 1.0);
  col += phosphor * lineMask * 0.028;

  // Interactive electron-gun cursor phosphor excitation + horizontal scan highlight
  float md = length(p - m);
  float hotspot = exp(-md * md * 7.5) * 0.11;
  float hLine = exp(-((uv.y - uMouse.y) * (uv.y - uMouse.y)) * 18000.0) * exp(-md * 2.2) * 0.055;
  col += mix(phosphor, mint, 0.35) * (hotspot + hLine);

  // Subtle high-frequency analog tube static grain
  float grain = (hash(gl_FragCoord.xy + floor(t * 24.0) * 13.7) - 0.5) * (0.022 + surge * 0.018);
  col += phosphor * max(grain, 0.0);

  // Authentic CRT glass edge falloff
  float vig = 1.0 - smoothstep(0.45, 1.28, length(p * vec2(0.82, 1.0)));
  col *= mix(0.55, 1.08, vig);

  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
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

const HEX_GLYPHS = '0123456789ABCDEF+:[]'
const BOOT_FLAG = 'sd-terminal-booted'
const SWITCH_FLAG = 'sd-terminal-switched'

export default function TerminalStage({ theme }) {
  const bgCanvasRef = useRef(null)
  const fxCanvasRef = useRef(null)
  const scanBeamRef = useRef(null)
  const degaussFlashRef = useRef(null)

  const mouseRef = useRef({ x: 0.5, y: 0.5, tx: 0.5, ty: 0.5, px: -999, py: -999 })
  const velRef = useRef({ current: 0, target: 0 })

  const active = theme === 'terminal'

  // --------------------------------------------------------------------------
  // 1. WebGL2 CRT Phosphor Glass + Radar + V-Sync Shader (2D fallback)
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
      const r = canvas.getBoundingClientRect()
      if (!r.width || !r.height) return
      const lx = e.clientX - r.left
      const ly = e.clientY - r.top
      mouseRef.current.tx = Math.max(0, Math.min(1, lx / r.width))
      mouseRef.current.ty = Math.max(0, Math.min(1, 1 - ly / r.height))
      mouseRef.current.px = lx
      mouseRef.current.py = ly
    }
    const onScrollVel = (e) => {
      const v = Math.min(1.8, Math.abs(Number(e.detail) || 0))
      if (v > velRef.current.target) velRef.current.target = v
    }
    window.addEventListener('pointermove', onPointer, { passive: true })
    window.addEventListener('sd-scroll-velocity', onScrollVel)

    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'low-power',
    })

    let cleanup = null
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
            const w = Math.max(1, Math.floor(canvas.clientWidth * dpr))
            const h = Math.max(1, Math.floor(canvas.clientHeight * dpr))
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
            m.x += (m.tx - m.x) * 0.09
            m.y += (m.ty - m.y) * 0.09
            velRef.current.current += (velRef.current.target - velRef.current.current) * 0.14
            velRef.current.target *= 0.86

            gl.viewport(0, 0, canvas.width, canvas.height)
            gl.uniform2f(uRes, canvas.width, canvas.height)
            gl.uniform1f(uTime, reduced ? 2.8 : (now - started) / 1000)
            gl.uniform2f(uMouse, m.x, m.y)
            gl.uniform1f(uVel, velRef.current.current)
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
          }

          cleanup = () => {
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

    // Canvas 2D phosphor fallback
    if (!renderFn) {
      const ctx = canvas.getContext('2d')
      if (ctx) {
        const resize2d = () => {
          const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
          canvas.width = Math.max(1, Math.floor(canvas.clientWidth * dpr))
          canvas.height = Math.max(1, Math.floor(canvas.clientHeight * dpr))
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        }
        resize2d()
        window.addEventListener('resize', resize2d, { passive: true })
        cleanup = () => window.removeEventListener('resize', resize2d)

        renderFn = (now) => {
          const w = canvas.clientWidth
          const h = canvas.clientHeight
          const t = reduced ? 1.5 : (now - started) / 1000
          ctx.fillStyle = '#020a02'
          ctx.fillRect(0, 0, w, h)

          const scanY = ((t * 0.14) % 1) * h
          const grad = ctx.createLinearGradient(0, scanY - 70, 0, scanY + 24)
          grad.addColorStop(0, 'rgba(26,255,64,0)')
          grad.addColorStop(0.78, 'rgba(26,255,64,0.08)')
          grad.addColorStop(1, 'rgba(26,255,64,0)')
          ctx.fillStyle = grad
          ctx.fillRect(0, scanY - 70, w, 94)
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
      cleanup?.()
    }
  }, [active])

  // --------------------------------------------------------------------------
  // 2. 2D Tactical Pip-Boy Overlay: V.A.T.S. ClickReticle, Hex Dust & Axis Ticks
  // --------------------------------------------------------------------------
  useEffect(() => {
    if (!active || prefersReducedMotion()) return
    const canvas = fxCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let alive = true
    let raf = 0
    let w = canvas.clientWidth
    let h = canvas.clientHeight
    const isFine = window.matchMedia?.('(pointer: fine)').matches

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      w = canvas.clientWidth
      h = canvas.clientHeight
      canvas.width = Math.max(1, Math.floor(w * dpr))
      canvas.height = Math.max(1, Math.floor(h * dpr))
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    window.addEventListener('resize', resize, { passive: true })

    // Drifting faint phosphor telemetry hex motes
    const motes = Array.from({ length: 24 }, (_, i) => ({
      x: ((i * 173.1) % 100) / 100 * Math.max(w, 300),
      y: ((i * 293.7) % 100) / 100 * Math.max(h, 300),
      vy: -(0.12 + (i % 4) * 0.05),
      ch: HEX_GLYPHS[i % HEX_GLYPHS.length],
      phase: i * 0.85,
    }))

    // V.A.T.S. click target-lock reticles (clean green HUD brackets + faint sonar ring)
    const reticles = []

    const onDown = (e) => {
      const r = canvas.getBoundingClientRect()
      const x = e.clientX - r.left
      const y = e.clientY - r.top
      if (x < 0 || y < 0 || x > r.width || y > r.height) return
      reticles.push({ x, y, size: 22, target: 10, ringR: 3, life: 1 })
      if (reticles.length > 8) reticles.shift()
    }

    window.addEventListener('pointerdown', onDown, { passive: true })

    let tick = 0
    const draw = () => {
      raf = 0
      if (!alive) return
      if (!document.hidden) {
        tick++
        ctx.clearRect(0, 0, w, h)
        const mx = mouseRef.current.px
        const my = mouseRef.current.py

        // 1. Drifting faint phosphor telemetry hex motes (brighten under cursor radar)
        ctx.font = '10px "Share Tech Mono", monospace'
        for (let i = 0; i < motes.length; i++) {
          const m = motes[i]
          m.y += m.vy
          if (m.y < -12) {
            m.y = h + 12
            m.x = (m.x + 157) % Math.max(w, 1)
          }
          if (tick % 48 === 0 && (i + tick) % 7 === 0) {
            m.ch = HEX_GLYPHS[(i + tick) % HEX_GLYPHS.length]
          }
          const d = mx > -100 ? Math.hypot(m.x - mx, m.y - my) : 999
          const boost = d < 120 ? (1 - d / 120) * 0.42 : 0
          const a = 0.055 + 0.04 * Math.sin(tick * 0.04 + m.phase) + boost
          ctx.fillStyle = `rgba(26, 255, 64, ${a.toFixed(3)})`
          ctx.fillText(m.ch, m.x, m.y)
        }

        // 2. CRT bezel oscilloscope axis ticks tracking cursor X & Y along glass edges
        if (isFine && mx > 0 && mx < w && my > 0 && my < h) {
          ctx.strokeStyle = 'rgba(26, 255, 64, 0.55)'
          ctx.lineWidth = 1.5
          ctx.beginPath()
          ctx.moveTo(mx, 0); ctx.lineTo(mx, 7)
          ctx.moveTo(mx, h); ctx.lineTo(mx, h - 7)
          ctx.moveTo(0, my); ctx.lineTo(7, my)
          ctx.moveTo(w, my); ctx.lineTo(w - 7, my)
          ctx.stroke()
        }

        // 3. V.A.T.S. target-lock corner brackets + subtle sonar pulse on click
        for (let i = reticles.length - 1; i >= 0; i--) {
          const rt = reticles[i]
          rt.size += (rt.target - rt.size) * 0.24
          rt.ringR += (30 - rt.ringR) * 0.16
          rt.life -= 0.045
          if (rt.life <= 0) {
            reticles.splice(i, 1)
            continue
          }
          const s = rt.size
          const arm = 5.5
          ctx.strokeStyle = `rgba(43, 255, 82, ${(rt.life * 0.85).toFixed(3)})`
          ctx.lineWidth = 1.5
          ctx.beginPath()
          ctx.moveTo(rt.x - s, rt.y - s + arm); ctx.lineTo(rt.x - s, rt.y - s); ctx.lineTo(rt.x - s + arm, rt.y - s)
          ctx.moveTo(rt.x + s - arm, rt.y - s); ctx.lineTo(rt.x + s, rt.y - s); ctx.lineTo(rt.x + s, rt.y - s + arm)
          ctx.moveTo(rt.x - s, rt.y + s - arm); ctx.lineTo(rt.x - s, rt.y + s); ctx.lineTo(rt.x - s + arm, rt.y + s)
          ctx.moveTo(rt.x + s - arm, rt.y + s); ctx.lineTo(rt.x + s, rt.y + s); ctx.lineTo(rt.x + s, rt.y + s - arm)
          ctx.stroke()

          ctx.beginPath()
          ctx.arc(rt.x, rt.y, rt.ringR, 0, Math.PI * 2)
          ctx.strokeStyle = `rgba(26, 255, 64, ${(rt.life * 0.30).toFixed(3)})`
          ctx.lineWidth = 1
          ctx.stroke()
        }
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
    }
  }, [active])

  // --------------------------------------------------------------------------
  // 3. Tactical HUD Proximity Controller (MagicBento phosphor bracket lock-on;
  //    NO 3D tilt — CRT readouts stay locked flat to the glass raster plane)
  // --------------------------------------------------------------------------
  useEffect(() => {
    if (!active || prefersReducedMotion()) return
    if (typeof window === 'undefined' || window.matchMedia?.('(pointer: coarse)').matches) return

    let pendingFrame = 0
    let lastEvent = null
    const touched = new Set()

    const process = () => {
      pendingFrame = 0
      const e = lastEvent
      if (!e) return
      const cx = e.clientX
      const cy = e.clientY
      const vh = window.innerHeight
      const PROXIMITY = 300

      const cards = document.querySelectorAll('.bg-\\[\\#13131e\\].rounded-2xl')
      for (let i = 0; i < cards.length; i++) {
        const card = cards[i]
        const r = card.getBoundingClientRect()
        if (r.bottom < -PROXIMITY || r.top > vh + PROXIMITY || r.width === 0) {
          if (touched.has(card)) {
            card.style.setProperty('--tb-prox', '0')
            touched.delete(card)
          }
          continue
        }

        const dx = cx < r.left ? r.left - cx : cx > r.right ? cx - r.right : 0
        const dy = cy < r.top ? r.top - cy : cy > r.bottom ? cy - r.bottom : 0
        const dist = Math.hypot(dx, dy)

        if (dist < PROXIMITY) {
          const prox = Math.max(0, Math.min(1, 1 - dist / PROXIMITY))
          card.style.setProperty('--tb-x', `${(cx - r.left).toFixed(1)}px`)
          card.style.setProperty('--tb-y', `${(cy - r.top).toFixed(1)}px`)
          card.style.setProperty('--tb-prox', prox.toFixed(3))
          touched.add(card)
        } else if (touched.has(card)) {
          card.style.setProperty('--tb-prox', '0')
          touched.delete(card)
        }
      }
    }

    const onMove = (e) => {
      lastEvent = e
      if (!pendingFrame) pendingFrame = requestAnimationFrame(process)
    }

    const onLeave = () => {
      for (const c of touched) c.style.setProperty('--tb-prox', '0')
      touched.clear()
    }

    const onDown = (e) => {
      const card = e.target?.closest?.('.bg-\\[\\#13131e\\].rounded-2xl')
      if (!card) return
      gsap.fromTo(
        card,
        { '--tb-pulse': 1 },
        { '--tb-pulse': 0, duration: 0.48, ease: 'power2.out', overwrite: 'auto' },
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
      for (const c of touched) {
        c.style.removeProperty('--tb-x')
        c.style.removeProperty('--tb-y')
        c.style.removeProperty('--tb-prox')
        c.style.removeProperty('--tb-pulse')
      }
      touched.clear()
    }
  }, [active])

  // --------------------------------------------------------------------------
  // 4. GSAP CRT Degauss & Raster Beam Sweep when switching back into Terminal
  //    (BootSequence handles the full once-per-session cold boot readout)
  // --------------------------------------------------------------------------
  useEffect(() => {
    if (!active || prefersReducedMotion()) return
    const alreadyBooted = sessionStorage.getItem(BOOT_FLAG) === '1'
    const switched = sessionStorage.getItem(SWITCH_FLAG) === '1'
    if (!alreadyBooted || !switched) return

    const beam = scanBeamRef.current
    const flash = degaussFlashRef.current
    if (!beam || !flash) return

    const ctx = gsap.context(() => {
      const tl = gsap.timeline({
        onComplete: () => {
          sessionStorage.removeItem(SWITCH_FLAG)
        },
      })
      tl.fromTo(
        flash,
        { opacity: 0.26 },
        { opacity: 0, duration: 0.46, ease: 'power2.out' },
        0,
      )
      tl.fromTo(
        beam,
        { yPercent: -10, opacity: 0.95 },
        { yPercent: 110, opacity: 0, duration: 0.62, ease: 'power2.inOut' },
        0,
      )

      const vh = window.innerHeight
      const visibleCards = Array.from(document.querySelectorAll('.bg-\\[\\#13131e\\].rounded-2xl')).filter((el) => {
        const r = el.getBoundingClientRect()
        return r.width > 0 && r.bottom > 0 && r.top < vh
      })
      if (visibleCards.length > 0) {
        gsap.fromTo(
          visibleCards,
          { filter: 'brightness(2.5)', scaleY: 0.95, opacity: 0.5 },
          {
            filter: 'brightness(1)',
            scaleY: 1,
            opacity: 1,
            duration: 0.44,
            stagger: 0.04,
            ease: 'power3.out',
            overwrite: 'auto',
            clearProps: 'transform,opacity,filter',
          },
        )
      }
    })

    return () => ctx.revert()
  }, [active, theme])

  if (!active) return null

  return (
    <>
      {/* Contained cleanly inside the CRT glass bezel so the outer plastic chassis stays intact */}
      <canvas
        ref={bgCanvasRef}
        aria-hidden="true"
        className="crt-stage-canvas fixed pointer-events-none z-0"
      />
      <canvas
        ref={fxCanvasRef}
        aria-hidden="true"
        className="crt-stage-canvas fixed pointer-events-none z-[9990]"
      />
      {/* Non-blocking GSAP CRT degauss + electron beam raster sweep */}
      <div
        aria-hidden="true"
        className="crt-stage-canvas fixed pointer-events-none z-[9995] overflow-hidden"
      >
        <div
          ref={degaussFlashRef}
          className="absolute inset-0 opacity-0"
          style={{
            background: 'radial-gradient(circle at 50% 50%, rgba(26,255,64,0.45), rgba(26,255,64,0.12) 60%, transparent 90%)',
          }}
        />
        <div
          ref={scanBeamRef}
          className="absolute left-0 right-0 top-0 h-16 opacity-0"
          style={{
            background: 'linear-gradient(180deg, transparent 0%, rgba(26,255,64,0.35) 55%, rgba(200,255,210,0.92) 78%, transparent 100%)',
            boxShadow: '0 0 28px rgba(26,255,64,0.65)',
          }}
        />
      </div>
    </>
  )
}
