import { useState, useEffect } from 'react'

export const THEMES = [
  {
    id: 'nocturne',
    name: 'Nocturne',
    description: 'Near-black canvas, indigo→teal brand glow. The default.',
  },
  {
    id: 'default',
    name: 'Midnight',
    description: 'Light counterpart to Nocturne — same brand, bright canvas.',
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

export const THEME_META_COLORS = {
  nocturne: '#09090e',
  default: '#f5f6fb',
  retro: '#ebe6ef',
  mario: '#5c94fc',
  win98: '#008080',
  terminal: '#020a02',
  glass: '#0b0e1e',
}

export function useTheme() {
  const [theme, setThemeState] = useState(() => {
    const saved = localStorage.getItem('sd-theme')
    if (saved === 'fallout') return 'terminal' // renamed; migrate old selection
    return saved || 'nocturne'
  })

  useEffect(() => {
    // Every theme (including 'default'/Midnight, now a light skin) is a
    // [data-theme] override block; the raw un-themed base is only the pre-JS state.
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('sd-theme', theme)
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.setAttribute('content', THEME_META_COLORS[theme] || '#09090e')
  }, [theme])

  return { theme, setTheme: setThemeState }
}
