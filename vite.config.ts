import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const API_PORT = process.env.PORT || 8787

export default defineConfig({
  root: 'web',
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5199,
    proxy: {
      '/api': { target: `http://127.0.0.1:${API_PORT}`, changeOrigin: true },
      '/ws': { target: `ws://127.0.0.1:${API_PORT}`, ws: true },
    },
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
})
