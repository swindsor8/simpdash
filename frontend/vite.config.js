import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'SuperDash',
        short_name: 'SuperDash',
        description: 'Self-hosted Proxmox VE homelab dashboard',
        theme_color: '#0a0b0f',
        background_color: '#0a0b0f',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache the app shell only — JS/CSS/HTML/fonts + the PWA icons.
        // Deliberately NOT '**/*.png' so the ~2MB favicon logo isn't precached.
        globPatterns: ['**/*.{js,css,html,woff,woff2,ttf}', 'icons/*.png'],
        navigateFallback: '/index.html',
        // Every /api/* request (REST + the WebSocket streams under /api/.../stream)
        // must always hit the network. No runtimeCaching rule is defined, so nothing
        // is cached at runtime; the denylist also keeps the SPA fallback off /api.
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
  build: {
    outDir: '../backend/web/dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1000,
  },
  server: {
    proxy: {
      '/api': 'http://localhost:7575',
    },
  },
})
