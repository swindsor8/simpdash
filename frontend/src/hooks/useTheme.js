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
]

export function useTheme() {
  const [theme, setThemeState] = useState(() => localStorage.getItem('sd-theme') || 'default')

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
