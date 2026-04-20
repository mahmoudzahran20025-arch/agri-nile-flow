import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'https://agri-nile-flow.zahranmalk2.workers.dev',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir:        'dist',
    emptyOutDir:   true,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor:  ['react', 'react-dom', 'react-router-dom'],
          query:   ['@tanstack/react-query'],
          table:   ['@tanstack/react-table', '@tanstack/react-virtual'],
        },
      },
    },
  },
})
