import { resolve } from 'path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        login: resolve(import.meta.dirname, 'login.html'),
        profile: resolve(import.meta.dirname, 'profile.html'),
        admin: resolve(import.meta.dirname, 'admin.html'),
        viajesActivos: resolve(import.meta.dirname, 'viajes-activos.html'),
        calendario: resolve(import.meta.dirname, 'calendario.html'),
        historial: resolve(import.meta.dirname, 'historial.html'),
        favoritos: resolve(import.meta.dirname, 'favoritos.html'),
      },
    },
  },
})
