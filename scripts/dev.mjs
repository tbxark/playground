#!/usr/bin/env node
/**
 * `pnpm dev`: runs the Go API and Vite together for the shared-server loop.
 *
 * Vite starts with `--mode go`, so it skips the in-process Hono middleware and
 * proxies `/api` to the Go server (see vite.config.ts). `pnpm dev:web` and
 * `pnpm dev:backend` run the two halves separately; this script only adds
 * output prefixes, a readiness wait and coupled shutdown.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiPort = process.env.DEV_API_PORT || process.env.PORT || "8080";
const apiOrigin = `http://127.0.0.1:${apiPort}`;
const envFile = path.join(root, ".env.local");

const children = [];
let stopping = false;

function run(label, command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: root,
    env: { ...process.env, ...options.env },
    stdio: ["ignore", "pipe", "pipe"],
    // Own process group so shutdown reaches grandchildren: `go run` compiles a
    // binary and does not forward SIGTERM to it.
    detached: process.platform !== "win32",
  });
  children.push(child);

  for (const stream of [child.stdout, child.stderr]) {
    let buffer = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) process.stdout.write(`[${label}] ${line}\n`);
    });
    stream.on("end", () => {
      if (buffer) process.stdout.write(`[${label}] ${buffer}\n`);
    });
  }

  child.on("error", (error) => {
    if (stopping) return;
    console.error(`[${label}] failed to start: ${error.message}`);
    void shutdown(1);
  });
  child.on("exit", (code, signal) => {
    if (stopping) return;
    console.error(`[${label}] exited (${signal ?? `code ${code}`}); stopping the dev stack`);
    void shutdown(code ?? 1);
  });
  return child;
}

/** Waits for the Go server to answer /api/health so the first proxied call works. */
async function waitForApi(child, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || stopping) return false;
    try {
      const response = await fetch(`${apiOrigin}/api/health`, {
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok) return true;
    } catch {
      // Not listening yet (or still compiling).
    }
    await delay(250);
  }
  return false;
}

function signalChild(child, signal) {
  if (child.exitCode !== null || !child.pid) return;
  try {
    if (process.platform === "win32") child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch {
    // The process group is already gone.
  }
}

async function shutdown(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) signalChild(child, "SIGTERM");
  await delay(500);
  for (const child of children) signalChild(child, "SIGKILL");
  process.exit(code);
}

process.on("SIGINT", () => void shutdown(0));
process.on("SIGTERM", () => void shutdown(0));

// `go run ./server` cannot work from the repo root (there is no go.mod here),
// and -C changes the child's cwd, so ENV_FILE is passed as an absolute path.
const backend = run("backend", "go", ["-C", "server", "run", "."], {
  env: {
    HOST: "127.0.0.1",
    PORT: apiPort,
    ...(existsSync(envFile) ? { ENV_FILE: envFile } : {}),
  },
});

if (!(await waitForApi(backend))) {
  if (!stopping) {
    console.error(`Go API did not become ready at ${apiOrigin} (see [backend] output)`);
  }
  await shutdown(1);
}

const viteBin = path.join(
  root,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "vite.cmd" : "vite",
);
run("web", viteBin, ["--mode", "go"], {
  env: { DEV_API_TARGET: apiOrigin },
});
