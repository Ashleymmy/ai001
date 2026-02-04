import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      'wavesurfer.js': path.resolve(__dirname, './vendor/wavesurfer.js/index.js')
    }
  },
  base: './',
  server: {
    port: 5173
  }
})
