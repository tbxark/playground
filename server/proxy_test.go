package main

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"
)

type capturedRequest struct {
	method  string
	path    string
	query   string
	header  http.Header
	body    string
	hasBody bool
}

type captureRecorder struct {
	mu       sync.Mutex
	captured []capturedRequest
}

func (c *captureRecorder) handler(status int, responseBody string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		c.mu.Lock()
		c.captured = append(c.captured, capturedRequest{
			method:  r.Method,
			path:    r.URL.Path,
			query:   r.URL.RawQuery,
			header:  r.Header.Clone(),
			body:    string(body),
			hasBody: len(body) > 0,
		})
		c.mu.Unlock()

		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("X-Upstream", "yes")
		w.WriteHeader(status)
		_, _ = io.WriteString(w, responseBody)
	}
}

func (c *captureRecorder) requests() []capturedRequest {
	c.mu.Lock()
	defer c.mu.Unlock()
	return append([]capturedRequest(nil), c.captured...)
}

func proxyTestConfig(t *testing.T, baseURL string) config {
	t.Helper()
	return config{
		jwtSecret: "test-signing-secret",
		jwtTTL:    time.Hour,
		llmUpstream: &upstream{
			baseURL: mustParseURL(t, baseURL),
			apiKey:  "server-side-key",
		},
	}
}

func bearerForTest(t *testing.T, cfg config, expiresIn time.Duration) string {
	t.Helper()
	token, err := signToken(cfg.jwtSecret, "tester", time.Now().Add(expiresIn).Unix())
	if err != nil {
		t.Fatalf("sign token: %v", err)
	}
	return token
}

func TestIsAllowedProxyPath(t *testing.T) {
	allowed := []string{"models", "chat/completions", "images/generations", "images/edits", "tasks/abc"}
	for _, path := range allowed {
		if !isAllowedProxyPath(path) {
			t.Errorf("%q should be allowed", path)
		}
	}
	rejected := []string{"", "chat", "embeddings", "images/../admin", "images/./x", "tasks/../../x"}
	for _, path := range rejected {
		if isAllowedProxyPath(path) {
			t.Errorf("%q should be rejected", path)
		}
	}
}

func TestProxyForwardsRequestAndInjectsKey(t *testing.T) {
	recorder := &captureRecorder{}
	upstreamServer := httptest.NewServer(recorder.handler(http.StatusCreated, `{"data":[]}`))
	defer upstreamServer.Close()

	cfg := proxyTestConfig(t, upstreamServer.URL+"/v1/")
	server := newTestServer(t, cfg)

	request, err := http.NewRequest(http.MethodPost,
		server.URL+"/api/proxy/llm/chat/completions?foo=bar&baz=1",
		bytes.NewReader([]byte(`{"model":"test-model"}`)))
	if err != nil {
		t.Fatalf("build request: %v", err)
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", "Bearer "+bearerForTest(t, cfg, time.Hour))
	request.Header.Set("Cookie", "session=secret")
	request.Header.Set("X-Custom", "kept")
	request.Header.Set("Accept-Encoding", "br")
	request.Header.Set("X-Forwarded-For", "203.0.113.99")
	request.Header.Set("X-Real-IP", "203.0.113.99")
	request.Header.Set("Forwarded", "for=203.0.113.99")

	response, err := server.Client().Do(request)
	if err != nil {
		t.Fatalf("proxy request: %v", err)
	}
	if response.StatusCode != http.StatusCreated {
		t.Fatalf("status = %d, want 201", response.StatusCode)
	}
	if got := response.Header.Get("X-Upstream"); got != "yes" {
		t.Errorf("upstream response header missing, X-Upstream = %q", got)
	}
	if body := readBody(t, response); body != `{"data":[]}` {
		t.Errorf("body = %q", body)
	}

	requests := recorder.requests()
	if len(requests) != 1 {
		t.Fatalf("upstream calls = %d, want 1", len(requests))
	}
	forwarded := requests[0]
	if forwarded.method != http.MethodPost {
		t.Errorf("method = %q", forwarded.method)
	}
	if forwarded.path != "/v1/chat/completions" {
		t.Errorf("path = %q", forwarded.path)
	}
	if forwarded.query != "foo=bar&baz=1" {
		t.Errorf("query = %q", forwarded.query)
	}
	if got := forwarded.header.Get("Authorization"); got != "Bearer server-side-key" {
		t.Errorf("upstream Authorization = %q", got)
	}
	if got := forwarded.header.Get("Cookie"); got != "" {
		t.Errorf("Cookie leaked upstream: %q", got)
	}
	if got := forwarded.header.Get("X-Custom"); got != "kept" {
		t.Errorf("X-Custom = %q", got)
	}
	if got := forwarded.header.Get("Accept-Encoding"); got == "br" {
		t.Error("client Accept-Encoding leaked upstream")
	}
	for _, name := range []string{"X-Forwarded-For", "X-Real-IP", "Forwarded"} {
		if got := forwarded.header.Get(name); got != "" {
			t.Errorf("client-supplied %s leaked upstream: %q", name, got)
		}
	}
	if forwarded.body != `{"model":"test-model"}` {
		t.Errorf("body = %q", forwarded.body)
	}
}

func TestProxyDropsUpstreamCacheAndCookieHeaders(t *testing.T) {
	upstreamServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "public, max-age=60")
		w.Header().Set("Pragma", "cache")
		w.Header().Set("Expires", "Wed, 21 Oct 2037 07:28:00 GMT")
		w.Header().Set("Set-Cookie", "upstream=1; Path=/")
		w.WriteHeader(http.StatusOK)
		_, _ = io.WriteString(w, `{}`)
	}))
	defer upstreamServer.Close()

	cfg := proxyTestConfig(t, upstreamServer.URL)
	server := newTestServer(t, cfg)

	request, _ := http.NewRequest(http.MethodGet, server.URL+"/api/proxy/llm/models", nil)
	request.Header.Set("Authorization", "Bearer "+bearerForTest(t, cfg, time.Hour))
	response, err := server.Client().Do(request)
	if err != nil {
		t.Fatalf("proxy request: %v", err)
	}
	defer response.Body.Close()

	if values := response.Header.Values("Cache-Control"); len(values) != 1 || values[0] != "no-store" {
		t.Errorf("Cache-Control = %v, want exactly [no-store]", values)
	}
	for _, name := range []string{"Pragma", "Expires", "Set-Cookie"} {
		if got := response.Header.Get(name); got != "" {
			t.Errorf("%s leaked from upstream: %q", name, got)
		}
	}
}

func TestProxyImagePrefixUsesImageUpstream(t *testing.T) {
	recorder := &captureRecorder{}
	upstreamServer := httptest.NewServer(recorder.handler(http.StatusOK, `{"created":1}`))
	defer upstreamServer.Close()

	cfg := proxyTestConfig(t, "https://llm.invalid/v1")
	cfg.imageUpstream = &upstream{baseURL: mustParseURL(t, upstreamServer.URL), apiKey: "image-key"}
	server := newTestServer(t, cfg)

	request, err := http.NewRequest(http.MethodPost, server.URL+"/api/proxy/image/images/generations", nil)
	if err != nil {
		t.Fatalf("build request: %v", err)
	}
	request.Header.Set("Authorization", "Bearer "+bearerForTest(t, cfg, time.Hour))
	response, err := server.Client().Do(request)
	if err != nil {
		t.Fatalf("proxy request: %v", err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", response.StatusCode)
	}

	requests := recorder.requests()
	if len(requests) != 1 || requests[0].path != "/images/generations" {
		t.Fatalf("unexpected upstream requests: %+v", requests)
	}
	if got := requests[0].header.Get("Authorization"); got != "Bearer image-key" {
		t.Errorf("Authorization = %q", got)
	}
}

func TestProxyRequiresValidToken(t *testing.T) {
	recorder := &captureRecorder{}
	upstreamServer := httptest.NewServer(recorder.handler(http.StatusOK, `{}`))
	defer upstreamServer.Close()

	cfg := proxyTestConfig(t, upstreamServer.URL)
	server := newTestServer(t, cfg)

	cases := []struct {
		name   string
		header string
	}{
		{"missing", ""},
		{"wrong scheme", "Basic abc"},
		{"garbage", "Bearer not-a-jwt"},
		{"expired", "Bearer " + bearerForTest(t, cfg, -time.Hour)},
		{"wrong secret", "Bearer " + func() string {
			token, err := signToken("another-secret", "tester", time.Now().Add(time.Hour).Unix())
			if err != nil {
				t.Fatalf("sign token: %v", err)
			}
			return token
		}()},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			request, err := http.NewRequest(http.MethodGet, server.URL+"/api/proxy/llm/models", nil)
			if err != nil {
				t.Fatalf("build request: %v", err)
			}
			if testCase.header != "" {
				request.Header.Set("Authorization", testCase.header)
			}
			response, err := server.Client().Do(request)
			if err != nil {
				t.Fatalf("proxy request: %v", err)
			}
			if response.StatusCode != http.StatusUnauthorized {
				t.Fatalf("status = %d, want 401", response.StatusCode)
			}
			if got := decodeBody[errorBody](t, response).Error; got != "unauthorized" {
				t.Errorf("error = %q", got)
			}
		})
	}
	if calls := len(recorder.requests()); calls != 0 {
		t.Errorf("upstream calls = %d, want 0", calls)
	}
}

func TestProxyRejectsPathsOutsideAllowlist(t *testing.T) {
	recorder := &captureRecorder{}
	upstreamServer := httptest.NewServer(recorder.handler(http.StatusOK, `{}`))
	defer upstreamServer.Close()

	cfg := proxyTestConfig(t, upstreamServer.URL)
	server := newTestServer(t, cfg)

	allowed := []string{
		"/api/proxy/llm/models",
		"/api/proxy/llm/chat/completions",
		"/api/proxy/llm/images/generations",
		"/api/proxy/llm/images/edits",
		"/api/proxy/llm/tasks/abc123",
	}
	for _, path := range allowed {
		request, _ := http.NewRequest(http.MethodGet, server.URL+path, nil)
		request.Header.Set("Authorization", "Bearer "+bearerForTest(t, cfg, time.Hour))
		response, err := server.Client().Do(request)
		if err != nil {
			t.Fatalf("GET %s: %v", path, err)
		}
		response.Body.Close()
		if response.StatusCode != http.StatusOK {
			t.Errorf("%s status = %d, want 200", path, response.StatusCode)
		}
	}

	rejected := []string{
		"/api/proxy/llm/embeddings",
		"/api/proxy/llm/chat",
		"/api/proxy/llm/",
		"/api/proxy/llm/tasks",
	}
	for _, path := range rejected {
		request, _ := http.NewRequest(http.MethodGet, server.URL+path, nil)
		request.Header.Set("Authorization", "Bearer "+bearerForTest(t, cfg, time.Hour))
		response, err := server.Client().Do(request)
		if err != nil {
			t.Fatalf("GET %s: %v", path, err)
		}
		if response.StatusCode != http.StatusNotFound {
			t.Errorf("%s status = %d, want 404", path, response.StatusCode)
		}
		if got := decodeBody[errorBody](t, response).Error; got != "path_not_allowed" {
			t.Errorf("%s error = %q", path, got)
		}
	}
}

func TestProxyRejectsCrossOrigin(t *testing.T) {
	recorder := &captureRecorder{}
	upstreamServer := httptest.NewServer(recorder.handler(http.StatusOK, `{}`))
	defer upstreamServer.Close()

	cfg := proxyTestConfig(t, upstreamServer.URL)
	server := newTestServer(t, cfg)
	token := bearerForTest(t, cfg, time.Hour)

	request, _ := http.NewRequest(http.MethodGet, server.URL+"/api/proxy/llm/models", nil)
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("Origin", "https://evil.example")
	response, err := server.Client().Do(request)
	if err != nil {
		t.Fatalf("proxy request: %v", err)
	}
	if response.StatusCode != http.StatusForbidden {
		t.Fatalf("cross-origin status = %d, want 403", response.StatusCode)
	}
	if got := decodeBody[errorBody](t, response).Error; got != "cross_origin_forbidden" {
		t.Errorf("error = %q", got)
	}

	invalid, _ := http.NewRequest(http.MethodGet, server.URL+"/api/proxy/llm/models", nil)
	invalid.Header.Set("Authorization", "Bearer "+token)
	invalid.Header.Set("Origin", "://broken")
	response, err = server.Client().Do(invalid)
	if err != nil {
		t.Fatalf("proxy request: %v", err)
	}
	if response.StatusCode != http.StatusBadRequest {
		t.Fatalf("invalid origin status = %d, want 400", response.StatusCode)
	}
	response.Body.Close()

	if calls := len(recorder.requests()); calls != 0 {
		t.Errorf("upstream calls = %d, want 0", calls)
	}
}

func TestProxyAllowsSameOrigin(t *testing.T) {
	recorder := &captureRecorder{}
	upstreamServer := httptest.NewServer(recorder.handler(http.StatusOK, `{}`))
	defer upstreamServer.Close()

	cfg := proxyTestConfig(t, upstreamServer.URL)
	server := newTestServer(t, cfg)

	request, _ := http.NewRequest(http.MethodGet, server.URL+"/api/proxy/llm/models", nil)
	request.Header.Set("Authorization", "Bearer "+bearerForTest(t, cfg, time.Hour))
	request.Header.Set("Origin", server.URL)
	response, err := server.Client().Do(request)
	if err != nil {
		t.Fatalf("proxy request: %v", err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", response.StatusCode)
	}
}

func TestProxyUpstreamUnconfigured(t *testing.T) {
	cfg := config{jwtSecret: "test-signing-secret", jwtTTL: time.Hour}
	server := newTestServer(t, cfg)

	request, _ := http.NewRequest(http.MethodGet, server.URL+"/api/proxy/llm/models", nil)
	request.Header.Set("Authorization", "Bearer "+bearerForTest(t, cfg, time.Hour))
	response, err := server.Client().Do(request)
	if err != nil {
		t.Fatalf("proxy request: %v", err)
	}
	if response.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", response.StatusCode)
	}
	if got := decodeBody[errorBody](t, response).Error; got != "upstream_unconfigured" {
		t.Errorf("error = %q", got)
	}
}

func TestProxyDecodesCompressedUpstream(t *testing.T) {
	var compressed bytes.Buffer
	writer := gzip.NewWriter(&compressed)
	if _, err := writer.Write([]byte(`{"data":[1]}`)); err != nil {
		t.Fatalf("gzip: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("gzip close: %v", err)
	}

	upstreamServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Content-Encoding", "gzip")
		_, _ = w.Write(compressed.Bytes())
	}))
	defer upstreamServer.Close()

	cfg := proxyTestConfig(t, upstreamServer.URL)
	server := newTestServer(t, cfg)

	request, _ := http.NewRequest(http.MethodGet, server.URL+"/api/proxy/llm/models", nil)
	request.Header.Set("Authorization", "Bearer "+bearerForTest(t, cfg, time.Hour))
	response, err := server.Client().Do(request)
	if err != nil {
		t.Fatalf("proxy request: %v", err)
	}
	if got := response.Header.Get("Content-Encoding"); got != "" {
		t.Errorf("Content-Encoding leaked after transport decoding: %q", got)
	}
	if body := readBody(t, response); body != `{"data":[1]}` {
		t.Errorf("body = %q", body)
	}
}

func TestProxyUpstreamUnreachable(t *testing.T) {
	upstreamServer := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	upstreamURL := upstreamServer.URL
	upstreamServer.Close()

	cfg := proxyTestConfig(t, upstreamURL)
	server := newTestServer(t, cfg)

	request, _ := http.NewRequest(http.MethodGet, server.URL+"/api/proxy/llm/models", nil)
	request.Header.Set("Authorization", "Bearer "+bearerForTest(t, cfg, time.Hour))
	response, err := server.Client().Do(request)
	if err != nil {
		t.Fatalf("proxy request: %v", err)
	}
	if response.StatusCode != http.StatusBadGateway {
		t.Fatalf("status = %d, want 502", response.StatusCode)
	}
	if got := decodeBody[errorBody](t, response).Error; got != "upstream_unreachable" {
		t.Errorf("error = %q", got)
	}
}

func TestProxyErrorResponsesAreJSON(t *testing.T) {
	cfg := proxyTestConfig(t, "https://gateway.example.com/v1")
	server := newTestServer(t, cfg)

	request, _ := http.NewRequest(http.MethodGet, server.URL+"/api/proxy/llm/models", nil)
	response, err := server.Client().Do(request)
	if err != nil {
		t.Fatalf("proxy request: %v", err)
	}
	if got := response.Header.Get("Content-Type"); got != "application/json; charset=utf-8" {
		t.Errorf("Content-Type = %q", got)
	}
	response.Body.Close()

	var body map[string]any
	response, err = server.Client().Get(server.URL + "/api/does-not-exist")
	if err != nil {
		t.Fatalf("GET unknown api route: %v", err)
	}
	raw := readBody(t, response)
	if err := json.Unmarshal([]byte(raw), &body); err != nil {
		t.Fatalf("unknown API route did not return JSON: %q", raw)
	}
	if body["error"] != "not_found" {
		t.Errorf("error = %v", body["error"])
	}
}
