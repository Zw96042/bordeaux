import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: fileURLToPath(new URL("./src/renderer", import.meta.url)),
  base: "./",
  publicDir: false,
  plugins: [react()],
  build: {
    outDir: fileURLToPath(new URL("./dist-renderer", import.meta.url)),
    emptyOutDir: true,
    // Electron's Chromium runtime supports modulepreload; the browser fallback is dead weight here.
    modulePreload: { polyfill: false },
    minify: "terser",
    terserOptions: { compress: { passes: 3 } },
    // Rolldown's cross-module pass removes more dead code before Terser folds
    // the remaining chunks; the worker is built through a separate output graph.
    rolldownOptions: { output: { minify: true } },
    sourcemap: false,
    target: "es2022",
  },
  worker: { rolldownOptions: { output: { minify: true } } },
});
