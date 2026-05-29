import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const target = env.VITE_API_BASE_URL || 'http://localhost:6400'
  const base = env.VITE_BASE_PATH || '/'

  // When deployed under a sub-path (e.g. /devall/), the browser fetches /api/*
  // but Caddy only proxies /devall/api/* to the backend. We need Vite to also
  // proxy the sub-path prefixed version so both dev and prod work correctly.
  const proxyConfig = {
    '/api': { target, changeOrigin: true },
    '/ws': { target, ws: true, changeOrigin: true },
  }
  if (base && base !== '/') {
    const stripped = base.replace(/\/$/, '') // e.g. /devall
    proxyConfig[`${stripped}/api`] = { target, changeOrigin: true, rewrite: (p) => p.replace(stripped, '') }
    proxyConfig[`${stripped}/ws`] = { target, ws: true, changeOrigin: true, rewrite: (p) => p.replace(stripped, '') }
  }

  return {
    base,
    plugins: [vue()],
    server: {
      host: true,
      allowedHosts: true,
      proxy: proxyConfig,
    }
  }
})
