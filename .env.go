# Loaded only by `vite --mode go` — the split dev loop (`pnpm dev`, `dev:web`)
# where Vite proxies /api to the Go server. The Go server implements the
# shared-server API, so the dev build ships the login UI by default.
#
# Override locally in `.env.go.local` (gitignored) or through the process
# environment, which Vite ranks above every env file.
VITE_SERVER_MODE=optional
