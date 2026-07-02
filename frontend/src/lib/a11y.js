import { useEffect, useRef } from 'react'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

// useFocusTrap — keeps Tab focus inside a modal and restores focus to the
// previously-focused element on unmount. Attach the returned ref to the
// modal's content container.
export function useFocusTrap() {
  const ref = useRef(null)
  useEffect(() => {
    const node = ref.current
    if (!node) return
    const prev = document.activeElement
    const first = node.querySelector(FOCUSABLE)
    if (first) first.focus()
    function onKey(e) {
      if (e.key !== 'Tab') return
      const items = [...node.querySelectorAll(FOCUSABLE)].filter(el => el.offsetParent !== null)
      if (items.length === 0) return
      const firstEl = items[0]
      const lastEl = items[items.length - 1]
      if (e.shiftKey && document.activeElement === firstEl) { e.preventDefault(); lastEl.focus() }
      else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); firstEl.focus() }
    }
    node.addEventListener('keydown', onKey)
    return () => {
      node.removeEventListener('keydown', onKey)
      if (prev && prev.focus) prev.focus()
    }
  }, [])
  return ref
}

// cardA11y — props that make a clickable card <div> keyboard-accessible:
// focusable, announced as a link, and activatable with Enter/Space.
export function cardA11y(onActivate, label) {
  if (!onActivate) return {}
  return {
    role: 'link',
    tabIndex: 0,
    'aria-label': label,
    onKeyDown: (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        onActivate()
      }
    },
  }
}
