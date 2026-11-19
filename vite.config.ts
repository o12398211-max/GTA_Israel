import { defineConfig } from 'vite';

// base './' so the build works under GitHub Pages sub-path
export default defineConfig({
  base: './',
  server: { host: true, port: 5173 },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
});
