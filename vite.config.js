
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'fs';
const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  define: {
    'import.meta.env.APP_VERSION': JSON.stringify(pkg.version),
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
