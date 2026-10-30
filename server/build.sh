#!/usr/bin/env bash
# Builds the web app and produces one self-contained Go binary with the SPA
# embedded. Run from anywhere; the script locates the playground root itself.
#
#   ./server/build.sh                       # shared-server build (VITE_SERVER_MODE=optional)
#   VITE_SERVER_MODE=off ./server/build.sh  # pure-frontend build
#   OUT=/tmp/aiimage ./server/build.sh      # custom output path
#
# The binary defaults to build/dist/aiimage-playground. web/static is only the
# staging directory for go:embed and is gitignored.
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
server_dir="$root/server"
static_dir="$server_dir/web/static"
out=${OUT:-$root/build/dist/aiimage-playground}
if [[ "$out" != /* ]]; then
  out="$(pwd)/$out"
fi

command -v pnpm >/dev/null 2>&1 || {
  echo "pnpm is required to build the web app (see README)" >&2
  exit 1
}

mode=${VITE_SERVER_MODE:-optional}
echo "==> building web app (VITE_SERVER_MODE=$mode)"
(cd "$root" && VITE_SERVER_MODE="$mode" pnpm build)

# Keep the committed .gitkeep so `go:embed all:web/static` stays valid on a
# clean checkout, but replace every generated asset.
echo "==> embedding dist/ into server/web/static"
mkdir -p "$static_dir"
find "$static_dir" -mindepth 1 ! -name .gitkeep -delete
cp -R "$root/dist/." "$static_dir/"

echo "==> building Go binary"
mkdir -p "$(dirname "$out")"
(cd "$server_dir" && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o "$out" .)

echo "built $out"
echo "run it with: ENV_FILE=.env.local $out"
