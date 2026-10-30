import { Hono } from "hono";
import type { Context } from "hono";
import { createRequireAuth } from "./auth";
import { resolveUpstream, type ServerEnv } from "./env";
import {
  SERVER_PROXY_IMAGE_PREFIX,
  SERVER_PROXY_LLM_PREFIX,
  type ServerErrorBody,
} from "../shared/contracts";

type ProxyKind = "llm" | "image";

/**
 * Path suffixes (after the proxy prefix) a valid session may reach. Everything
 * the app needs — model listing, chat completions, image generation and async
 * task polling — is covered; keeping the list closed stops a logged-in user
 * from walking arbitrary endpoints of the upstream with our key.
 */
const ALLOWED_PATHS = ["models", "chat/completions", "images/", "tasks/"];

function isAllowedPath(path: string): boolean {
  return ALLOWED_PATHS.some((prefix) => path === prefix || path.startsWith(prefix));
}

/** Drop hop-by-hop and identity headers; the upstream's Authorization is ours. */
const STRIPPED_REQUEST_HEADERS = new Set([
  "authorization",
  "cookie",
  "host",
  "content-length",
  "connection",
  "accept-encoding",
]);

async function handleProxy(
  c: Context,
  env: ServerEnv,
  kind: ProxyKind
): Promise<Response> {
  // Same-origin guard: the browser client always talks to the proxy from its
  // own origin, so a cross-origin Origin header is never legitimate.
  const origin = c.req.header("origin");
  if (origin) {
    try {
      if (new URL(origin).host !== new URL(c.req.url).host) {
        return c.json<ServerErrorBody>({ error: "cross_origin_forbidden" }, 403);
      }
    } catch {
      return c.json<ServerErrorBody>({ error: "invalid_request" }, 400);
    }
  }

  const upstream = resolveUpstream(env, kind);
  if (!upstream) {
    return c.json<ServerErrorBody>({ error: "upstream_unconfigured" }, 503);
  }

  const url = new URL(c.req.url);
  const rest = url.pathname.slice(`${kind === "llm" ? SERVER_PROXY_LLM_PREFIX : SERVER_PROXY_IMAGE_PREFIX}/`.length);
  if (!rest || !isAllowedPath(rest)) {
    return c.json<ServerErrorBody>({ error: "path_not_allowed" }, 404);
  }

  const headers = new Headers(c.req.raw.headers);
  for (const name of STRIPPED_REQUEST_HEADERS) headers.delete(name);
  headers.set("authorization", `Bearer ${upstream.apiKey}`);

  const hasBody = c.req.method !== "GET" && c.req.method !== "HEAD";
  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(`${upstream.baseUrl}/${rest}${url.search}`, {
      method: c.req.method,
      headers,
      body: hasBody ? c.req.raw.body : undefined,
      // `duplex` is required by undici whenever a streaming request body is set.
      ...(hasBody ? { duplex: "half" } : {}),
    });
  } catch {
    return c.json<ServerErrorBody>({ error: "upstream_unreachable" }, 502);
  }

  // Buffer instead of streaming the body through: the app's proxy traffic is
  // JSON (models, completions, generations, task polls) and Vercel's Node
  // runtime drops a pass-through fetch ReadableStream in this handler setup.
  const responseHeaders = new Headers(upstreamResponse.headers);
  responseHeaders.delete("content-encoding");
  responseHeaders.delete("content-length");
  const body = await upstreamResponse.arrayBuffer();
  return new Response(body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: responseHeaders,
  });
}

export function registerProxyRoutes(app: Hono, env: ServerEnv): void {
  const requireAuth = createRequireAuth(env);
  app.all(`${SERVER_PROXY_LLM_PREFIX}/*`, requireAuth, (c) => handleProxy(c, env, "llm"));
  app.all(`${SERVER_PROXY_IMAGE_PREFIX}/*`, requireAuth, (c) => handleProxy(c, env, "image"));
}
