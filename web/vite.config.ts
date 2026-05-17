import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const devApiProxyTarget = process.env.VITE_DEV_API_PROXY_TARGET || 'http://127.0.0.1:8787'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: devApiProxyTarget,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir:        'dist',
    emptyOutDir:   true,
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          // ── third-party vendors ──────────────────────────────────────────────
          if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/') ||
              id.includes('node_modules/react-router-dom') || id.includes('node_modules/scheduler')) {
            return 'vendor-react'
          }
          if (id.includes('node_modules/@tanstack/react-query')) return 'vendor-query'
          if (id.includes('node_modules/@tanstack/react-table') ||
              id.includes('node_modules/@tanstack/react-virtual'))  return 'vendor-table'
          if (id.includes('node_modules/recharts') || id.includes('node_modules/d3') ||
              id.includes('node_modules/victory'))                   return 'vendor-charts'
          if (id.includes('node_modules/lucide-react'))             return 'vendor-icons'
          if (id.includes('node_modules/zustand'))                  return 'vendor-store'

          // ── GL / finance feature chunk ────────────────────────────────────────
          // Only split page-level files; shared api/components stay in index
          if (id.includes('/src/pages/gl/'))                        return 'feature-gl'

          // ── HR feature chunk ──────────────────────────────────────────────────
          if (id.includes('/src/pages/hr/'))                        return 'feature-hr'

          // ── Inventory / Suppliers / Reports — grouped to avoid circular deps ──
          if (id.includes('/src/pages/inventory/') || id.includes('/src/pages/suppliers/') ||
              id.includes('/src/pages/treasury/')  || id.includes('/src/pages/reports/'))
            return 'feature-ops'
        },
      },
    },
  },
})
