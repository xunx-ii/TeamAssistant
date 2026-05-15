import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'

const frontendRoot = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  root: frontendRoot,
  plugins: [react(), tailwindcss()],
  base: './',
  server: {
    proxy: {
      '/api/v2': process.env.VITE_API_PROXY_TARGET ?? 'http://127.0.0.1:23219',
    },
  },
})
