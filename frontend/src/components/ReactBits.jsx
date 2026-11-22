// Theme-aware React Bits primitives (BlurText, DecryptedText, ShinyText,
// Magnet, TiltedCard, StarBorder, InteractiveGridBg) implemented cleanly on top
// of React + GSAP + HTML5 Canvas with zero extra npm dependencies.
// Every effect automatically respects prefers-reduced-motion and adapts to all
// 7 SuperDash themes (nocturne, default, retro, mario, win98, terminal, glass).

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

const SCRAMBLE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#$%&*+/<>'

// DecryptedText (React Bits) — matrix/phosphor scramble reveal that locks
// characters in left-to-right. Shines in Terminal CRT mode.
export function DecryptedText({ text, className = '', speed = 26, theme }) {
  const active = getActiveTheme(theme)
  const animate = shouldAnimate(active)
  const [display, setDisplay] = useState(text)

  useEffect(() => {
    if (!animate || !text) {
      setDisplay(text)
      return
    }
    const target = String(text)
    let revealed = 0
    let frame = 0
    const id = setInterval(() => {
      frame++
      if (frame % 2 === 0) revealed++
      let out = ''
      for (let i = 0; i < target.length; i++) {
        if (target[i] === ' ' || i < revealed) {
          out += target[i]
        } else {
          out += SCRAMBLE_CHARS[(i * 7 + frame * 13) % SCRAMBLE_CHARS.length]
        }
      }
      setDisplay(out)
      if (revealed >= target.length) {
        clearInterval(id)
        setDisplay(target)
      }
    }, speed)
    return () => clearInterval(id)
  }, [text, animate, speed])

  return <span className={className}>{display}</span>
}

// ThemedHeading — picks the signature React Bits text animation for the active
// theme: DecryptedText on Terminal, BlurText on Nocturne/Midnight/Glass, and
// crisp instant text on Retro/Super/Win98.
export function ThemedHeading({ text, theme, className = '' }) {
  const active = getActiveTheme(theme)
  if (active === 'terminal') return <DecryptedText text={text} theme={active} className={className} />
  if (FLAT_THEMES.has(active)) return <span className={className}>{text}</span>
  return <BlurText text={text} theme={active} className={className} />
}

// ShinyText (React Bits) — subtle animated specular sheen across brand text
// (adapts automatically per theme in index.css).
export function ShinyText({ children, className = '' }) {
  return <span className={`rb-shiny ${className}`}>{children}</span>
}

// Magnet (React Bits) — gentle cursor pull with smooth GSAP spring-back.
export function Magnet({ children, strength = 0.2, padding = 0, className = 'inline-flex', theme }) {
  const ref = useRef(null)

  useEffect(() => {
    const el = ref.current
    if (!el || typeof window === 'undefined') return
    if (window.matchMedia?.('(pointer: coarse)').matches) return
    const active = getActiveTheme(theme)
    if (!shouldAnimate(active) || active === 'win98') return

    const qx = gsap.quickTo(el, 'x', { duration: 0.35, ease: 'power3.out' })
    const qy = gsap.quickTo(el, 'y', { duration: 0.35, ease: 'power3.out' })

    const onMove = (e) => {
      const r = el.getBoundingClientRect()
      const cx = r.left + r.width / 2
      const cy = r.top + r.height / 2
      const dx = e.clientX - cx
      const dy = e.clientY - cy
      if (Math.abs(dx) <= r.width / 2 + padding && Math.abs(dy) <= r.height / 2 + padding) {
        qx(dx * strength)
        qy(dy * strength)
      }
    }
    const onLeave = () => { qx(0); qy(0) }

    el.addEventListener('pointermove', onMove, { passive: true })
    el.addEventListener('pointerleave', onLeave, { passive: true })
    return () => {
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerleave', onLeave)
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
// cards (e.g. Theme previews). Disabled on flat/bevel themes & touch devices.
export function TiltedCard({ children, maxTilt = 5, className = '', theme, ...rest }) {
  const ref = useRef(null)

  useEffect(() => {
    const el = ref.current
    if (!el || typeof window === 'undefined') return
    if (window.matchMedia?.('(pointer: coarse)').matches) return
    const active = getActiveTheme(theme)
    if (!shouldAnimate(active) || FLAT_THEMES.has(active)) return

    const qrx = gsap.quickTo(el, 'rotateX', { duration: 0.28, ease: 'power2.out' })
    const qry = gsap.quickTo(el, 'rotateY', { duration: 0.28, ease: 'power2.out' })

    const onMove = (e) => {
      const r = el.getBoundingClientRect()
      const px = (e.clientX - r.left) / r.width - 0.5
      const py = (e.clientY - r.top) / r.height - 0.5
      qrx(-py * maxTilt * 2)
      qry(px * maxTilt * 2)
    }
    const onLeave = () => { qrx(0); qry(0) }

    gsap.set(el, { transformPerspective: 800 })
    el.addEventListener('pointermove', onMove, { passive: true })
    el.addEventListener('pointerleave', onLeave, { passive: true })
    return () => {
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerleave', onLeave)
      gsap.set(el, { clearProps: 'transform,transformPerspective' })
    }
  }, [maxTilt, theme])

  return (
    <div ref={ref} className={className} {...rest}>
      {children}
    </div>
  )
}

// StarBorder (React Bits) — subtle animated luminous border sweep around a
// highlight trigger or CTA (adapts per theme in index.css).
export function StarBorder({ children, className = '' }) {
  return (
    <span className={`rb-star-border ${className}`}>
      {children}
    </span>
  )
}

// InteractiveGridBg (React Bits Squares + LetterGlitch inspired) — lightweight
// canvas ambient background for auth screens (Login / SetupPassword) that
// adapts its visual language to all 7 themes.
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
