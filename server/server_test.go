package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"testing/fstest"
	"time"
)

func newTestStaticFS() fstest.MapFS {
	return fstest.MapFS{
		"index.html":      &fstest.MapFile{Data: []byte("<!doctype html><div id=\"app\"></div>")},
		"assets/app.js":   &fstest.MapFile{Data: []byte("console.log('app')")},
		"assets/app.wasm": &fstest.MapFile{Data: []byte{0x00, 0x61, 0x73, 0x6d}},
		"assets/app.mjs":  &fstest.MapFile{Data: []byte("export default 1")},
		"favicon.ico":     &fstest.MapFile{Data: []byte{0x00, 0x00, 0x01, 0x00}},
	}
}

func newTestHandler(t *testing.T, cfg config, staticFS fs.FS) http.Handler {
	t.Helper()
	if staticFS == nil {
		staticFS = newTestStaticFS()
	}
	return newHandler(cfg, handlerOptions{staticFS: staticFS})
}

func newTestServer(t *testing.T, cfg config) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(newTestHandler(t, cfg, nil))
	t.Cleanup(server.Close)
	return server
}

func mustParseURL(t *testing.T, raw string) *url.URL {
	t.Helper()
	parsed, err := url.Parse(raw)
	if err != nil {
		t.Fatalf("parse %q: %v", raw, err)
	}
	return parsed
}

func postJSON(t *testing.T, client *http.Client, target string, body any) *http.Response {
	t.Helper()
	payload, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal body: %v", err)
	}
	response, err := client.Post(target, "application/json", bytes.NewReader(payload))
	if err != nil {
		t.Fatalf("POST %s: %v", target, err)
	}
	t.Cleanup(func() { response.Body.Close() })
	return response
}

func decodeBody[T any](t *testing.T, response *http.Response) T {
	t.Helper()
	defer response.Body.Close()
	var body T
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	return body
}

func readBody(t *testing.T, response *http.Response) string {
	t.Helper()
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatalf("read response: %v", err)
	}
	return string(body)
}

func authConfig() config {
	return config{
		authUsername: "admin",
		authPassword: "correct horse",
		jwtSecret:    "test-signing-secret",
		jwtTTL:       time.Hour,
	}
}

func loginFrom(t *testing.T, server *httptest.Server, forwardedFor, password string) *http.Response {
	t.Helper()
	payload, err := json.Marshal(map[string]string{"username": "admin", "password": password})
	if err != nil {
		t.Fatalf("marshal body: %v", err)
	}
	request, err := http.NewRequest(http.MethodPost, server.URL+"/api/auth/login", bytes.NewReader(payload))
	if err != nil {
		t.Fatalf("build request: %v", err)
	}
	request.Header.Set("Content-Type", "application/json")
	if forwardedFor != "" {
		request.Header.Set("X-Forwarded-For", forwardedFor)
	}
	response, err := server.Client().Do(request)
	if err != nil {
		t.Fatalf("login: %v", err)
	}
	return response
}

func TestHealthReportsConfiguration(t *testing.T) {
	cfg := authConfig()
	upstream := &upstream{baseURL: mustParseURL(t, "https://gateway.example.com/v1"), apiKey: "sk-test"}
	cfg.llmUpstream = upstream
	cfg.imageUpstream = upstream
	cfg.managedImageModels = []string{"flux-1-dev", "qwen-image"}

	server := newTestServer(t, cfg)
	response, err := server.Client().Get(server.URL + "/api/health")
	if err != nil {
		t.Fatalf("GET /api/health: %v", err)
	}
	if response.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", response.StatusCode)
	}
	if got := response.Header.Get("Cache-Control"); got != "no-store" {
		t.Errorf("Cache-Control = %q, want no-store", got)
	}

	var body healthResponse
	body = decodeBody[healthResponse](t, response)
	if !body.OK || !body.Auth.Enabled || !body.Upstreams.LLM || !body.Upstreams.Image {
		t.Errorf("unexpected health body: %+v", body)
	}
}

func TestHealthWithoutConfiguration(t *testing.T) {
	server := newTestServer(t, config{})
	response, err := server.Client().Get(server.URL + "/api/health")
	if err != nil {
		t.Fatalf("GET /api/health: %v", err)
	}
	body := decodeBody[healthResponse](t, response)
	if body.Auth.Enabled || body.Upstreams.LLM || body.Upstreams.Image {
		t.Errorf("expected everything disabled, got %+v", body)
	}
}

func TestLoginUnconfigured(t *testing.T) {
	server := newTestServer(t, config{})
	response := postJSON(t, server.Client(), server.URL+"/api/auth/login", map[string]string{
		"username": "admin",
		"password": "correct horse",
	})
	if response.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", response.StatusCode)
	}
	if body := decodeBody[errorBody](t, response); body.Error != "server_auth_unconfigured" {
		t.Errorf("error = %q", body.Error)
	}
}

func TestLoginIssuesVerifiableToken(t *testing.T) {
	cfg := authConfig()
	server := newTestServer(t, cfg)

	start := time.Now().Unix()
	response := postJSON(t, server.Client(), server.URL+"/api/auth/login", map[string]string{
		"username": "admin",
		"password": "correct horse",
	})
	if response.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", response.StatusCode, readBody(t, response))
	}

	body := decodeBody[loginResponse](t, response)
	if body.Token == "" {
		t.Fatal("empty token")
	}
	if body.Exp < start+3600 || body.Exp > start+3600+5 {
		t.Errorf("exp = %d, want ~%d", body.Exp, start+3600)
	}
	if err := verifyToken(body.Token, cfg.jwtSecret); err != nil {
		t.Errorf("issued token does not verify: %v", err)
	}
	if err := verifyToken(body.Token, "different-secret"); err == nil {
		t.Error("token verified with the wrong secret")
	}
}

func TestLoginRejectsBadRequests(t *testing.T) {
	server := newTestServer(t, authConfig())

	for name, body := range map[string]string{
		"not json":       "nope",
		"missing field":  `{"username":"admin"}`,
		"wrong type":     `{"username":1,"password":2}`,
		"empty document": ``,
	} {
		t.Run(name, func(t *testing.T) {
			response, err := server.Client().Post(server.URL+"/api/auth/login", "application/json", bytes.NewReader([]byte(body)))
			if err != nil {
				t.Fatalf("POST login: %v", err)
			}
			if response.StatusCode != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400", response.StatusCode)
			}
			if got := decodeBody[errorBody](t, response).Error; got != "invalid_request" {
				t.Errorf("error = %q", got)
			}
		})
	}
}

func TestLoginLocksOutAfterFiveFailures(t *testing.T) {
	server := newTestServer(t, authConfig())

	for attempt := 1; attempt <= maxLoginFailures; attempt++ {
		response := postJSON(t, server.Client(), server.URL+"/api/auth/login", map[string]string{
			"username": "admin",
			"password": "wrong",
		})
		if response.StatusCode != http.StatusUnauthorized {
			t.Fatalf("attempt %d: status = %d, want 401", attempt, response.StatusCode)
		}
		response.Body.Close()
	}

	locked := postJSON(t, server.Client(), server.URL+"/api/auth/login", map[string]string{
		"username": "admin",
		"password": "correct horse",
	})
	if locked.StatusCode != http.StatusTooManyRequests {
		t.Fatalf("locked login status = %d, want 429", locked.StatusCode)
	}
	if got := decodeBody[errorBody](t, locked).Error; got != "too_many_attempts" {
		t.Errorf("error = %q", got)
	}
}

func TestLoginRateLimitIsPerIP(t *testing.T) {
	cfg := authConfig()
	cfg.trustProxyHeaders = true
	server := newTestServer(t, cfg)

	for attempt := 1; attempt <= maxLoginFailures; attempt++ {
		response := loginFrom(t, server, "203.0.113.7", "wrong")
		response.Body.Close()
	}

	// The failing IP is locked...
	locked := loginFrom(t, server, "203.0.113.7", "correct horse")
	if locked.StatusCode != http.StatusTooManyRequests {
		t.Fatalf("same IP status = %d, want 429", locked.StatusCode)
	}
	locked.Body.Close()

	// ...while another client IP still logs in.
	other := loginFrom(t, server, "198.51.100.9", "correct horse")
	if other.StatusCode != http.StatusOK {
		t.Fatalf("other IP status = %d, want 200", other.StatusCode)
	}
	other.Body.Close()
}

func TestLoginIgnoresForwardedHeadersByDefault(t *testing.T) {
	server := newTestServer(t, authConfig())

	for attempt := 1; attempt <= maxLoginFailures; attempt++ {
		response := loginFrom(t, server, "203.0.113.7", "wrong")
		response.Body.Close()
	}

	// With TRUST_PROXY_HEADERS off, a rotating forwarded IP must not escape the
	// lock; the limiter keys on the TCP peer (the same for every request here).
	response := loginFrom(t, server, "198.51.100.9", "correct horse")
	if response.StatusCode != http.StatusTooManyRequests {
		t.Fatalf("spoofed X-Forwarded-For status = %d, want 429", response.StatusCode)
	}
	response.Body.Close()
}

func TestClientIPHonorsTrustFlag(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	request.RemoteAddr = "10.0.0.9:1234"
	request.Header.Set("CF-Connecting-IP", "203.0.113.10")
	request.Header.Set("X-Forwarded-For", "198.51.100.10, 10.0.0.9")

	if got := (config{}).clientIP(request); got != "10.0.0.9" {
		t.Errorf("untrusted clientIP = %q, want RemoteAddr", got)
	}
	if got := (config{trustProxyHeaders: true}).clientIP(request); got != "203.0.113.10" {
		t.Errorf("trusted clientIP with CF header = %q", got)
	}

	request.Header.Del("CF-Connecting-IP")
	if got := (config{trustProxyHeaders: true}).clientIP(request); got != "198.51.100.10" {
		t.Errorf("trusted clientIP with XFF = %q", got)
	}

	request.Header.Del("X-Forwarded-For")
	if got := (config{trustProxyHeaders: true}).clientIP(request); got != "10.0.0.9" {
		t.Errorf("trusted clientIP without headers = %q", got)
	}
}

func TestLimiterUnlocksAfterWindow(t *testing.T) {
	limiter := newLoginLimiter()
	now := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	limiter.now = func() time.Time { return now }

	for i := 0; i < maxLoginFailures; i++ {
		limiter.recordFailure("203.0.113.7")
	}
	if !limiter.isLocked("203.0.113.7") {
		t.Fatal("expected the IP to be locked")
	}

	now = now.Add(loginLockDuration + time.Second)
	if limiter.isLocked("203.0.113.7") {
		t.Fatal("expected the lock to expire")
	}

	limiter.recordFailure("203.0.113.7")
	if limiter.isLocked("203.0.113.7") {
		t.Fatal("one failure after expiry must not re-lock")
	}
}

func TestLimiterPrunesStaleEntries(t *testing.T) {
	limiter := newLoginLimiter()
	now := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	limiter.now = func() time.Time { return now }

	for i := 0; i < 2000; i++ {
		limiter.recordFailure(fmt.Sprintf("10.0.%d.%d", i/256, i%256))
	}
	if len(limiter.entries) != 2000 {
		t.Fatalf("entries = %d, want 2000", len(limiter.entries))
	}

	// Advance past the TTL; recording a new failure triggers the periodic prune.
	now = now.Add(loginFailureTTL + time.Minute)
	limiter.recordFailure("192.0.2.50")
	if len(limiter.entries) != 1 {
		t.Fatalf("entries after prune = %d, want 1", len(limiter.entries))
	}
	if _, ok := limiter.entries[limiterKey("192.0.2.50")]; !ok {
		t.Fatal("fresh entry was pruned")
	}
}

func TestLimiterCapsEntries(t *testing.T) {
	limiter := newLoginLimiter()
	now := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)

	for i := 0; i < maxLimiterEntries+5; i++ {
		key := fmt.Sprintf("key-%05d", i)
		limiter.entries[key] = loginFailure{lastSeen: now.Add(time.Duration(i) * time.Second)}
	}

	limiter.prune(now)
	if len(limiter.entries) != maxLimiterEntries {
		t.Fatalf("entries = %d, want %d", len(limiter.entries), maxLimiterEntries)
	}
	if _, ok := limiter.entries["key-00000"]; ok {
		t.Fatal("oldest entry was not evicted")
	}
	if _, ok := limiter.entries[fmt.Sprintf("key-%05d", maxLimiterEntries+4)]; !ok {
		t.Fatal("newest entry was evicted")
	}
}

func TestLimiterKeyNormalizesIPv6(t *testing.T) {
	if limiterKey("2001:db8::1") != limiterKey("2001:db8::ffff") {
		t.Error("addresses in the same /64 should share a limiter key")
	}
	if limiterKey("2001:db8::1") == limiterKey("2001:db8:0:1::1") {
		t.Error("addresses in different /64s should not share a limiter key")
	}
	if got := limiterKey("::ffff:192.0.2.1"); got != "192.0.2.1" {
		t.Errorf("IPv4-mapped key = %q", got)
	}
	if got := limiterKey(" 192.0.2.1 "); got != "192.0.2.1" {
		t.Errorf("trimmed key = %q", got)
	}
	if got := limiterKey("not-an-ip"); got != "not-an-ip" {
		t.Errorf("invalid key = %q", got)
	}
}

func TestBearerToken(t *testing.T) {
	cases := []struct {
		header string
		token  string
		ok     bool
	}{
		{"Bearer abc", "abc", true},
		{"bearer abc", "abc", true},
		{"Bearer   abc", "abc", true},
		{"Basic abc", "", false},
		{"Bearer", "", false},
		{"Bearer a b", "", false},
		{"", "", false},
	}
	for _, testCase := range cases {
		token, ok := bearerToken(testCase.header)
		if ok != testCase.ok || token != testCase.token {
			t.Errorf("bearerToken(%q) = (%q, %v), want (%q, %v)",
				testCase.header, token, ok, testCase.token, testCase.ok)
		}
	}
}
