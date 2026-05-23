import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        configure: (proxy) => {
          // Prevent unhandled 'error' events from crashing the Vite process
          // when the FastAPI backend is unavailable (ECONNREFUSED).
          proxy.on('error', (err, _req, res) => {
            console.warn('[vite proxy] /api error:', err.message)
            if ('writeHead' in res && typeof res.writeHead === 'function') {
              res.writeHead(502, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ detail: 'Backend unavailable' }))
            }
          })
        },
      },
      '/icons': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('error', (err) => { console.warn('[vite proxy] /icons error:', err.message) })
        },
      },
      '/aa-assets': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('error', (err) => { console.warn('[vite proxy] /aa-assets error:', err.message) })
        },
      },
      '/spell-icons': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('error', (err) => { console.warn('[vite proxy] /spell-icons error:', err.message) })
        },
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
