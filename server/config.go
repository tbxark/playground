package main

import (
	"bufio"
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

type proxyKind int

const (
	kindLLM proxyKind = iota
	kindImage
)

// upstream is a parsed OpenAI-compatible endpoint the proxy can forward to.
type upstream struct {
	baseURL *url.URL
	apiKey  string
}

type config struct {
	host string
	port string

	authUsername string
	authPassword string
	jwtSecret    string
	jwtTTL       time.Duration

	// trustProxyHeaders enables reading client IPs from CF-Connecting-IP /
	// X-Forwarded-For. It is off by default because those headers are
	// client-controlled unless a trusted proxy overwrites them.
	trustProxyHeaders bool

	llmUpstream   *upstream
	imageUpstream *upstream

	// upstreamProxy is UPSTREAM_PROXY_URL: one explicit outbound proxy for
	// upstream API calls. Nil means the standard HTTP_PROXY / HTTPS_PROXY /
	// NO_PROXY variables are honored instead (see upstreamProxyFunc).
	upstreamProxy *url.URL

	// managedImageModels is the image-model allowlist enforced by the managed
	// generation endpoint.
	managedImageModels []string
	// Fixed assistant models for managed users.
	managedLlmModel    string
	managedVisionModel string
}

func (c config) authConfigured() bool {
	return strings.TrimSpace(c.authUsername) != "" &&
		strings.TrimSpace(c.authPassword) != "" &&
		strings.TrimSpace(c.jwtSecret) != ""
}

func (c config) upstreamFor(kind proxyKind) *upstream {
	if kind == kindImage {
		return c.imageUpstream
	}
	return c.llmUpstream
}

func loadConfig() (config, error) {
	cfg := config{
		host:               envOr("HOST", "127.0.0.1"),
		port:               envOr("PORT", "8080"),
		authUsername:       os.Getenv("AUTH_USERNAME"),
		authPassword:       os.Getenv("AUTH_PASSWORD"),
		jwtSecret:          os.Getenv("JWT_SECRET"),
		jwtTTL:             jwtTTLFromEnv(),
		trustProxyHeaders:  parseBoolEnv("TRUST_PROXY_HEADERS"),
		managedImageModels: parseManagedImageModels(os.Getenv("MANAGED_IMAGE_MODELS")),
		managedLlmModel:    strings.TrimSpace(os.Getenv("MANAGED_LLM_MODEL")),
		managedVisionModel: strings.TrimSpace(os.Getenv("MANAGED_VISION_MODEL")),
	}

	port, err := strconv.Atoi(cfg.port)
	if err != nil || port < 1 || port > 65535 {
		return config{}, fmt.Errorf("PORT must be a TCP port number, got %q", cfg.port)
	}

	proxy, err := parseProxyURL(os.Getenv("UPSTREAM_PROXY_URL"))
	if err != nil {
		return config{}, fmt.Errorf("UPSTREAM_PROXY_URL: %w", err)
	}
	cfg.upstreamProxy = proxy

	// IMAGE_* falls back to LLM_* so a single gateway serving both only needs
	// the LLM_* pair (same rule as functions/env.ts).
	llmBaseURL := strings.TrimSpace(os.Getenv("LLM_BASE_URL"))
	llmAPIKey := strings.TrimSpace(os.Getenv("LLM_API_KEY"))
	imageBaseURL := firstNonEmpty(strings.TrimSpace(os.Getenv("IMAGE_BASE_URL")), llmBaseURL)
	imageAPIKey := firstNonEmpty(strings.TrimSpace(os.Getenv("IMAGE_API_KEY")), llmAPIKey)

	if cfg.llmUpstream, err = newUpstream(llmBaseURL, llmAPIKey); err != nil {
		return config{}, fmt.Errorf("LLM upstream: %w", err)
	}
	if cfg.imageUpstream, err = newUpstream(imageBaseURL, imageAPIKey); err != nil {
		return config{}, fmt.Errorf("IMAGE upstream: %w", err)
	}
	return cfg, nil
}

// newUpstream returns nil when the pair is incomplete: an unconfigured
// upstream is a supported state (health reports it, the proxy answers 503).
func newUpstream(baseURL, apiKey string) (*upstream, error) {
	if baseURL == "" || apiKey == "" {
		return nil, nil
	}
	parsed, err := url.Parse(baseURL)
	if err != nil {
		return nil, fmt.Errorf("invalid base URL %q: %w", baseURL, err)
	}
	if (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		return nil, fmt.Errorf("base URL %q must be an absolute http(s) URL", baseURL)
	}
	parsed.Path = strings.TrimRight(parsed.Path, "/")
	parsed.RawPath = ""
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return &upstream{baseURL: parsed, apiKey: apiKey}, nil
}

func jwtTTLFromEnv() time.Duration {
	hours, err := strconv.Atoi(strings.TrimSpace(os.Getenv("JWT_TTL_HOURS")))
	if err != nil || hours <= 0 {
		return defaultJWTTTL
	}
	return time.Duration(hours) * time.Hour
}

func parseManagedImageModels(raw string) []string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	seen := make(map[string]bool)
	var models []string
	for _, part := range strings.Split(raw, ",") {
		id := strings.TrimSpace(part)
		if id != "" && !seen[id] {
			seen[id] = true
			models = append(models, id)
		}
	}
	return models
}

func envOr(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}

// parseBoolEnv treats missing or invalid values as false so a typo cannot
// silently enable a security-sensitive option such as TRUST_PROXY_HEADERS.
func parseBoolEnv(key string) bool {
	value, err := strconv.ParseBool(strings.TrimSpace(os.Getenv(key)))
	return err == nil && value
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

// loadEnvFile reads a dotenv file without overriding variables that are
// already exported. It is opt-in through ENV_FILE so a stray .env.local in the
// working directory can never change a production deployment.
func loadEnvFile(path string) error {
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		line = strings.TrimPrefix(line, "export ")
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		if key == "" {
			continue
		}
		if _, exists := os.LookupEnv(key); exists {
			continue
		}
		value = strings.TrimSpace(value)
		if len(value) >= 2 {
			quoted := value[0] == '"' && value[len(value)-1] == '"' ||
				value[0] == '\'' && value[len(value)-1] == '\''
			if quoted {
				value = value[1 : len(value)-1]
			}
		}
		if err := os.Setenv(key, value); err != nil {
			return err
		}
	}
	return scanner.Err()
}
