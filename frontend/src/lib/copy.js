// Theme-aware copy. Components call copy(id, fallback) / loadingText(fallback)
// for user-facing strings; under the Terminal theme they get the terse uppercase
// CRT-flavored variant, otherwise the default-theme fallback passed in. The active
// theme is read straight off the <html data-theme> attribute (set synchronously by
// useTheme), so no theme prop has to be threaded through every component.
// ponytail: single global lookup keyed off the DOM attr — add a real i18n layer
// only if a second non-English theme variant ever lands.

export function isTerminal() {
  return typeof document !== 'undefined' &&
    document.documentElement.getAttribute('data-theme') === 'terminal'
}

// Terminal-theme string table. Keys are stable ids; values replace the default
// copy ONLY when the terminal theme is active.
const TERMINAL = {
  // Connection status
  'status.live': 'UPLINK ACTIVE',
  'status.lost': 'SIGNAL LOST',
  'status.reconnecting': 'RE-ESTABLISHING UPLINK...',
  // Power action in-flight labels (idle label stays the plain verb)
  'action.start': 'INITIALIZING...',
  'action.shutdown': 'POWERING DOWN...',
  'action.reboot': 'CYCLING POWER...',
  'action.stop': 'TERMINATING PROCESS...',
  'action.working': 'PROCESSING...',
  // Confirmation modal
  'confirm.node': 'WARNING: THIS ACTION AFFECTS ALL GUESTS ON THIS NODE. PROCEED?',
  'confirm.forceStop': 'WARNING: HARD KILL TERMINATES THE PROCESS IMMEDIATELY. UNSAVED STATE WILL BE LOST. PROCEED?',
  'confirm.selfNode': "WARNING: THIS TERMINAL'S HOST NODE IS THE TARGET. CONNECTION WILL DROP UNTIL THE NODE RETURNS ONLINE.",
  // Action result toasts
  'toast.fail': 'ACTION FAILED — CHECK NODE STATUS',
  // Empty states
  'empty.notebook': 'NO LOGS ON FILE.',
  'empty.serviceLink': 'NO TERMINAL LINK CONFIGURED',
  // Monitor-only (no agent on a visible cluster node)
  'badge.monitor': 'PASSIVE SCAN ONLY — NO AGENT LINK',
}

// Rotating first-load / skeleton placeholders — one picked at random per load.
const LOADING = [
  'SCANNING SUBNET...',
  'POLLING NODE TELEMETRY...',
  'SYNCING CLUSTER STATE...',
  'DECRYPTING RESOURCE METRICS...',
  'WARMING UP VACUUM TUBES...',
]

// copy(id, fallback) → terminal variant when active and known, else the fallback.
export function copy(id, fallback) {
  return isTerminal() && id in TERMINAL ? TERMINAL[id] : fallback
}

// loadingText(fallback) → a random terminal loading line, else the fallback.
// Memoize at the call site (useMemo with [] deps) so it stays stable per mount.
export function loadingText(fallback) {
  return isTerminal() ? LOADING[Math.floor(Math.random() * LOADING.length)] : fallback
}
