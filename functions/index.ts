import { Hono } from "hono";
import { registerAuthRoutes } from "./auth";
import { registerHealthRoutes } from "./health";
import { registerProxyRoutes } from "./proxy";
import type { ServerEnv } from "./env";

/**
 * Platform-neutral Hono app. Adapters supply the environment: the Cloudflare
 * Worker passes its bindings, the Vercel function passes process.env, and the
 * Vite dev/preview middleware passes loadEnv() output.
 */
export function createApp(env: ServerEnv): Hono {
  const app = new Hono();
  registerHealthRoutes(app, env);
  registerAuthRoutes(app, env);
  registerProxyRoutes(app, env);
  return app;
}
