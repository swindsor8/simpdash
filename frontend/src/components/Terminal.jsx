import { useEffect, useRef } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'

// Terminal renders streamed job output in a real terminal emulator (xterm.js),
// shared by the Updates and Scripts flows. Interactive (PTY) jobs send their
// raw output as {type:"out",data} frames — full ANSI, whiptail menus, cursor
// moves — which only a terminal emulator can render; keystrokes are streamed
// back via sendInput. Non-interactive apt jobs still arrive as line-typed
// stdout/stderr frames and are written line by line.
//
// Fixed 90x28 to match the server PTY size so whiptail menus align (see
// runPTY in the executor). Resize support would mean a control message both ways.
export default function Terminal({ output, state, sendInput }) {
  const elRef = useRef(null)
  const termRef = useRef(null)
  const writtenRef = useRef(0)

  // Create the emulator once and wire keystroke input.
  useEffect(() => {
    const term = new XTerm({
      cols: 90,
      rows: 28,
      fontFamily: 'ui-monospace, "Courier New", monospace',
      fontSize: 12,
      cursorBlink: true,
      theme: { background: '#0c0c14', foreground: '#d4d4d4' },
    })
    term.open(elRef.current)
    const sub = term.onData(d => sendInput && sendInput(d))
    termRef.current = term
    writtenRef.current = 0 // fresh emulator → repaint all frames from the start
    return () => { sub.dispose(); term.dispose(); termRef.current = null }
  }, [sendInput])

  // New job (output reset to []) → clear the screen and the write cursor.
  useEffect(() => {
    if (output.length === 0 && termRef.current) {
      termRef.current.reset()
      writtenRef.current = 0
    }
  }, [output])

  // Write only frames we haven't written yet (xterm is imperative; output grows).
  useEffect(() => {
    const term = termRef.current
    if (!term) return
    for (let i = writtenRef.current; i < output.length; i++) {
      const f = output[i]
      if (f.type === 'out') term.write(f.data)
      else term.write((f.line ?? '') + '\r\n')
    }
    writtenRef.current = output.length
  }, [output])

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs text-gray-600 font-medium">Output</span>
        {state === 'failed' && <span className="text-xs text-red-400">— exited with errors</span>}
        {state === 'succeeded' && <span className="text-xs text-emerald-400">— completed successfully</span>}
        {state === 'running' && <span className="text-xs text-gray-600">— use arrow keys / enter for menus</span>}
      </div>
      <div
        ref={elRef}
        className="bg-[#0c0c14] border border-white/[0.06] rounded-xl p-2 overflow-auto"
      />
    </div>
  )
}
