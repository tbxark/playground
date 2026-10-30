import { Hono } from "hono";
import { isAuthConfigured } from "./auth";
import { parseDefaultModels, resolveUpstream, type ServerEnv } from "./env";
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
      ...(parseDefaultModels(env) ? { defaultModels: parseDefaultModels(env) } : {}),
    };
    return c.json(body);
  });
}
