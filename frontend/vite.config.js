import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/events': 'http://backend:3001',
      '/webhook': 'http://backend:3001',
      '/health':  'http://backend:3001',
    }
  }
});
