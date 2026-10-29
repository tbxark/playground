import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * transformers.js bundles ONNX Runtime's WebGPU/asyncify runtime and Vite emits
 * its 25.6 MiB .wasm file even though the app overrides `wasmPaths` with the
 * standard CPU build (see backgroundRemoval.worker.ts). Cloudflare rejects any
 * static asset above 25 MiB, so drop that one file. The remaining reference in
 * the worker bundle sits behind a `!wasmPaths` guard and is never requested.
 */
function dropUnusedOrtAsyncify(): Plugin {
  return {
    name: "drop-unused-ort-asyncify",
    apply: "build",
    generateBundle(_options, bundle) {
      for (const fileName of Object.keys(bundle)) {
        if (
          fileName.includes("ort-wasm-simd-threaded.asyncify") &&
          fileName.endsWith(".wasm")
        ) {
          delete bundle[fileName];
        }
      }
    },
  };
}

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
  plugins: [react(), tailwindcss(), dropUnusedOrtAsyncify()],
});
