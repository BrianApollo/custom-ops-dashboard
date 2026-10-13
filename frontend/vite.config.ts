import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// `wrangler dev` in backend/
const API = 'http://localhost:8787'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // same paths the deployed Worker answers itself, so the browser sees one
    // origin in dev too and the session cookie works without CORS
    proxy: {
      '/api': API,
      '/health': API,
    },
  },
})
