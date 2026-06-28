import { useState, useEffect } from 'react'

export const THEMES = [
  {
    id: 'default',
    name: 'Midnight',
    description: 'The default dark theme.',
  },
  {
    id: 'retro',
    name: 'Retro',
    description: 'Deep navy with burnt orange accents.',
  },
  {
    id: 'mario',
    name: 'Super',
    description: '8-bit NES sky blue, gold blocks, pixel font.',
  },
  {
    id: 'win98',
    name: 'Win98',
    description: 'Silver bevels, teal desktop, navy title bars.',
  },
  {
    id: 'terminal',
    name: 'Terminal',
    description: 'Green-phosphor CRT: scanlines, glow, boot sequence.',
  },
  {
    id: 'glass',
    name: 'Liquid Glass',
    description: 'Frosted translucent panels over a drifting aurora.',
  },
]

export function useTheme() {
  const [theme, setThemeState] = useState(() => {
    const saved = localStorage.getItem('sd-theme')
    if (saved === 'fallout') return 'terminal' // renamed; migrate old selection
    return saved || 'default'
  })

  useEffect(() => {
    if (theme === 'default') {
      document.documentElement.removeAttribute('data-theme')
    } else {
      document.documentElement.setAttribute('data-theme', theme)
    }
    localStorage.setItem('sd-theme', theme)
  }, [theme])

  return { theme, setTheme: setThemeState }
}
