package main

import (
	"bytes"
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
			header:  r.Header.Clone(),
			body:    string(body),
			hasBody: len(body) > 0,
		})
		c.mu.Unlock()

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = io.WriteString(w, responseBody)
	}
}

func (c *captureRecorder) requests() []capturedRequest {
	c.mu.Lock()
	defer c.mu.Unlock()
	return append([]capturedRequest(nil), c.captured...)
}

func bearerForTest(t *testing.T, cfg config, expiresIn time.Duration) string {
	t.Helper()
	token, err := signToken(cfg.jwtSecret, "tester", time.Now().Add(expiresIn).Unix())
	if err != nil {
		t.Fatalf("sign token: %v", err)
	}
	return token
}

func managedTestConfig(t *testing.T, baseURL string) config {
	t.Helper()
	cfg := authConfig()
	cfg.managedImageModels = []string{"flux-1-dev", "qwen-image-3.0"}
	cfg.managedLlmModel = "gpt-4o-mini"
	cfg.managedVisionModel = "gpt-4o"
	cfg.llmUpstream = &upstream{baseURL: mustParseURL(t, baseURL), apiKey: "server-llm-key"}
	cfg.imageUpstream = &upstream{baseURL: mustParseURL(t, baseURL), apiKey: "server-image-key"}
	return cfg
}

func managedRequest(t *testing.T, cfg config, method, url string, body any) *http.Request {
	t.Helper()
	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("encode body: %v", err)
		}
		reader = bytes.NewReader(encoded)
	}
	request, err := http.NewRequest(method, url, reader)
	if err != nil {
		t.Fatalf("build request: %v", err)
	}
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	request.Header.Set("Authorization", "Bearer "+bearerForTest(t, cfg, time.Hour))
	return request
}

func TestManagedConfigRequiresAuthAndReturnsModels(t *testing.T) {
	recorder := &captureRecorder{}
	upstreamServer := httptest.NewServer(recorder.handler(http.StatusOK, `{}`))
	defer upstreamServer.Close()
	cfg := managedTestConfig(t, upstreamServer.URL)
	server := newTestServer(t, cfg)

	response, err := server.Client().Get(server.URL + managedConfigPath)
	if err != nil {
		t.Fatalf("unauthenticated config: %v", err)
	}
	if response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", response.StatusCode)
	}
	response.Body.Close()

	request := managedRequest(t, cfg, http.MethodGet, server.URL+managedConfigPath, nil)
	response, err = server.Client().Do(request)
	if err != nil {
		t.Fatalf("config: %v", err)
	}
	var body managedConfigResponse
	body = decodeBody[managedConfigResponse](t, response)
	if len(body.Image.Models) != 2 || body.Image.DefaultModel != "flux-1-dev" {
		t.Errorf("image config = %+v", body.Image)
	}
	if body.Assistant.TextModel != "gpt-4o-mini" || body.Assistant.VisionModel != "gpt-4o" {
		t.Errorf("assistant config = %+v", body.Assistant)
	}
	if calls := len(recorder.requests()); calls != 0 {
		t.Errorf("config should not hit upstream, got %d calls", calls)
	}
}

func TestManagedConfigIncomplete(t *testing.T) {
	cfg := authConfig()
	cfg.llmUpstream = &upstream{baseURL: mustParseURL(t, "https://gateway.example.com/v1"), apiKey: "key"}
	server := newTestServer(t, cfg)
	request := managedRequest(t, cfg, http.MethodGet, server.URL+managedConfigPath, nil)
	response, err := server.Client().Do(request)
	if err != nil {
		t.Fatalf("config: %v", err)
	}
	if response.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", response.StatusCode)
	}
	if got := decodeBody[errorBody](t, response).Error; got != "managed_config_incomplete" {
		t.Errorf("error = %q", got)
	}
}

func TestManagedGenerateInjectsModelAndKey(t *testing.T) {
	recorder := &captureRecorder{}
	upstreamServer := httptest.NewServer(recorder.handler(http.StatusOK, `{"data":[{"url":"https://example.com/a.png"}]}`))
	defer upstreamServer.Close()
	cfg := managedTestConfig(t, upstreamServer.URL)
	server := newTestServer(t, cfg)

	request := managedRequest(t, cfg, http.MethodPost, server.URL+managedGeneratePath, map[string]any{
		"model":          "flux-1-dev",
		"prompt":         "a cat",
		"negativePrompt": "blurry",
		"size":           "16:9",
		"resolution":     "2k",
		"seed":           7,
	})
	response, err := server.Client().Do(request)
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	if response.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", response.StatusCode)
	}
	response.Body.Close()

	requests := recorder.requests()
	if len(requests) != 1 {
		t.Fatalf("upstream calls = %d, want 1", len(requests))
	}
	forwarded := requests[0]
	if forwarded.path != "/images/generations" {
		t.Errorf("path = %q", forwarded.path)
	}
	if got := forwarded.header.Get("Authorization"); got != "Bearer server-image-key" {
		t.Errorf("Authorization = %q", got)
	}
	var payload map[string]any
	if err := json.Unmarshal([]byte(forwarded.body), &payload); err != nil {
		t.Fatalf("decode upstream payload: %v", err)
	}
	if payload["model"] != "flux-1-dev" || payload["size"] != "16:9" {
		t.Errorf("payload = %v", payload)
	}
	if payload["negative_prompt"] != "blurry" || payload["resolution"] != "2k" {
		t.Errorf("gateway extensions missing: %v", payload)
	}
}

func TestManagedGenerateRejectsUnknownModel(t *testing.T) {
	recorder := &captureRecorder{}
	upstreamServer := httptest.NewServer(recorder.handler(http.StatusOK, `{}`))
	defer upstreamServer.Close()
	cfg := managedTestConfig(t, upstreamServer.URL)
	server := newTestServer(t, cfg)

	request := managedRequest(t, cfg, http.MethodPost, server.URL+managedGeneratePath, map[string]any{
		"model":  "not-allowed",
		"prompt": "a cat",
		"size":   "1:1",
	})
	response, err := server.Client().Do(request)
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	if response.StatusCode != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", response.StatusCode)
	}
	if got := decodeBody[errorBody](t, response).Error; got != "model_not_allowed" {
		t.Errorf("error = %q", got)
	}
	if calls := len(recorder.requests()); calls != 0 {
		t.Errorf("upstream calls = %d, want 0", calls)
	}
}

func TestManagedTaskForwards(t *testing.T) {
	recorder := &captureRecorder{}
	upstreamServer := httptest.NewServer(recorder.handler(http.StatusOK, `{"status":"completed"}`))
	defer upstreamServer.Close()
	cfg := managedTestConfig(t, upstreamServer.URL)
	server := newTestServer(t, cfg)

	request := managedRequest(t, cfg, http.MethodGet, server.URL+managedTaskPrefix+"task_123", nil)
	response, err := server.Client().Do(request)
	if err != nil {
		t.Fatalf("task: %v", err)
	}
	if response.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", response.StatusCode)
	}
	if body := readBody(t, response); body != `{"status":"completed"}` {
		t.Errorf("body = %q", body)
	}
	requests := recorder.requests()
	if len(requests) != 1 || requests[0].path != "/tasks/task_123" {
		t.Fatalf("upstream requests = %+v", requests)
	}
	if got := requests[0].header.Get("Authorization"); got != "Bearer server-image-key" {
		t.Errorf("Authorization = %q", got)
	}
}

func TestManagedAssistantUsesFixedModels(t *testing.T) {
	recorder := &captureRecorder{}
	upstreamServer := httptest.NewServer(recorder.handler(http.StatusOK, `{
		"choices":[{"message":{"role":"assistant","content":"fixed reply"}}]
	}`))
	defer upstreamServer.Close()
	cfg := managedTestConfig(t, upstreamServer.URL)
	server := newTestServer(t, cfg)

	request := managedRequest(t, cfg, http.MethodPost, server.URL+managedAssistantPath, map[string]any{
		"kind":   "polish",
		"prompt": "a cat",
	})
	response, err := server.Client().Do(request)
	if err != nil {
		t.Fatalf("assistant: %v", err)
	}
	var body managedAssistantResponse
	body = decodeBody[managedAssistantResponse](t, response)
	if body.Text != "fixed reply" {
		t.Errorf("text = %q", body.Text)
	}

	requests := recorder.requests()
	if len(requests) != 1 || requests[0].path != "/chat/completions" {
		t.Fatalf("upstream requests = %+v", requests)
	}
	var payload map[string]any
	if err := json.Unmarshal([]byte(requests[0].body), &payload); err != nil {
		t.Fatalf("decode payload: %v", err)
	}
	if payload["model"] != "gpt-4o-mini" {
		t.Errorf("model = %v", payload["model"])
	}

	recorder2 := &captureRecorder{}
	upstreamServer2 := httptest.NewServer(recorder2.handler(http.StatusOK, `{
		"choices":[{"message":{"role":"assistant","content":"vision reply"}}]
	}`))
	defer upstreamServer2.Close()
	cfg2 := managedTestConfig(t, upstreamServer2.URL)
	server2 := newTestServer(t, cfg2)
	visionRequest := managedRequest(t, cfg2, http.MethodPost, server2.URL+managedAssistantPath, map[string]any{
		"kind":  "vision",
		"image": "data:image/png;base64,AAAA",
	})
	visionResponse, err := server2.Client().Do(visionRequest)
	if err != nil {
		t.Fatalf("vision: %v", err)
	}
	if got := decodeBody[managedAssistantResponse](t, visionResponse).Text; got != "vision reply" {
		t.Errorf("vision text = %q", got)
	}
	if calls := recorder2.requests(); len(calls) != 1 {
		t.Fatalf("vision upstream calls = %d", len(calls))
	}
	var visionPayload map[string]any
	if err := json.Unmarshal([]byte(recorder2.requests()[0].body), &visionPayload); err != nil {
		t.Fatalf("decode vision payload: %v", err)
	}
	if visionPayload["model"] != "gpt-4o" {
		t.Errorf("vision model = %v", visionPayload["model"])
	}
}

func TestManagedAssistantRequiresConfiguredModel(t *testing.T) {
	cfg := authConfig()
	cfg.managedImageModels = []string{"flux-1-dev"}
	cfg.llmUpstream = &upstream{baseURL: mustParseURL(t, "https://gateway.example.com/v1"), apiKey: "key"}
	server := newTestServer(t, cfg)
	request := managedRequest(t, cfg, http.MethodPost, server.URL+managedAssistantPath, map[string]any{
		"kind":   "polish",
		"prompt": "a cat",
	})
	response, err := server.Client().Do(request)
	if err != nil {
		t.Fatalf("assistant: %v", err)
	}
	if response.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", response.StatusCode)
	}
	if got := decodeBody[errorBody](t, response).Error; got != "assistant_model_unconfigured" {
		t.Errorf("error = %q", got)
	}
}

func TestManagedRoutesRejectCrossOrigin(t *testing.T) {
	recorder := &captureRecorder{}
	upstreamServer := httptest.NewServer(recorder.handler(http.StatusOK, `{}`))
	defer upstreamServer.Close()
	cfg := managedTestConfig(t, upstreamServer.URL)
	server := newTestServer(t, cfg)
	request := managedRequest(t, cfg, http.MethodPost, server.URL+managedGeneratePath, map[string]any{
		"model":  "flux-1-dev",
		"prompt": "a cat",
		"size":   "1:1",
	})
	request.Header.Set("Origin", "https://evil.example")
	response, err := server.Client().Do(request)
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	if response.StatusCode != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", response.StatusCode)
	}
	if got := decodeBody[errorBody](t, response).Error; got != "cross_origin_forbidden" {
		t.Errorf("error = %q", got)
	}
	if calls := len(recorder.requests()); calls != 0 {
		t.Errorf("upstream calls = %d, want 0", calls)
	}
}

func TestManagedUpstreamUnreachable(t *testing.T) {
	upstreamServer := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	upstreamURL := upstreamServer.URL
	upstreamServer.Close()

	cfg := managedTestConfig(t, upstreamURL)
	server := newTestServer(t, cfg)
	request := managedRequest(t, cfg, http.MethodPost, server.URL+managedGeneratePath, map[string]any{
		"model":  "flux-1-dev",
		"prompt": "a cat",
		"size":   "1:1",
	})
	response, err := server.Client().Do(request)
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	if response.StatusCode != http.StatusBadGateway {
		t.Fatalf("status = %d, want 502", response.StatusCode)
	}
	if got := decodeBody[errorBody](t, response).Error; got != "upstream_unreachable" {
		t.Errorf("error = %q", got)
	}
}
