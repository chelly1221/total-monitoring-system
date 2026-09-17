import { resolve } from 'node:path';
import { defineConfig } from 'vite';
export default defineConfig({
  clearScreen: false,
  server: { port: 1422, strictPort: true },
  build: {
    target: 'es2022',
    rollupOptions: { input: { main: resolve(__dirname, 'index.html'), mute: resolve(__dirname, 'mute.html') } },
  },
});
