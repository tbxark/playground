import { Hono } from "hono";
import { isAuthConfigured } from "./auth";
import { resolveUpstream, type ServerEnv } from "./env";
import type { ServerHealthResponse } from "../shared/contracts";

export function registerHealthRoutes(app: Hono, env: ServerEnv): void {
  app.get("/api/health", (c) => {
    const body: ServerHealthResponse = {
      ok: true,
      auth: { enabled: isAuthConfigured(env) },
      upstreams: {
        llm: resolveUpstream(env, "llm") !== null,
        image: resolveUpstream(env, "image") !== null,
      },
    };
    return c.json(body);
  });
}
