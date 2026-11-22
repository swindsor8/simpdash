// Theme-aware React Bits primitives (BlurText, SplitText, GradientText,
// DecryptedText, ShinyText, Magnet, TiltedCard, StarBorder, InteractiveGridBg)
// implemented cleanly on top of React + GSAP + HTML5 Canvas with zero extra npm
// dependencies. Every effect automatically respects prefers-reduced-motion and
// adapts across all 8 SuperDash themes (nocturne, default, retro, mario, win98,
// terminal, glass, kinetic).

import { useState, useEffect, useLayoutEffect, useRef } from 'react'
import gsap from 'gsap'
import { prefersReducedMotion, shouldAnimate, getActiveTheme } from '../lib/motionConfig'

const FLAT_THEMES = new Set(['win98', 'retro', 'mario'])

// BlurText (React Bits) — smooth word-by-word blur-to-sharp entrance via GSAP.
export function BlurText({ text, className = '', delay = 0, step = 0.045, theme }) {
  const ref = useRef(null)
  const active = getActiveTheme(theme)
  const animate = shouldAnimate(active) && !FLAT_THEMES.has(active) && active !== 'terminal'

  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !animate) return
    const words = el.querySelectorAll('[data-bw]')
    if (!words.length) return
    const ctx = gsap.context(() => {
      gsap.fromTo(
        words,
        { opacity: 0, y: 7, filter: 'blur(7px)' },
        {
          opacity: 1,
          y: 0,
          filter: 'blur(0px)',
          duration: 0.42,
          delay,
          stagger: step,
          ease: 'power3.out',
          clearProps: 'transform,opacity,filter',
        },
      )
    }, ref)
    return () => ctx.revert()
  }, [text, animate, delay, step])

  if (!animate) return <span className={className}>{text}</span>

  const words = String(text).split(' ')
  return (
    <span ref={ref} className={className}>
      {words.map((w, i) => (
        <span key={`${w}-${i}`} data-bw="" className="inline-block will-change-transform">
          {w}{i < words.length - 1 ? '\u00A0' : ''}
        </span>
      ))}
    </span>
  )
}

// SplitText (React Bits) — character-by-character 3D perspective flip + elastic
// spring entrance via GSAP, plus an interactive hover character wave. Signature
// heading animation for the Kinetic theme.
export function SplitText({ text, className = '', delay = 0, step = 0.022, theme }) {
  const ref = useRef(null)
  const hoverBusyRef = useRef(false)
  const active = getActiveTheme(theme)
  const animate = shouldAnimate(active) && !FLAT_THEMES.has(active)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !animate) return
    const chars = el.querySelectorAll('[data-sc]')
    if (!chars.length) return
    const ctx = gsap.context(() => {
      gsap.fromTo(
        chars,
        {
          opacity: 0,
          y: 16,
          rotateX: -72,
          scale: 0.78,
          filter: 'blur(5px)',
          transformPerspective: 700,
        },
        {
          opacity: 1,
          y: 0,
          rotateX: 0,
          scale: 1,
          filter: 'blur(0px)',
          duration: 0.56,
          delay,
          stagger: step,
          ease: 'back.out(1.85)',
          clearProps: 'transform,opacity,filter,transformPerspective',
        },
      )
    }, ref)
    return () => ctx.revert()
  }, [text, animate, delay, step])

  const handleWave = () => {
    const el = ref.current
    if (!el || !animate || hoverBusyRef.current) return
    const chars = el.querySelectorAll('[data-sc]')
    if (!chars.length) return
    hoverBusyRef.current = true
    gsap.timeline({
      onComplete: () => {
        hoverBusyRef.current = false
      },
    })
      .to(chars, {
        y: -4,
        scale: 1.12,
        duration: 0.16,
        stagger: 0.016,
        ease: 'power2.out',
      })
      .to(
        chars,
        {
          y: 0,
          scale: 1,
          duration: 0.42,
          stagger: 0.016,
          ease: 'elastic.out(1, 0.48)',
          clearProps: 'transform',
        },
        0.1,
      )
  }

  if (!animate) return <span className={className}>{text}</span>

  const words = String(text).split(' ')
  return (
    <span ref={ref} onPointerEnter={handleWave} className={`inline-block ${className}`}>
      {words.map((word, wi) => (
        <span key={`${word}-${wi}`} className="inline-block whitespace-nowrap">
          {Array.from(word).map((ch, ci) => (
            <span
              key={`${wi}-${ci}`}
              data-sc=""
              className="rb-split-char inline-block will-change-transform"
            >
              {ch}
            </span>
          ))}
          {wi < words.length - 1 ? '\u00A0' : ''}
        </span>
      ))}
    </span>
  )
}

// GradientText (React Bits) — animated flowing multi-stop chromatic gradient text.
export function GradientText({ children, className = '' }) {
  return <span className={`rb-gradient-text ${className}`}>{children}</span>
}

const SCRAMBLE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#$%&*+/<>[]'

// DecryptedText (React Bits) — RobCo/Pip-Boy phosphor scramble reveal that
// locks characters in left-to-right with a blazing leading block cursor, GSAP
// phosphor bloom on lock, and interactive hover re-decrypt telemetry scan.
export function DecryptedText({ text, className = '', speed = 24, theme }) {
  const active = getActiveTheme(theme)
  const animate = shouldAnimate(active)
  const [display, setDisplay] = useState(text)
  const [scanning, setScanning] = useState(false)
  const [scanTick, setScanTick] = useState(0)
  const spanRef = useRef(null)
  const busyRef = useRef(false)

  useEffect(() => {
    if (!animate || !text) {
      setDisplay(text)
      setScanning(false)
      return
    }
    const target = String(text)
    let revealed = 0
    let frame = 0
    busyRef.current = true
    setScanning(true)
    const id = setInterval(() => {
      frame++
      if (frame % 2 === 0) revealed++
      let out = ''
      for (let i = 0; i < target.length; i++) {
        if (target[i] === ' ' || i < revealed) {
          out += target[i]
        } else if (i === revealed) {
          out += '█'
        } else {
          out += SCRAMBLE_CHARS[(i * 7 + frame * 13) % SCRAMBLE_CHARS.length]
        }
      }
      setDisplay(out)
      if (revealed >= target.length) {
        clearInterval(id)
        setDisplay(target)
        setScanning(false)
        busyRef.current = false
        if (spanRef.current) {
          gsap.fromTo(
            spanRef.current,
            { filter: 'brightness(2.2)' },
            { filter: 'brightness(1)', duration: 0.32, ease: 'power2.out', clearProps: 'filter' },
          )
        }
      }
    }, speed)
    return () => {
      clearInterval(id)
      busyRef.current = false
      setScanning(false)
    }
  }, [text, animate, speed, scanTick])

  const handleRescan = () => {
    if (!animate || busyRef.current) return
    setScanTick((n) => n + 1)
  }

  return (
    <span
      ref={spanRef}
      onPointerEnter={handleRescan}
      className={`rb-crt-heading ${scanning ? 'is-scanning' : ''} ${className}`}
    >
      {display}
    </span>
  )
}

// ThemedHeading — picks the signature React Bits text animation for the active
// theme: DecryptedText on Terminal, SplitText 3D wave on Kinetic, BlurText on
// Nocturne/Midnight/Glass, and crisp instant text on Retro/Super/Win98.
export function ThemedHeading({ text, theme, className = '' }) {
  const active = getActiveTheme(theme)
  if (active === 'terminal') return <DecryptedText text={text} theme={active} className={className} />
  if (active === 'kinetic') return <SplitText text={text} theme={active} className={`rb-kinetic-heading ${className}`} />
  if (FLAT_THEMES.has(active)) return <span className={className}>{text}</span>
  return <BlurText text={text} theme={active} className={className} />
}

// ShinyText (React Bits) — subtle animated specular sheen across brand text
// (adapts automatically per theme in index.css).
export function ShinyText({ children, className = '' }) {
  return <span className={`rb-shiny ${className}`}>{children}</span>
}

// Magnet (React Bits) — cursor pull with smooth GSAP spring-back (upgrades to
// elastic physics on Kinetic).
export function Magnet({ children, strength = 0.2, padding = 0, className = 'inline-flex', theme }) {
  const ref = useRef(null)

  useEffect(() => {
    const el = ref.current
    if (!el || typeof window === 'undefined') return
    if (window.matchMedia?.('(pointer: coarse)').matches) return
    const active = getActiveTheme(theme)
    // Win98 & Terminal CRT controls sit rigidly on their plane (no magnetic float)
    if (!shouldAnimate(active) || active === 'win98' || active === 'terminal') return

    const isKinetic = active === 'kinetic'
    const pull = isKinetic ? strength * 1.55 : strength
    const qx = gsap.quickTo(el, 'x', { duration: isKinetic ? 0.28 : 0.35, ease: 'power3.out' })
    const qy = gsap.quickTo(el, 'y', { duration: isKinetic ? 0.28 : 0.35, ease: 'power3.out' })

    const onMove = (e) => {
      const r = el.getBoundingClientRect()
      const cx = r.left + r.width / 2
      const cy = r.top + r.height / 2
      const dx = e.clientX - cx
      const dy = e.clientY - cy
      if (Math.abs(dx) <= r.width / 2 + padding && Math.abs(dy) <= r.height / 2 + padding) {
        qx(dx * pull)
        qy(dy * pull)
      }
    }
    const onLeave = () => {
      if (isKinetic) {
        gsap.to(el, { x: 0, y: 0, duration: 0.68, ease: 'elastic.out(1, 0.42)', overwrite: 'auto' })
      } else {
        qx(0)
        qy(0)
      }
    }

    el.addEventListener('pointermove', onMove, { passive: true })
    el.addEventListener('pointerleave', onLeave, { passive: true })
    return () => {
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerleave', onLeave)
      gsap.killTweensOf(el)
      gsap.set(el, { clearProps: 'x,y' })
    }
  }, [strength, padding, theme])

  return (
    <span ref={ref} className={className}>
      {children}
    </span>
  )
}

// TiltedCard (React Bits) — smooth 3D perspective tilt on hover for showcase
// cards (e.g. Theme previews). Disabled on flat/bevel themes & touch devices;
// amps up with elastic spring-back and scale pop on Kinetic.
export function TiltedCard({ children, maxTilt = 5, className = '', theme, ...rest }) {
  const ref = useRef(null)

  useEffect(() => {
    const el = ref.current
    if (!el || typeof window === 'undefined') return
    if (window.matchMedia?.('(pointer: coarse)').matches) return
    const active = getActiveTheme(theme)
    if (!shouldAnimate(active) || FLAT_THEMES.has(active) || active === 'terminal') return

    const isKinetic = active === 'kinetic'
    const tilt = isKinetic ? maxTilt * 1.65 : maxTilt
    const qrx = gsap.quickTo(el, 'rotateX', { duration: 0.28, ease: 'power2.out' })
    const qry = gsap.quickTo(el, 'rotateY', { duration: 0.28, ease: 'power2.out' })

    const onMove = (e) => {
      const r = el.getBoundingClientRect()
      const px = (e.clientX - r.left) / r.width - 0.5
      const py = (e.clientY - r.top) / r.height - 0.5
      qrx(-py * tilt * 2)
      qry(px * tilt * 2)
      if (isKinetic) {
        gsap.to(el, { scale: 1.022, duration: 0.28, ease: 'power2.out', overwrite: 'auto' })
      }
    }
    const onLeave = () => {
      if (isKinetic) {
        gsap.to(el, {
          rotateX: 0,
          rotateY: 0,
          scale: 1,
          duration: 0.65,
          ease: 'elastic.out(1, 0.5)',
          overwrite: 'auto',
        })
      } else {
        qrx(0)
        qry(0)
      }
    }

    gsap.set(el, { transformPerspective: 800 })
    el.addEventListener('pointermove', onMove, { passive: true })
    el.addEventListener('pointerleave', onLeave, { passive: true })
    return () => {
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerleave', onLeave)
      gsap.killTweensOf(el)
      gsap.set(el, { clearProps: 'transform,transformPerspective' })
    }
  }, [maxTilt, theme])

  return (
    <div ref={ref} data-tilted-card="" className={className} {...rest}>
      {children}
    </div>
  )
}

// StarBorder (React Bits) — animated luminous border sweep around a highlight
// trigger or CTA (upgrades to 360° rotating chromatic plasma comet on Kinetic).
export function StarBorder({ children, className = '' }) {
  return (
    <span className={`rb-star-border ${className}`}>
      {children}
    </span>
  )
}

// InteractiveGridBg (React Bits Squares + LetterGlitch + DotGrid inspired) —
// lightweight canvas ambient background for auth screens (Login / SetupPassword)
// that adapts its visual language to all 8 themes.
export function InteractiveGridBg({ theme }) {
  const canvasRef = useRef(null)
  const active = getActiveTheme(theme)

  useEffect(() => {
    if (active === 'win98') return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const reduced = prefersReducedMotion()
    let raf = 0
    let w = 0
    let h = 0
    let offset = 0
    let mouse = { x: -999, y: -999 }
    const squareSize = active === 'mario' ? 36 : 44

    // Palette per theme
    const palette = {
      nocturne: { line: 'rgba(155,153,254,0.08)', fill: 'rgba(43,200,183,0.14)' },
      default:  { line: 'rgba(79,70,229,0.08)',   fill: 'rgba(13,148,136,0.12)' },
      retro:    { line: 'rgba(18,19,49,0.10)',    fill: 'rgba(242,76,0,0.14)' },
      mario:    { line: 'rgba(255,255,255,0.22)', fill: 'rgba(251,208,0,0.32)' },
      terminal: { line: 'rgba(26,255,64,0.12)',   fill: 'rgba(26,255,64,0.22)' },
      glass:    { line: 'rgba(255,255,255,0.10)', fill: 'rgba(255,255,255,0.16)' },
      kinetic:  { line: 'rgba(0,240,255,0.16)',   fill: 'rgba(255,46,151,0.24)' },
    }[active] || { line: 'rgba(255,255,255,0.07)', fill: 'rgba(59,130,246,0.14)' }

    // Pre-seed LetterGlitch glyphs for terminal theme
    let glyphs = []
    const GLYPH_SET = '01ABCDEF[]<>:/#$%'
    const rebuildGlyphs = () => {
      const cols = Math.ceil(w / 28) + 1
      const rows = Math.ceil(h / 28) + 1
      glyphs = []
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if ((r * 17 + c * 31) % 5 === 0) {
            glyphs.push({
              x: c * 28 + 10,
              y: r * 28 + 18,
              ch: GLYPH_SET[(r * 7 + c * 11) % GLYPH_SET.length],
              a: 0.08 + ((r + c) % 4) * 0.04,
            })
          }
        }
      }
    }

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      w = canvas.clientWidth
      h = canvas.clientHeight
      canvas.width = Math.max(1, Math.floor(w * dpr))
      canvas.height = Math.max(1, Math.floor(h * dpr))
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      if (active === 'terminal') rebuildGlyphs()
    }

    const onMove = (e) => {
      const r = canvas.getBoundingClientRect()
      mouse = { x: e.clientX - r.left, y: e.clientY - r.top }
    }
    const onLeave = () => { mouse = { x: -999, y: -999 } }

    resize()
    window.addEventListener('resize', resize, { passive: true })
    window.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('pointerleave', onLeave, { passive: true })

    let tick = 0
    const draw = () => {
      ctx.clearRect(0, 0, w, h)
      tick++

      if (active === 'terminal') {
        ctx.font = '12px monospace'
        for (let i = 0; i < glyphs.length; i++) {
          const g = glyphs[i]
          if (!reduced && tick % 24 === 0 && Math.random() < 0.08) {
            g.ch = GLYPH_SET[Math.floor(Math.random() * GLYPH_SET.length)]
          }
          const dist = Math.hypot(g.x - mouse.x, g.y - mouse.y)
          const boost = dist < 110 ? (1 - dist / 110) * 0.45 : 0
          ctx.fillStyle = `rgba(26, 255, 64, ${(g.a + boost).toFixed(3)})`
          ctx.fillText(g.ch, g.x, g.y)
        }
      } else if (active === 'kinetic') {
        // React Bits DotGrid + magnetic wave constellation layered over KineticStage
        const gap = 38
        const t = reduced ? 0 : tick * 0.032
        const nearPts = []

        for (let x = gap * 0.5; x < w; x += gap) {
          for (let y = gap * 0.5; y < h; y += gap) {
            const wave = Math.sin(x * 0.015 + y * 0.012 - t) * 0.5 + 0.5
            const dx = x - mouse.x
            const dy = y - mouse.y
            const dist = Math.hypot(dx, dy)
            let px = x
            let py = y
            let r = 1.2 + wave * 1.1
            let alpha = 0.14 + wave * 0.2

            if (dist < 165 && dist > 0.1) {
              const pull = (1 - dist / 165)
              px += (dx / dist) * pull * 14
              py += (dy / dist) * pull * 14
              r += pull * 2.2
              alpha += pull * 0.6
              nearPts.push({ x: px, y: py, pull })
            }

            ctx.beginPath()
            ctx.arc(px, py, r, 0, Math.PI * 2)
            ctx.fillStyle = dist < 165
              ? `rgba(0, 240, 255, ${Math.min(0.95, alpha).toFixed(3)})`
              : `rgba(167, 139, 250, ${alpha.toFixed(3)})`
            ctx.fill()
          }
        }

        // Luminous constellation links near the cursor
        if (nearPts.length > 1) {
          ctx.lineWidth = 0.85
          for (let i = 0; i < nearPts.length; i++) {
            const a = nearPts[i]
            for (let j = i + 1; j < nearPts.length; j++) {
              const b = nearPts[j]
              const d = Math.hypot(a.x - b.x, a.y - b.y)
              if (d < gap * 1.65) {
                const op = (1 - d / (gap * 1.65)) * Math.min(a.pull, b.pull) * 0.55
                ctx.strokeStyle = `rgba(255, 46, 151, ${op.toFixed(3)})`
                ctx.beginPath()
                ctx.moveTo(a.x, a.y)
                ctx.lineTo(b.x, b.y)
                ctx.stroke()
              }
            }
          }
        }
      } else {
        if (!reduced) offset = (offset + 0.25) % squareSize
        ctx.strokeStyle = palette.line
        ctx.lineWidth = 1

        const startX = -squareSize + offset
        const startY = -squareSize + offset

        for (let x = startX; x < w + squareSize; x += squareSize) {
          for (let y = startY; y < h + squareSize; y += squareSize) {
            if (
              mouse.x >= x && mouse.x < x + squareSize &&
              mouse.y >= y && mouse.y < y + squareSize
            ) {
              ctx.fillStyle = palette.fill
              ctx.fillRect(x, y, squareSize, squareSize)
            }
            ctx.strokeRect(x + 0.5, y + 0.5, squareSize, squareSize)
          }
        }
      }

      if (!reduced) raf = requestAnimationFrame(draw)
    }

    draw()

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerleave', onLeave)
    }
  }, [active])

  if (active === 'win98') return null

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="fixed inset-0 w-full h-full pointer-events-none z-0"
    />
  )
}
