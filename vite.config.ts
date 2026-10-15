import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";

const host = process.env.TAURI_DEV_HOST;
const root = import.meta.dirname;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  resolve: { alias: { "@": resolve(root, "src") } },
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: {
    target: "safari16",
    // Vite 8 minifies with oxc; "esbuild" would pull in a package it no longer ships.
    minify: !process.env.TAURI_ENV_DEBUG,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
    rollupOptions: {
      input: {
        main: resolve(root, "index.html"),
        models: resolve(root, "models.html"),
      },
    },
  },
});
