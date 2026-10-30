package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func clearServerEnv(t *testing.T) {
	t.Helper()
	for _, key := range []string{
		"HOST", "PORT", "LOG_LEVEL", "ENV_FILE",
		"AUTH_USERNAME", "AUTH_PASSWORD", "JWT_SECRET", "JWT_TTL_HOURS",
		"LLM_BASE_URL", "LLM_API_KEY", "IMAGE_BASE_URL", "IMAGE_API_KEY",
		"SERVER_DEFAULT_MODELS", "TRUST_PROXY_HEADERS",
	} {
		t.Setenv(key, "")
	}
}

func TestLoadConfigFallsBackToLLMUpstream(t *testing.T) {
	clearServerEnv(t)
	t.Setenv("LLM_BASE_URL", "https://gateway.example.com/v1/")
	t.Setenv("LLM_API_KEY", " sk-llm ")
	t.Setenv("JWT_TTL_HOURS", "12")

	cfg, err := loadConfig()
	if err != nil {
		t.Fatalf("loadConfig: %v", err)
	}
	if cfg.host != "127.0.0.1" || cfg.port != "8080" {
		t.Errorf("listen defaults = %s:%s", cfg.host, cfg.port)
	}
	if cfg.jwtTTL != 12*time.Hour {
		t.Errorf("jwtTTL = %v", cfg.jwtTTL)
	}
	if cfg.llmUpstream == nil || cfg.imageUpstream == nil {
		t.Fatal("both upstreams should resolve from LLM_*")
	}
	if got := cfg.imageUpstream.baseURL.String(); got != "https://gateway.example.com/v1" {
		t.Errorf("image base URL = %q", got)
	}
	if got := cfg.imageUpstream.apiKey; got != "sk-llm" {
		t.Errorf("image key = %q", got)
	}
}

func TestLoadConfigPrefersImageUpstream(t *testing.T) {
	clearServerEnv(t)
	t.Setenv("LLM_BASE_URL", "https://llm.example.com/v1")
	t.Setenv("LLM_API_KEY", "sk-llm")
	t.Setenv("IMAGE_BASE_URL", "https://images.example.com/v1")
	t.Setenv("IMAGE_API_KEY", "sk-image")

	cfg, err := loadConfig()
	if err != nil {
		t.Fatalf("loadConfig: %v", err)
	}
	if got := cfg.imageUpstream.baseURL.String(); got != "https://images.example.com/v1" {
		t.Errorf("image base URL = %q", got)
	}
	if got := cfg.imageUpstream.apiKey; got != "sk-image" {
		t.Errorf("image key = %q", got)
	}
}

func TestLoadConfigRejectsInvalidUpstream(t *testing.T) {
	clearServerEnv(t)
	t.Setenv("LLM_BASE_URL", "gateway.example.com/v1")
	t.Setenv("LLM_API_KEY", "sk-llm")

	if _, err := loadConfig(); err == nil {
		t.Fatal("expected an error for a relative upstream base URL")
	}
}

func TestLoadConfigRejectsInvalidPort(t *testing.T) {
	clearServerEnv(t)
	t.Setenv("PORT", "http")

	if _, err := loadConfig(); err == nil {
		t.Fatal("expected an error for a non-numeric port")
	}
}

func TestLoadConfigDefaultsJWTTTL(t *testing.T) {
	clearServerEnv(t)
	for _, value := range []string{"0", "-2", "soon", " "} {
		t.Setenv("JWT_TTL_HOURS", value)
		cfg, err := loadConfig()
		if err != nil {
			t.Fatalf("loadConfig: %v", err)
		}
		if cfg.jwtTTL != defaultJWTTTL {
			t.Errorf("JWT_TTL_HOURS=%q gave %v", value, cfg.jwtTTL)
		}
	}
}

func TestAuthConfiguredRequiresAllThree(t *testing.T) {
	base := config{authUsername: "admin", authPassword: "pass", jwtSecret: "secret"}
	if !base.authConfigured() {
		t.Fatal("expected auth to be configured")
	}
	for name, mutate := range map[string]func(*config){
		"no username": func(c *config) { c.authUsername = "" },
		"no password": func(c *config) { c.authPassword = "" },
		"no secret":   func(c *config) { c.jwtSecret = "" },
		"blank":       func(c *config) { c.jwtSecret = "   " },
	} {
		t.Run(name, func(t *testing.T) {
			cfg := base
			mutate(&cfg)
			if cfg.authConfigured() {
				t.Error("expected auth to be disabled")
			}
		})
	}
}

func TestParseDefaultModels(t *testing.T) {
	got := parseDefaultModels(" flux-1-dev, qwen-image ,, ")
	want := []string{"flux-1-dev", "qwen-image"}
	if len(got) != len(want) {
		t.Fatalf("models = %v", got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("models[%d] = %q, want %q", i, got[i], want[i])
		}
	}
	if parsed := parseDefaultModels("   "); parsed != nil {
		t.Errorf("blank list = %v, want nil", parsed)
	}
}

func TestLoadConfigTrustProxyHeaders(t *testing.T) {
	clearServerEnv(t)
	for value, want := range map[string]bool{
		"true":     true,
		"1":        true,
		"false":    false,
		"nonsense": false,
		"":         false,
	} {
		t.Setenv("TRUST_PROXY_HEADERS", value)
		cfg, err := loadConfig()
		if err != nil {
			t.Fatalf("loadConfig: %v", err)
		}
		if cfg.trustProxyHeaders != want {
			t.Errorf("TRUST_PROXY_HEADERS=%q gave %v, want %v", value, cfg.trustProxyHeaders, want)
		}
	}
}

func TestUpstreamLabelRedactsUserinfo(t *testing.T) {
	target := &upstream{
		baseURL: mustParseURL(t, "https://user:pass@gateway.example.com/v1"),
		apiKey:  "secret",
	}
	label := upstreamLabel(target)
	if label != "https://gateway.example.com/v1" {
		t.Errorf("label = %q", label)
	}
	if strings.Contains(label, "user") || strings.Contains(label, "pass") {
		t.Errorf("label leaked URL userinfo: %q", label)
	}
}

func TestLoadEnvFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), ".env.local")
	contents := "" +
		"# comment\n" +
		"\n" +
		"GO_ENV_TEST_NEW=from-file\n" +
		"export GO_ENV_TEST_EXPORTED=\"quoted value\"\n" +
		"GO_ENV_TEST_EXISTING=from-file\n" +
		"JWT_TTL_HOURS=24\n"
	if err := os.WriteFile(path, []byte(contents), 0o600); err != nil {
		t.Fatalf("write env file: %v", err)
	}

	t.Setenv("GO_ENV_TEST_EXISTING", "from-process")
	t.Cleanup(func() {
		// loadEnvFile writes through os.Setenv, which t.Setenv cannot revert.
		os.Unsetenv("GO_ENV_TEST_NEW")
		os.Unsetenv("GO_ENV_TEST_EXPORTED")
		os.Unsetenv("JWT_TTL_HOURS")
	})
	if err := loadEnvFile(path); err != nil {
		t.Fatalf("loadEnvFile: %v", err)
	}

	if got := os.Getenv("GO_ENV_TEST_NEW"); got != "from-file" {
		t.Errorf("new key = %q", got)
	}
	if got := os.Getenv("GO_ENV_TEST_EXPORTED"); got != "quoted value" {
		t.Errorf("exported key = %q", got)
	}
	if got := os.Getenv("GO_ENV_TEST_EXISTING"); got != "from-process" {
		t.Errorf("existing key was overridden: %q", got)
	}
}

func TestLoadEnvFileMissing(t *testing.T) {
	if err := loadEnvFile(filepath.Join(t.TempDir(), "nope")); err == nil {
		t.Fatal("expected an error for a missing env file")
	}
}
