import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: '0.0.0.0', // Escucha en todas las interfaces de red
    port: 3000, // Puedes cambiar el puerto si lo necesitas
    allowedHosts: [
      'owned-idaho-sites-sound.trycloudflare.com' // <-- tu host de Cloudflare
    ]
  },
})
