import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({
  plugins: [react()],
  base: './',   // relative paths — works when opened as local file OR on any subdomain
})
