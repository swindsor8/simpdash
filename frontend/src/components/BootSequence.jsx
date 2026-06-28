import { useState, useEffect, useRef } from 'react'

// One-per-session CRT boot readout for the Terminal theme. Tracked via
// sessionStorage so it replays each new session but never blocks subsequent
// navigation. Skippable by click or keypress. Under prefers-reduced-motion it is
// suppressed entirely (flag set, nothing rendered) for an instant transition.
const LINES = [
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
  const [count, setCount] = useState(0)   // lines revealed so far
  const [burst, setBurst] = useState(false)
  const [fading, setFading] = useState(false)
  const timers = useRef([])
  const done = useRef(false)

  useEffect(() => {
    if (theme !== 'terminal' || sessionStorage.getItem(FLAG)) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      sessionStorage.setItem(FLAG, '1') // reduced motion → instant, no overlay
      return
    }
    done.current = false
    setVisible(true); setCount(0); setBurst(false); setFading(false)
    let i = 0
    const reveal = setInterval(() => {
      i += 1
      setCount(i)
      if (i >= LINES.length) {
        clearInterval(reveal)
        timers.current.push(setTimeout(finish, 500))
      }
    }, 170)
    timers.current.push(reveal)
    return () => {
      timers.current.forEach(t => { clearTimeout(t); clearInterval(t) })
      timers.current = []
    }
  }, [theme])

  function finish() {
    if (done.current) return
    done.current = true
    timers.current.forEach(t => clearInterval(t)) // stop any running reveal
    setCount(LINES.length)
    setBurst(true)                                  // brief static burst
    timers.current.push(setTimeout(() => setFading(true), 200))
    timers.current.push(setTimeout(() => {
      sessionStorage.setItem(FLAG, '1')
      setVisible(false)
    }, 560))
  }

  // Skip on any keypress while the sequence is on screen.
  useEffect(() => {
    if (!visible) return
    const onKey = () => finish()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [visible])

  if (!visible) return null
  return (
    <div className={`crt-boot ${fading ? 'fading' : ''}`} onClick={finish} role="status" aria-label="System boot sequence">
      {LINES.slice(0, count).map((l, i) => <div key={i}>{l}</div>)}
      {count < LINES.length && <span className="cursor">&nbsp;&nbsp;</span>}
      <div className={`crt-static ${burst ? 'run' : ''}`} />
    </div>
  )
}
