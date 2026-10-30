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
| `GET /api/health` | `{ok, auth:{enabled}, upstreams:{llm,image}}` |
| `POST /api/auth/login` | `{username, password}` → `{token, exp}`; 5 failures per IP lock for 60 s |
| `GET /api/config` | Bearer JWT required; returns `{image:{models,defaultModel}, assistant:{textModel?,visionModel?}}` |
| `POST /api/generate` | Bearer JWT required; validates `model` against `MANAGED_IMAGE_MODELS`, injects the image key and forwards to `/images/generations` |
| `GET /api/tasks/{id}` | Bearer JWT required; forwards task polling to the image upstream |
| `POST /api/assistant/chat` | Bearer JWT required; uses the fixed text/vision model and returns `{text}` |
| everything else | The embedded SPA, with `index.html` fallback for client routes |

Managed generation and assistant requests are typed application endpoints, not a
generic proxy: the client cannot choose an assistant model and cannot use an
image model outside `MANAGED_IMAGE_MODELS`. Errors use `{"error":"<code>"}`
with the same codes as the Hono server (`unauthorized`, `invalid_credentials`,
`too_many_attempts`, `upstream_unconfigured`, `upstream_unreachable`,
`managed_config_incomplete`, `model_not_allowed`,
`assistant_model_unconfigured`, `assistant_empty_response`,
`cross_origin_forbidden`, `invalid_request`, `not_found`,
`method_not_allowed`).

## Build

From `playground/`:

```bash
pnpm build:go     # same as: make build-go
```

That runs the web build with `VITE_SERVER_MODE=optional`, copies `dist/` into
`web/static` (the `go:embed` staging directory), and produces
`build/dist/aiimage-playground`. For a pure-frontend binary use
`VITE_SERVER_MODE=off ./server/build.sh`; `OUT=/path ./server/build.sh` chooses
the output path. The Dockerfile at the playground root performs the same two
steps and runs the binary on a distroless image.

A plain `go build` only embeds what is currently in `web/static`. On a clean
checkout that is a committed placeholder, and the server answers with a hint
instead of the app — rerun the build script after any frontend change.

## Run

```bash
pnpm start:go     # same as: make run
```

That runs `build/dist/aiimage-playground` with `ENV_FILE=.env.local` when the
file exists. By hand:

```bash
ENV_FILE=.env.local ./build/dist/aiimage-playground
```

`make test` runs `go test -race ./...`.

## Develop

`pnpm dev` (or `make dev`) runs this server with `go run ./server` on
`127.0.0.1:8080` and Vite on `127.0.0.1:5180`; Vite proxies `/api` to the Go
process, so the frontend has hot reload without rebuilding the binary. Use
`pnpm dev:backend` and `pnpm dev:web` to run the halves separately. The proxy
keeps the browser `Host` header on purpose: the same-origin guard compares it
with `Origin`, so `changeOrigin: true` would break managed requests.

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOST` / `PORT` | `127.0.0.1` / `8080` | Listen address. The Docker image sets `0.0.0.0`. |
| `ENV_FILE` | unset | Optional dotenv file; already-exported variables win. |
| `TRUST_PROXY_HEADERS` | `false` | Set `true` only when a trusted proxy overwrites `X-Forwarded-For` / `CF-Connecting-IP` with the real client IP; otherwise forwarded IPs are ignored for login throttling. |
| `AUTH_USERNAME` / `AUTH_PASSWORD` / `JWT_SECRET` | unset | All three enable login. Managed endpoints require a valid token signed with `JWT_SECRET`; without it, requests get 401. Removing the username/password stops new logins but does not revoke already-issued tokens — rotate `JWT_SECRET` to invalidate them. |
| `JWT_TTL_HOURS` | `168` | Session lifetime. |
| `LLM_BASE_URL` / `LLM_API_KEY` | unset | OpenAI-compatible upstream for the assistant. |
| `IMAGE_BASE_URL` / `IMAGE_API_KEY` | fall back to `LLM_*` | Image-generation upstream. |
| `MANAGED_IMAGE_MODELS` | unset | Comma-separated image model ids served by `/api/config` and enforced by `/api/generate`. |
| `MANAGED_LLM_MODEL` / `MANAGED_VISION_MODEL` | unset | Fixed assistant text/vision models used by `/api/assistant/chat`. Missing values disable the corresponding managed assistant action. |
| `UPSTREAM_PROXY_URL` | unset | One outbound proxy for upstream API calls: `http`, `https`, `socks5` or `socks5h` (a bare `host:port` means `http://`, and `user:pass@` is supported). Overrides the standard `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` variables, including `NO_PROXY`. |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error`. |

When `UPSTREAM_PROXY_URL` is unset, upstream calls honor the usual
`HTTPS_PROXY` / `HTTP_PROXY` / `NO_PROXY` variables (either case), which may
also live in the dotenv file — that is Go's default transport behavior. Go does
not read OS-level proxy settings (macOS System Settings, Windows Internet
Options), so a proxy configured only there has to be exported explicitly.
Loopback upstreams (`localhost`, `127.0.0.0/8`, `::1`) are always dialed
directly, even with an explicit proxy, so a local gateway keeps working. The
startup log prints the effective proxy as `upstream_proxy` (`none`,
`environment`, or the URL without credentials), and `-healthcheck` never uses a
proxy.

`GET /api/health` is the readiness probe.
`./build/dist/aiimage-playground -healthcheck` probes
`http://$HOST:$PORT/api/health` (a wildcard `HOST` is probed on `127.0.0.1`)
and exits non-zero on failure; the Dockerfile wires that into `HEALTHCHECK`.

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
