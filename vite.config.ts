import path from "node:path";
import { fileURLToPath } from "node:url";
import { getRequestListener } from "@hono/node-server";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";
import { createApp } from "./functions/index";

const dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Mounts the Hono API (functions/) into the Vite dev/preview server so a plain
 * `vite` / `vite preview` runs the full stack on one origin — no CORS and no
 * second process. `pnpm dev` uses `--mode go` instead and proxies to the Go
 * server (see below). Production uses functions/adapters/worker.ts (Cloudflare)
 * and api/[[...route]].ts (Vercel).
 */
function honoApiMiddleware(): Plugin {
  const mount = (server: { config: { mode: string; envDir?: string }; middlewares: { use: (fn: unknown) => void } }) => {
    // Empty prefix: load every .env var, not just VITE_* ones.
    const env = loadEnv(server.config.mode, server.config.envDir || dirname, "");
    const app = createApp(env);
    const listener = getRequestListener(
      (request: Request) => app.fetch(request),
      { overrideGlobalObjects: false }
    );
    server.middlewares.use((req: { url?: string }, res: unknown, next: () => void) => {
      if (req.url?.startsWith("/api/")) {
        void listener(req as never, res as never);
        return;
      }
      next();
    });
  };
  return {
    name: "hono-api-middleware",
    configureServer(server) {
      mount(server);
    },
    configurePreviewServer(server) {
      mount(server);
    },
  };
}

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

export default defineConfig(({ mode }) => {
  // `vite --mode go` is the split dev loop (`pnpm dev`): Vite serves the app and
  // proxies /api to the Go server instead of mounting the Hono API in-process.
  // Plain `vite` / `vite preview` keep the in-process Hono middleware.
  const goBackend = mode === "go";
  const apiTarget = process.env.DEV_API_TARGET || "http://127.0.0.1:8080";

  return {
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
      proxy: goBackend
        ? {
            "/api": {
              target: apiTarget,
              // Keep the browser's Host header: the Go server's same-origin
              // guard compares the Origin header with the Host it received.
              // Rewriting Host to :8080 would turn every managed request into
              // cross_origin_forbidden.
              changeOrigin: false,
            },
          }
        : undefined,
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
    plugins: [
      react(),
      tailwindcss(),
      dropUnusedOrtAsyncify(),
      ...(goBackend ? [] : [honoApiMiddleware()]),
    ],
  };
});
