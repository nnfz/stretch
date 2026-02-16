import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/rtc': {
        target: 'https://stream.nnfz.ru',
        changeOrigin: true,
        secure: true,
      },
      '/live-check': {
        target: 'https://stream.nnfz.ru',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/live-check/, '/live'),
      },
    },
  },
});
