import { useState, useEffect, useLayoutEffect, useRef } from 'react'
import gsap from 'gsap'

// One-per-session CRT boot readout for the Terminal theme (Fallout 4 / RobCo
// OS inspired), choreographed with GSAP: CRT electron-tube horizontal snap-on,
// phosphor line warmup, and degauss burst exit. Tracked via sessionStorage so
// it replays each new session without blocking subsequent navigation. Skippable
// by click or keypress; suppressed completely under prefers-reduced-motion.
const LINES = [
  'ROBCO INDUSTRIES UNIFIED OPERATING SYSTEM',
  'SUPERDASH TERMINAL OS — REV 2.1',
  'UNREGISTERED HOMELAB DIVISION',
  'BOOT SEQUENCE INITIATED...',
  'CHECKING POWER CORE.................. OK',
  'CHECKING NODE INTEGRITY.............. OK',
  'CALIBRATING SENSOR ARRAY............. OK',
  'ESTABLISHING UPLINK................... OK',
  'LOADING CLUSTER TELEMETRY...',
  'ALL SYSTEMS NOMINAL',
  'WELCOME, OPERATOR.',
]

const FLAG = 'sd-terminal-booted'

export default function BootSequence({ theme }) {
  const [visible, setVisible] = useState(false)
  const [count, setCount] = useState(0)
  const [burst, setBurst] = useState(false)
  const [fading, setFading] = useState(false)
  const timers = useRef([])
  const done = useRef(false)
  const rootRef = useRef(null)
  const screenRef = useRef(null)

  useEffect(() => {
    if (theme !== 'terminal' || sessionStorage.getItem(FLAG)) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      sessionStorage.setItem(FLAG, '1')
      return
    }
    done.current = false
    setVisible(true)
    setCount(0)
    setBurst(false)
    setFading(false)

    // Brief pause for the GSAP CRT tube-expand animation before printing lines
    const startDelay = setTimeout(() => {
      let i = 0
      const reveal = setInterval(() => {
        i += 1
        setCount(i)
        if (i >= LINES.length) {
          clearInterval(reveal)
          timers.current.push(setTimeout(finish, 460))
        }
      }, 150)
      timers.current.push(reveal)
    }, 240)
    timers.current.push(startDelay)

    return () => {
      timers.current.forEach(t => { clearTimeout(t); clearInterval(t) })
      timers.current = []
    }
  }, [theme])

  // GSAP CRT tube power-on: thin blazing phosphor beam expands vertically into full screen
  useLayoutEffect(() => {
    if (!visible || !screenRef.current) return
    const ctx = gsap.context(() => {
      gsap.fromTo(
        screenRef.current,
        { scaleY: 0.012, scaleX: 0.72, filter: 'brightness(4.5)', opacity: 0.9 },
        {
          scaleY: 1,
          scaleX: 1,
          filter: 'brightness(1)',
          opacity: 1,
          duration: 0.36,
          ease: 'expo.out',
          clearProps: 'transform,filter,opacity',
        },
      )
    }, rootRef)
    return () => ctx.revert()
  }, [visible])

  // Subtle phosphor warmup flash on each newly revealed boot line
  useLayoutEffect(() => {
    if (!visible || count <= 0 || !screenRef.current) return
    const lines = screenRef.current.querySelectorAll('[data-boot-line]')
    const last = lines[lines.length - 1]
    if (!last) return
    gsap.fromTo(
      last,
      { opacity: 0, filter: 'brightness(2.8)', x: -4 },
      { opacity: 1, filter: 'brightness(1)', x: 0, duration: 0.22, ease: 'power2.out', clearProps: 'transform,filter,opacity' },
    )
  }, [visible, count])

  function finish() {
    if (done.current) return
    done.current = true
    timers.current.forEach(t => { clearInterval(t); clearTimeout(t) })
    timers.current = []
    setCount(LINES.length)
    setBurst(true)
    timers.current.push(setTimeout(() => setFading(true), 180))
    timers.current.push(setTimeout(() => {
      sessionStorage.setItem(FLAG, '1')
      sessionStorage.removeItem('sd-terminal-switched')
      setVisible(false)
    }, 520))
  }

  useEffect(() => {
    if (!visible) return
    const onKey = () => finish()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [visible])

  if (!visible) return null
  return (
    <div ref={rootRef} className={`crt-boot ${fading ? 'fading' : ''}`} onClick={finish} role="status" aria-label="System boot sequence">
      <div ref={screenRef} className="crt-boot-screen">
        {LINES.slice(0, count).map((l, i) => (
          <div key={i} data-boot-line="">{l}</div>
        ))}
        {count < LINES.length && <span className="cursor">&nbsp;&nbsp;</span>}
      </div>
      <div className={`crt-static ${burst ? 'run' : ''}`} />
    </div>
  )
}
