import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // API_TARGET overrides the backend for local dev (e.g. when :8000 is taken)
      '/api': { target: process.env.API_TARGET || 'http://localhost:8000', rewrite: (p) => p.replace(/^\/api/, '') },
    },
  },
})
