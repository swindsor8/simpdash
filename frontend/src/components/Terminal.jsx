import { useEffect, useRef } from 'react'

// clean strips ANSI escape codes and collapses carriage-return redraws to the
// final state. community-scripts output is full of colour codes and spinner
// `\r` overwrites that render as garbage in a plain div; apt rarely uses them.
function clean(s) {
  // eslint-disable-next-line no-control-regex
  const noAnsi = s.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\x1b[=>()][0-9A-B]?/g, '')
  const segs = noAnsi.split('\r')
  return segs[segs.length - 1]
}

// Terminal renders streamed job output (the same panel used by the Updates and
// Scripts flows). Auto-scrolls to the newest line. Renders nothing until the
// first frame arrives.
export default function Terminal({ output, state }) {
  const ref = useRef(null)
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight
  }, [output])

  if (output.length === 0) return null
  const busy = state === 'running'

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs text-gray-600 font-medium">Output</span>
        {state === 'failed' && <span className="text-xs text-red-400">— exited with errors</span>}
        {state === 'succeeded' && <span className="text-xs text-emerald-400">— completed successfully</span>}
      </div>
      <div
        ref={ref}
        className="bg-[#0c0c14] border border-white/[0.06] rounded-xl p-4 h-52 overflow-y-auto font-mono text-xs leading-relaxed"
      >
        {output.map((line, i) => {
          const text = clean(line.line)
          if (!text) return null
          return (
            <div key={i} className={line.type === 'stderr' ? 'text-yellow-400' : 'text-gray-400'}>
              {text}
            </div>
          )
        })}
        {busy && <div className="text-gray-700 animate-pulse mt-1">▌</div>}
      </div>
    </div>
  )
}
