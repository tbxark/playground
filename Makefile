# Build and run entry points for the Go server. The web-only and deploy flow
# stays in package.json; this file owns the binary layout and the two-process
# dev stack so both share one source of truth.
#
#   make dev          # Vite (127.0.0.1:5180) + Go API (127.0.0.1:8080)
#   make build-go     # web build + one self-contained binary in build/dist
#   make run          # run that binary, loading .env.local when present
SHELL := /bin/bash

BIN ?= build/dist/aiimage-playground
ENV_FILE ?= .env.local
# dev-backend runs with cwd=server (go -C), so the dotenv path must be absolute.
ENV_FILE_ABS := $(if $(filter /%,$(ENV_FILE)),$(ENV_FILE),$(CURDIR)/$(ENV_FILE))
PORT ?= 8080

.DEFAULT_GOAL := help
.PHONY: help dev dev-web dev-backend build build-web build-go run test clean

help: ## List targets
	@awk 'BEGIN {FS = ":.*## "} /^[a-zA-Z0-9_-]+:.*## / {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

dev: ## Vite + the Go API together (Vite proxies /api)
	@DEV_API_PORT=$(PORT) node scripts/dev.mjs

dev-web: ## Vite only; expects the Go API on PORT
	@DEV_API_TARGET=http://127.0.0.1:$(PORT) pnpm dev:web

dev-backend: ## Go API only (go run; loads ENV_FILE when it exists)
	@if [[ -f "$(ENV_FILE_ABS)" ]]; then \
		ENV_FILE="$(ENV_FILE_ABS)" go -C server run .; \
	else \
		go -C server run .; \
	fi

build: ## Typecheck + web build into dist/
	@pnpm build

build-web: build ## Alias for build

build-go: ## Web build + Go binary at build/dist/aiimage-playground
	@OUT=$(BIN) bash server/build.sh

run: ## Run build/dist/aiimage-playground with ENV_FILE when present
	@if [[ ! -x "$(BIN)" ]]; then \
		echo "missing $(BIN); run 'make build-go' first" >&2; \
		exit 1; \
	fi; \
	if [[ -f "$(ENV_FILE)" ]]; then \
		ENV_FILE=$(ENV_FILE) "$(BIN)"; \
	else \
		"$(BIN)"; \
	fi

test: ## Go tests
	@cd server && go test -race ./...

clean: ## Remove build output (dist/, build/, staged SPA)
	@rm -rf build dist
	@rm -f server/aiimage-playground
	@find server/web/static -mindepth 1 ! -name .gitkeep -delete
