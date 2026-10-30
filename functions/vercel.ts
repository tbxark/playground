import { getRequestListener } from "@hono/node-server";
import process from "node:process";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createApp } from "./index";
import type { ServerEnv } from "./env";

/**
 * Vercel Node handler. This module is compiled by scripts/bundle-vercel-api.mjs
 * into a self-contained api/_handler.cjs: @vercel/node emits true ESM for
 * `type: module` projects and does not resolve imports outside api/, so the
 * deployed entry must not import relative server sources directly.
 */
const app = createApp(process.env as unknown as ServerEnv);
const requestListener = getRequestListener(
  (request: Request) => app.fetch(request),
  { overrideGlobalObjects: false }
);

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  await requestListener(req, res);
}
