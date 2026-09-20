import {fileURLToPath, URL} from "node:url";
import {defineConfig} from "vite";
import vue from "@vitejs/plugin-vue";

const frontendRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: frontendRoot,
  base: "./",
  plugins: [vue()],
  worker: {
    rollupOptions: {
      output: {
        entryFileNames: "solver.worker.js",
        chunkFileNames: "worker/[name].js",
        assetFileNames: "[name][extname]",
      },
    },
  },
  build: {
    outDir: fileURLToPath(new URL("../dist", import.meta.url)),
    emptyOutDir: true,
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        entryFileNames: "app.js",
        assetFileNames: "[name][extname]",
        chunkFileNames: "chunks/[name].js",
      },
    },
  },
});
