import { resolve } from "node:path";
import { defineConfig } from "vite";

// Tauri expects a fixed dev port and a static build in ./dist.
export default defineConfig({
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: {
    outDir: "dist",
    target: "es2022",
    minify: "esbuild",
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        mute: resolve(__dirname, "mute.html"),
      },
    },
  },
});
