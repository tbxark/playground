#!/usr/bin/env bash
# Push every variable in .env.local into the linked Vercel project's
# environment. Re-running overwrites existing values (rm + add).
#
# Usage: bash scripts/push-vercel-env.sh [production|preview|development]
set -euo pipefail

ENV_FILE=".env.local"
TARGET="${1:-production}"

command -v vercel >/dev/null || { echo "vercel CLI not found in PATH" >&2; exit 1; }
[ -f "$ENV_FILE" ] || { echo "$ENV_FILE not found — create it from .env.example first" >&2; exit 1; }

pushed=0
while IFS= read -r line || [ -n "$line" ]; do
  line="${line%$'\r'}"
  case "$line" in ''|\#*) continue ;; esac
  name="${line%%=*}"
  value="${line#*=}"
  case "$value" in
    \"*\") value="${value#\"}"; value="${value%\"}" ;;
    \'*\') value="${value#\'}"; value="${value%\'}" ;;
  esac
  if [ -z "$name" ] || [ -z "$value" ]; then
    echo "skip ${name:-<empty line>} (empty value)"
    continue
  fi
  # Overwrite semantics: removing a missing name is fine.
  vercel env rm "$name" "$TARGET" --yes >/dev/null 2>&1 || true
  printf '%s' "$value" | vercel env add "$name" "$TARGET"
  echo "pushed $name -> $TARGET"
  pushed=$((pushed + 1))
done < "$ENV_FILE"

echo "done: $pushed variable(s) pushed to $TARGET"
