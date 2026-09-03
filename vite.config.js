import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // injectManifest (em vez de generateSW): o service worker é o nosso,
      // src/sw.js, para poder tratar eventos `push` e `notificationclick` —
      // o modo generateSW não permite código customizado no SW.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Agenda Semanal',
        short_name: 'Agenda',
        description: 'Papéis → objetivos → atividades, semana a semana.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#f2f2f3',
        theme_color: '#5980a6',
        orientation: 'portrait',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      injectManifest: {
        // app pequena, sem API — cachear tudo o que o build gera chega
        // para abrir offline depois da primeira visita.
        globPatterns: ['**/*.{js,css,html,svg,png}'],
      },
    }),
  ],
})
