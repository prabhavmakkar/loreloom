import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Host and Origin stay as localhost:5173, which the server's local guard allows.
    proxy: { '/api': 'http://127.0.0.1:4317' },
  },
  test: { environment: 'jsdom' },
})
