// Command aiimage-playground serves the built single-page app and the optional
// shared-server API (login + OpenAI-compatible upstream proxy) from one static
// binary. It is a drop-in replacement for the Hono server in functions/ for hosts
// that should not run a JavaScript runtime.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func main() {
	healthcheck := flag.Bool("healthcheck", false, "probe http://127.0.0.1:$PORT/api/health and exit")
	flag.Parse()

	// Load ENV_FILE before the healthcheck branch so a PORT/HOST that lives only
	// in the dotenv file also drives the probe.
	if envFile := os.Getenv("ENV_FILE"); envFile != "" {
		if err := loadEnvFile(envFile); err != nil {
			fmt.Fprintf(os.Stderr, "load env file %s: %v\n", envFile, err)
			os.Exit(1)
		}
	}

	if *healthcheck {
		os.Exit(runHealthcheck())
	}

	cfg, err := loadConfig()
	if err != nil {
		fmt.Fprintf(os.Stderr, "invalid configuration: %v\n", err)
		os.Exit(1)
	}

	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{
		Level: logLevel(),
	})))

	addr := net.JoinHostPort(cfg.host, cfg.port)
	server := &http.Server{
		Addr:              addr,
		Handler:           newHandler(cfg, handlerOptions{}),
		ReadHeaderTimeout: 15 * time.Second,
		// Caps slow request bodies (login, image uploads) while leaving room for
		// legitimate large payloads. WriteTimeout stays 0 for the 14 MB wasm.
		ReadTimeout: 10 * time.Minute,
		IdleTimeout: 2 * time.Minute,
		ErrorLog:    slog.NewLogLogger(slog.Default().Handler(), slog.LevelWarn),
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	shutdownDone := make(chan struct{})
	go func() {
		defer close(shutdownDone)
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := server.Shutdown(shutdownCtx); err != nil {
			slog.Warn("graceful shutdown failed", "error", err)
		}
	}()

	slog.Info("starting aiimage-playground",
		"addr", addr,
		"auth_enabled", cfg.authConfigured(),
		"llm_upstream", upstreamLabel(cfg.llmUpstream),
		"image_upstream", upstreamLabel(cfg.imageUpstream),
		"default_models", len(cfg.defaultModels),
	)

	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		slog.Error("server failed", "error", err)
		os.Exit(1)
	}
	<-shutdownDone
	slog.Info("server stopped")
}

// newUpstreamClient is the shared client for proxy calls. There is no overall
// timeout: image generations can legitimately take minutes, and the request
// context cancels the upstream call when the browser disconnects.
func newUpstreamClient() *http.Client {
	transport := &http.Transport{
		Proxy: http.ProxyFromEnvironment,
		DialContext: (&net.Dialer{
			Timeout:   10 * time.Second,
			KeepAlive: 30 * time.Second,
		}).DialContext,
		ForceAttemptHTTP2:     true,
		MaxIdleConns:          100,
		MaxIdleConnsPerHost:   20,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   10 * time.Second,
		ExpectContinueTimeout: time.Second,
		ResponseHeaderTimeout: 10 * time.Minute,
	}
	return &http.Client{Transport: transport}
}

// runHealthcheck backs the container HEALTHCHECK. It only needs HOST/PORT, so
// it works before a full config load and never trips over missing credentials.
func runHealthcheck() int {
	port := envOr("PORT", "8080")
	host := envOr("HOST", "127.0.0.1")
	// A wildcard bind is reachable on loopback; probing the wildcard address is
	// not portable across platforms.
	if host == "0.0.0.0" || host == "::" || host == "[::]" {
		host = "127.0.0.1"
	}
	client := &http.Client{Timeout: 3 * time.Second}
	response, err := client.Get("http://" + net.JoinHostPort(host, port) + "/api/health")
	if err != nil {
		fmt.Fprintln(os.Stderr, "healthcheck:", err)
		return 1
	}
	defer response.Body.Close()
	_, _ = io.Copy(io.Discard, response.Body)
	if response.StatusCode != http.StatusOK {
		fmt.Fprintln(os.Stderr, "healthcheck: unexpected status", response.StatusCode)
		return 1
	}
	return 0
}

func logLevel() slog.Level {
	switch envOr("LOG_LEVEL", "info") {
	case "debug":
		return slog.LevelDebug
	case "warn", "warning":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}

func upstreamLabel(target *upstream) string {
	if target == nil {
		return "unconfigured"
	}
	// Never log URL userinfo; operators may have put credentials there by
	// mistake. The API key is stored separately and is never logged either.
	safe := *target.baseURL
	safe.User = nil
	return safe.String()
}
