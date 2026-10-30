# Self-hosted image for a plain VPS: the web build and the Go API are compiled
# into one static binary, so the runtime image carries no Node/Bun runtime.
#
#   docker build --platform linux/amd64 -t aiimage-playground .
#   docker run -d -p 8080:8080 --env-file .env.local aiimage-playground
#
# Build the image for the VPS architecture explicitly: on Apple Silicon a plain
# `docker build` produces an arm64 image, which will not run on a typical
# x86_64 VPS. Alternatively build on the VPS itself, or use buildx.
#
# Build args:
#   VITE_SERVER_MODE=optional (default) | off
#     optional bakes in the login UI and /api proxy support; off produces a
#     pure-frontend image whose binary still serves the SPA.

FROM node:24-bookworm-slim AS web
WORKDIR /app

# pnpm 12 matches pnpm-workspace.yaml's allowBuilds policy (see AGENTS.md).
RUN npm install --global pnpm@12.15.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
ARG VITE_SERVER_MODE=optional
ENV VITE_SERVER_MODE=${VITE_SERVER_MODE}
RUN pnpm build

FROM golang:1.27-alpine AS goserver
WORKDIR /src
# The module has no third-party dependencies, so there is no go.sum/download
# layer to cache; the source copy is all the Go build needs.
COPY server/ ./
# Replace the committed web/static placeholder with the real build output.
COPY --from=web /app/dist ./web/static
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/aiimage-playground .

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=goserver /out/aiimage-playground /aiimage-playground
ENV HOST=0.0.0.0 \
    PORT=8080
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["/aiimage-playground", "-healthcheck"]
ENTRYPOINT ["/aiimage-playground"]
