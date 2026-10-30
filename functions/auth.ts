import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { sign, verify } from "hono/jwt";
import type { ServerEnv } from "./env";
import type {
  ServerErrorBody,
  ServerLoginRequest,
  ServerLoginResponse,
} from "../shared/contracts";

const DEFAULT_TTL_HOURS = 168; // 7 days
const MAX_FAILURES = 5;
const LOCK_MS = 60_000;

const failureState = new Map<string, { count: number; lockedUntil: number }>();

function clientIp(c: { req: { header: (name: string) => string | undefined } }): string {
  return (
    c.req.header("cf-connecting-ip") ||
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    "local"
  );
}

function isLocked(ip: string): boolean {
  const entry = failureState.get(ip);
  if (!entry) return false;
  if (entry.lockedUntil > Date.now()) return true;
  if (entry.lockedUntil !== 0 && entry.lockedUntil <= Date.now()) {
    failureState.delete(ip);
  }
  return false;
}

function recordFailure(ip: string): void {
  const entry = failureState.get(ip) ?? { count: 0, lockedUntil: 0 };
  entry.count += 1;
  if (entry.count >= MAX_FAILURES) {
    entry.lockedUntil = Date.now() + LOCK_MS;
    entry.count = 0;
  }
  failureState.set(ip, entry);
  // The map is bounded in practice (per-IP keys, entries cleared on success);
  // prune stale locks occasionally so a long-lived isolate cannot grow it.
  if (failureState.size > 1000) {
    const now = Date.now();
    for (const [key, value] of failureState) {
      if (value.lockedUntil !== 0 && value.lockedUntil <= now) failureState.delete(key);
    }
  }
}

/** Login stays disabled unless credentials AND a signing secret are configured. */
export function isAuthConfigured(env: ServerEnv): boolean {
  return Boolean(env.AUTH_USERNAME?.trim() && env.AUTH_PASSWORD && env.JWT_SECRET?.trim());
}

/**
 * Compares the SHA-256 digests instead of the raw strings so the comparison is
 * constant-time regardless of where the first differing byte lands.
 */
async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function digestsEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function registerAuthRoutes(app: Hono, env: ServerEnv): void {
  app.post("/api/auth/login", async (c) => {
    if (!isAuthConfigured(env)) {
      return c.json<ServerErrorBody>({ error: "server_auth_unconfigured" }, 503);
    }

    const ip = clientIp(c);
    if (isLocked(ip)) {
      return c.json<ServerErrorBody>({ error: "too_many_attempts" }, 429);
    }

    let body: ServerLoginRequest;
    try {
      body = (await c.req.json()) as ServerLoginRequest;
    } catch {
      return c.json<ServerErrorBody>({ error: "invalid_request" }, 400);
    }
    if (typeof body?.username !== "string" || typeof body?.password !== "string") {
      return c.json<ServerErrorBody>({ error: "invalid_request" }, 400);
    }

    const [userDigest, expectedUserDigest, passDigest, expectedPassDigest] = await Promise.all([
      sha256Hex(body.username),
      sha256Hex(env.AUTH_USERNAME!),
      sha256Hex(body.password),
      sha256Hex(env.AUTH_PASSWORD!),
    ]);
    if (!digestsEqual(userDigest, expectedUserDigest) || !digestsEqual(passDigest, expectedPassDigest)) {
      recordFailure(ip);
      return c.json<ServerErrorBody>({ error: "invalid_credentials" }, 401);
    }

    failureState.delete(ip);

    const ttlHours = Number(env.JWT_TTL_HOURS) > 0 ? Number(env.JWT_TTL_HOURS) : DEFAULT_TTL_HOURS;
    const exp = Math.floor(Date.now() / 1000) + ttlHours * 3600;
    const token = await sign({ sub: body.username, exp }, env.JWT_SECRET!, "HS256");
    return c.json<ServerLoginResponse>({ token, exp });
  });
}

/** Guards the proxy routes: a valid, unexpired JWT is required. */
export function createRequireAuth(env: ServerEnv): MiddlewareHandler {
  return async (c, next) => {
    const header = c.req.header("authorization") ?? "";
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    const token = match?.[1];
    if (!token || !env.JWT_SECRET) {
      return c.json<ServerErrorBody>({ error: "unauthorized" }, 401);
    }
    try {
      await verify(token, env.JWT_SECRET, "HS256");
    } catch {
      return c.json<ServerErrorBody>({ error: "unauthorized" }, 401);
    }
    await next();
  };
}
