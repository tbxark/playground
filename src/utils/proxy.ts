/**
 * Utility to proxy URLs through a CORS proxy server,
 * adhering to https://github.com/tbxark/vercel-proxy:
 * Format: https://<proxy-domain>/<target-url>
 * Example: https://my-proxy.vercel.app/https://api.openai.com/v1/models
 *
 * Three modes:
 * - "auto"   direct request first; only a host that the browser actually blocks
 *            for CORS is retried through the proxy and remembered for the rest
 *            of the session.
 * - "always" every request goes through the proxy (the pre-auto behaviour).
 * - "off"    the proxy URL is kept but never used.
 */

export type CorsProxyMode = "auto" | "always" | "off";

export type CorsProxyOptions = {
  corsProxy?: string;
  corsProxyMode?: CorsProxyMode;
};

export function normalizeCorsProxyMode(mode: unknown): CorsProxyMode {
  return mode === "always" || mode === "off" ? mode : "auto";
}

export function normalizeCorsProxy(corsProxy?: string): string {
  return (corsProxy || "").trim().replace(/\/+$/, "");
}

// Hosts that the browser already failed to reach directly. Learned at runtime
// and kept for the session only: CORS is a live property of the endpoint, so a
// stale entry must not survive a reload.
const proxyRequiredHosts = new Set<string>();

function hostOf(targetUrl: string): string | null {
  try {
    const parsed = new URL(targetUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.host;
  } catch {
    return null;
  }
}

function canProxyUrl(targetUrl: string): boolean {
  return !targetUrl.startsWith("data:") && !targetUrl.startsWith("blob:");
}

/** True once this host failed a direct request and succeeded through the proxy. */
export function requiresCorsProxy(targetUrl: string): boolean {
  const host = hostOf(targetUrl);
  return host ? proxyRequiredHosts.has(host) : false;
}

function rememberCorsProxyHost(targetUrl: string): void {
  const host = hostOf(targetUrl);
  if (host) proxyRequiredHosts.add(host);
}

export function buildProxiedUrl(
  targetUrl: string,
  corsProxy?: string,
  mode: CorsProxyMode = "always"
): string {
  const proxy = normalizeCorsProxy(corsProxy);
  if (!proxy || mode === "off") return targetUrl;
  if (!canProxyUrl(targetUrl)) return targetUrl;
  if (mode === "auto" && !requiresCorsProxy(targetUrl)) return targetUrl;

  // Parse instead of concatenating: a raw `#fragment` appended to the proxy URL
  // would become the *proxy's* fragment and never reach the target, and
  // URL#toString keeps existing percent-encoding (signed CDN URLs) intact.
  let target: URL;
  try {
    target = new URL(targetUrl);
  } catch {
    return targetUrl;
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") return targetUrl;
  target.hash = "";
  return `${proxy}/${target.toString()}`;
}

/**
 * A CORS rejection and a dead network both reject fetch with a TypeError, so
 * any non-abort TypeError is a candidate for the proxy retry. HTTP errors do
 * not reject at all and therefore never trigger a retry.
 */
function isConnectionFailure(error: unknown): boolean {
  if (error instanceof Error && error.name === "AbortError") return false;
  return error instanceof TypeError;
}

/** A request body can only be replayed when it is not a one-shot stream. */
function canReplayRequest(init?: RequestInit): boolean {
  const body = init?.body;
  if (body === undefined || body === null) return true;
  return (
    typeof body === "string" ||
    body instanceof URLSearchParams ||
    body instanceof Blob ||
    body instanceof FormData ||
    body instanceof ArrayBuffer ||
    ArrayBuffer.isView(body)
  );
}

/**
 * Only safe, non-billable requests may be replayed through the proxy.
 *
 * The comment below explains why a CORS-rejected POST is still safe to retry,
 * but `TypeError` also covers a connection reset *after* the body was written:
 * replaying a billable POST then creates a second generation job. POST retries
 * belong to the visible queue, not to transport recovery.
 */
function canReplayThroughProxy(init?: RequestInit): boolean {
  const method = (init?.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") return false;
  return canReplayRequest(init);
}

/**
 * fetch() that understands the proxy settings. In "auto" mode the first request
 * for a host goes direct; if the browser blocks it, the same request is retried
 * through the proxy and the host is remembered.
 */
export async function corsAwareFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
  options?: CorsProxyOptions
): Promise<Response> {
  const proxy = normalizeCorsProxy(options?.corsProxy);
  const mode = normalizeCorsProxyMode(options?.corsProxyMode);

  if (!proxy || mode === "off") return fetch(input, init);

  const targetUrl =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;

  if (!canProxyUrl(targetUrl) || !hostOf(targetUrl)) return fetch(input, init);

  // A Request input cannot be re-pointed at the proxy without consuming a body
  // we do not own; callers in this app always pass plain URLs.
  if (typeof input !== "string" && !(input instanceof URL)) return fetch(input, init);

  const proxiedUrl = buildProxiedUrl(targetUrl, proxy, "always");

  if (mode === "always" || requiresCorsProxy(targetUrl)) {
    return fetch(proxiedUrl, init);
  }

  try {
    return await fetch(input, init);
  } catch (error) {
    if (!isConnectionFailure(error) || !canReplayThroughProxy(init)) throw error;
    // GET/HEAD carry no billable side effect, so a host that the browser blocks
    // for CORS is safe to retry through the proxy. The host is remembered so
    // the failed direct attempt happens at most once per session.
    try {
      const response = await fetch(proxiedUrl, init);
      // Any response (even an HTTP error) proves the proxy path works for this
      // host, so later requests skip the doomed direct attempt.
      rememberCorsProxyHost(targetUrl);
      return response;
    } catch {
      throw error;
    }
  }
}
