// Self-check for the theme-aware copy contract. Run: node src/lib/copy.test.js
// Guards the property that matters most — the DEFAULT theme's copy must be
// returned verbatim (the brief forbids changing it), and terminal strings appear
// only under the terminal theme. No framework; assert + a document stub.
import assert from 'node:assert/strict'

const setTheme = (t) => { globalThis.document = { documentElement: { getAttribute: () => t } } }

setTheme(null)
const { copy, loadingText, isTerminal } = await import('./copy.js')

// Default theme: fallbacks pass through untouched, isTerminal false.
assert.equal(isTerminal(), false)
assert.equal(copy('status.live', 'Live'), 'Live')
assert.equal(copy('empty.notebook', 'Nothing here yet.'), 'Nothing here yet.')
assert.equal(loadingText('Loading…'), 'Loading…')

// Terminal theme: known ids map; unknown ids still fall back; loading is in-set.
setTheme('terminal')
assert.equal(isTerminal(), true)
assert.equal(copy('status.live', 'Live'), 'UPLINK ACTIVE')
assert.equal(copy('action.stop', 'Force stop'), 'TERMINATING PROCESS...')
assert.equal(copy('confirm.forceStop', 'x').startsWith('WARNING: HARD KILL'), true)
assert.equal(copy('no.such.id', 'fallback'), 'fallback')
const LOADING = ['SCANNING SUBNET...', 'POLLING NODE TELEMETRY...', 'SYNCING CLUSTER STATE...', 'DECRYPTING RESOURCE METRICS...', 'WARMING UP VACUUM TUBES...']
assert.ok(LOADING.includes(loadingText('Loading…')))

console.log('copy.js self-check passed')
