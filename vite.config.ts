import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { offlineApp } from './scripts/pwa-build.ts'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(),offlineApp()],
})
