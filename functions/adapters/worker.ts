import { createApp } from "../index";
import type { ServerEnv } from "../env";

/**
 * Cloudflare Workers entry. wrangler.jsonc sets run_worker_first: ["/api/*"],
 * so the Worker is only invoked for API routes; every other request is served
 * from the static assets binding without touching this module.
 */
export default {
  async fetch(request: Request, workerEnv: Record<string, unknown>): Promise<Response> {
    const env: ServerEnv = Object.fromEntries(
      Object.entries(workerEnv).filter(([, value]) => typeof value === "string")
    );
    return createApp(env).fetch(request);
  },
};

