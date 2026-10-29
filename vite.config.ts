import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(dirname, "src"),
    },
  },
  optimizeDeps: {
    // The worker imports transformers.js lazily; pre-bundling it avoids Vite's
    // "optimized dependencies changed — reloading" page reload on first use.
    include: ["@huggingface/transformers"],
  },
  server: {
    host: "127.0.0.1",
    port: 5180,
    fs: {
      deny: [".env", ".env.*", "*.{crt,pem}", "config.json"],
    },
  },
  preview: {
    host: "127.0.0.1",
    port: 5180,
  },
  build: {
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ["react", "react-dom", "zustand", "idb"],
          jszip: ["jszip"],
        },
      },
    },
  },
  plugins: [react(), tailwindcss()],
});
