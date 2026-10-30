# server

A dependency-light implementation of the optional shared-server API. It has no
third-party dependencies: the Go standard library handles HTTP, `go:embed`
serves the built SPA (`web/static`), and `crypto/hmac` signs HS256 session
tokens (`token.go`), so a VPS only needs one static binary.

Tokens use the standard `{"alg":"HS256","typ":"JWT"}` header and `{sub, exp}`
claims — the same shape Hono emits — so both implementations verify each other's
sessions when they share `JWT_SECRET`.

The Hono app in `../functions/` remains the implementation used by Cloudflare
Workers and Vercel. Both must stay in sync with `../shared/contracts.ts`.

## Routes

| Route | Behavior |
| --- | --- |
| `GET /api/health` | `{ok, auth:{enabled}, upstreams:{llm,image}, defaultModels?}` |
| `POST /api/auth/login` | `{username, password}` → `{token, exp}`; 5 failures per IP lock for 60 s |
| `ALL /api/proxy/llm/*` | Bearer JWT required; forwards to the LLM upstream with the server key |
| `ALL /api/proxy/image/*` | Same, using the image upstream (falls back to `LLM_*`) |
| everything else | The embedded SPA, with `index.html` fallback for client routes |

Only `models`, `chat/completions`, `images/*` and `tasks/*` are reachable
through the proxy. Errors use `{"error":"<code>"}` with the same codes as the
Hono server (`unauthorized`, `invalid_credentials`, `too_many_attempts`,
`upstream_unconfigured`, `upstream_unreachable`, `path_not_allowed`,
`cross_origin_forbidden`, `invalid_request`, `not_found`, `method_not_allowed`).

## Build

From `playground/`:

```bash
pnpm build:go
```

That runs the web build with `VITE_SERVER_MODE=optional`, copies `dist/` into
`web/static`, and produces `server/aiimage-playground`. For a pure-frontend
binary use `VITE_SERVER_MODE=off ./server/build.sh`; `OUT=/path ./server/build.sh`
chooses the output path. The Dockerfile at the playground root performs the
same two steps and runs the binary on a distroless image.

A plain `go build` only embeds what is currently in `web/static`. On a clean
checkout that is a committed placeholder, and the server answers with a hint
instead of the app — rerun the build script after any frontend change.

## Run

```bash
cd server
ENV_FILE=../.env.local ./aiimage-playground
```

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOST` / `PORT` | `127.0.0.1` / `8080` | Listen address. The Docker image sets `0.0.0.0`. |
| `ENV_FILE` | unset | Optional dotenv file; already-exported variables win. |
| `TRUST_PROXY_HEADERS` | `false` | Set `true` only when a trusted proxy overwrites `X-Forwarded-For` / `CF-Connecting-IP` with the real client IP; otherwise forwarded IPs are ignored for login throttling. |
| `AUTH_USERNAME` / `AUTH_PASSWORD` / `JWT_SECRET` | unset | All three enable login. The proxy requires a valid token signed with `JWT_SECRET`; without it, requests get 401. Removing the username/password stops new logins but does not revoke already-issued tokens — rotate `JWT_SECRET` to invalidate them. |
| `JWT_TTL_HOURS` | `168` | Session lifetime. |
| `LLM_BASE_URL` / `LLM_API_KEY` | unset | OpenAI-compatible upstream for the assistant. |
| `IMAGE_BASE_URL` / `IMAGE_API_KEY` | fall back to `LLM_*` | Image-generation upstream. |
| `SERVER_DEFAULT_MODELS` | unset | Comma-separated model ids for the health response. |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error`. |

`GET /api/health` is the readiness probe. `./aiimage-playground -healthcheck`
probes `http://$HOST:$PORT/api/health` (a wildcard `HOST` is probed on
`127.0.0.1`) and exits non-zero on failure; the Dockerfile wires that into
`HEALTHCHECK`.

When a reverse proxy sits in front, preserve the `Host` header, terminate TLS
there, and configure request/body timeouts. The binary caps request reads at 10
minutes. To get per-client login throttling through a proxy, make the proxy
**overwrite** `X-Forwarded-For` with the immediate client IP (nginx
`proxy_set_header X-Forwarded-For $remote_addr;`) and set
`TRUST_PROXY_HEADERS=true`; with the flag off (the default) every client behind
the proxy shares the TCP-peer key, and with it on a proxy that appends instead
of overwriting lets clients spoof the key.

## Test

```bash
go test ./...
```
