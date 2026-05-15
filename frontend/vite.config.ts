import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'

const frontendRoot = fileURLToPath(new URL('.', import.meta.url))
const apiProxyTarget = process.env.VITE_API_PROXY_TARGET ?? 'http://127.0.0.1:23219'
const devHost = process.env.VITE_HOST ?? '0.0.0.0'
const devPort = Number(process.env.VITE_PORT ?? 5173)
const allowedHosts = [
  'team.hk.xunx.cc',
  ...(process.env.VITE_ALLOWED_HOSTS ?? '')
    .split(',')
    .map(host => host.trim())
    .filter(Boolean),
]

export default defineConfig({
  root: frontendRoot,
  plugins: [react(), tailwindcss()],
  base: './',
  server: {
    host: devHost,
    allowedHosts,
    port: devPort,
    strictPort: true,
    proxy: {
      '/api/v2': apiProxyTarget,
    },
  },
  preview: {
    proxy: {
      '/api/v2': apiProxyTarget,
    },
  },
})
