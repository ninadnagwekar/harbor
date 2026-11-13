import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // :: accepts IPv6 localhost (::1). Browsers try that before 127.0.0.1.
    host: '::',
    port: 4178,
    proxy: {
      '/api': 'http://127.0.0.1:8091',
    },
  },
})
