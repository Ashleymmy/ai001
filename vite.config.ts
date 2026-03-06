import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const backendPort = env.VITE_BACKEND_PORT || '18001'
  const backendTarget = (env.VITE_API_BASE || `http://127.0.0.1:${backendPort}`).replace(/\/+$/, '')

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        'wavesurfer.js': path.resolve(__dirname, './vendor/wavesurfer.js/index.js')
      }
    },
    base: './',
    server: {
      host: '0.0.0.0',
      port: 5174,
      strictPort: true,
      proxy: {
        '/api': {
          target: backendTarget,
          changeOrigin: true,
          ws: true
        },
        '/health': {
          target: backendTarget,
          changeOrigin: true
        }
      }
    }
  }
})
