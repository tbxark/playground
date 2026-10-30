package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

func serve(t *testing.T, handler http.Handler, method, path string) *http.Response {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)

	request, err := http.NewRequest(method, server.URL+path, nil)
	if err != nil {
		t.Fatalf("build request: %v", err)
	}
	response, err := server.Client().Do(request)
	if err != nil {
		t.Fatalf("%s %s: %v", method, path, err)
	}
	t.Cleanup(func() { response.Body.Close() })
	return response
}

func TestStaticServesIndexAndAssets(t *testing.T) {
	handler := newTestHandler(t, config{}, nil)

	index := serve(t, handler, http.MethodGet, "/")
	if index.StatusCode != http.StatusOK {
		t.Fatalf("index status = %d", index.StatusCode)
	}
	if got := index.Header.Get("Cache-Control"); got != cacheRevalidate {
		t.Errorf("index Cache-Control = %q", got)
	}
	if body := readBody(t, index); !strings.Contains(body, `id="app"`) {
		t.Errorf("index body = %q", body)
	}

	asset := serve(t, handler, http.MethodGet, "/assets/app.js")
	if asset.StatusCode != http.StatusOK {
		t.Fatalf("asset status = %d", asset.StatusCode)
	}
	if got := asset.Header.Get("Cache-Control"); got != cacheImmutable {
		t.Errorf("asset Cache-Control = %q", got)
	}
	if got := asset.Header.Get("Content-Type"); !strings.Contains(got, "javascript") {
		t.Errorf("asset Content-Type = %q", got)
	}
	if body := readBody(t, asset); body != "console.log('app')" {
		t.Errorf("asset body = %q", body)
	}

	wasm := serve(t, handler, http.MethodGet, "/assets/app.wasm")
	if wasm.StatusCode != http.StatusOK {
		t.Fatalf("wasm status = %d", wasm.StatusCode)
	}
	if got := wasm.Header.Get("Content-Type"); !strings.Contains(got, "application/wasm") {
		t.Errorf("wasm Content-Type = %q", got)
	}
	if got := wasm.Header.Get("Cache-Control"); got != cacheImmutable {
		t.Errorf("wasm Cache-Control = %q", got)
	}
	wasm.Body.Close()

	module := serve(t, handler, http.MethodGet, "/assets/app.mjs")
	if module.StatusCode != http.StatusOK {
		t.Fatalf("mjs status = %d", module.StatusCode)
	}
	if got := module.Header.Get("Content-Type"); !strings.Contains(got, "javascript") {
		t.Errorf("mjs Content-Type = %q", got)
	}
	module.Body.Close()

	rootFile := serve(t, handler, http.MethodGet, "/favicon.ico")
	if rootFile.StatusCode != http.StatusOK {
		t.Fatalf("favicon status = %d", rootFile.StatusCode)
	}
	rootFile.Body.Close()
}

func TestStaticFallsBackToIndexForClientRoutes(t *testing.T) {
	handler := newTestHandler(t, config{}, nil)

	for _, path := range []string{"/gallery", "/workflow", "/onboarding", "/simple/deep/route"} {
		response := serve(t, handler, http.MethodGet, path)
		if response.StatusCode != http.StatusOK {
			t.Errorf("%s status = %d, want 200", path, response.StatusCode)
		}
		if body := readBody(t, response); !strings.Contains(body, `id="app"`) {
			t.Errorf("%s did not fall back to index.html: %q", path, body)
		}
	}
}

func TestStaticDoesNotServeIndexForMissingFiles(t *testing.T) {
	handler := newTestHandler(t, config{}, nil)

	for _, path := range []string{"/assets/missing.js", "/missing.png", "/logo.svg"} {
		response := serve(t, handler, http.MethodGet, path)
		if response.StatusCode != http.StatusNotFound {
			t.Errorf("%s status = %d, want 404", path, response.StatusCode)
		}
		if body := readBody(t, response); strings.Contains(body, `id="app"`) {
			t.Errorf("%s was answered with index.html", path)
		}
	}
}

func TestStaticRejectsNonReadMethods(t *testing.T) {
	handler := newTestHandler(t, config{}, nil)
	response := serve(t, handler, http.MethodPost, "/")
	if response.StatusCode != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want 405", response.StatusCode)
	}
	if got := response.Header.Get("Allow"); got != "GET, HEAD" {
		t.Errorf("Allow = %q", got)
	}
}

func TestStaticMissingEmbeddedBuildExplainsItself(t *testing.T) {
	handler := newTestHandler(t, config{}, fstest.MapFS{})
	response := serve(t, handler, http.MethodGet, "/gallery")
	if response.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", response.StatusCode)
	}
	if body := readBody(t, response); !strings.Contains(body, "pnpm build:go") {
		t.Errorf("expected build hint, got %q", body)
	}
}

func TestUnknownAPIRouteReturnsJSON(t *testing.T) {
	handler := newTestHandler(t, config{}, nil)
	response := serve(t, handler, http.MethodGet, "/api/nope")
	if response.StatusCode != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", response.StatusCode)
	}
	if got := response.Header.Get("Cache-Control"); got != "no-store" {
		t.Errorf("Cache-Control = %q", got)
	}
	if got := decodeBody[errorBody](t, response).Error; got != "not_found" {
		t.Errorf("error = %q", got)
	}
}

func TestUnknownAPIRouteNeverFallsBackToIndex(t *testing.T) {
	handler := newTestHandler(t, config{}, nil)
	for _, path := range []string{"/api/gallery", "/api", "/api/"} {
		response := serve(t, handler, http.MethodGet, path)
		body := readBody(t, response)
		if strings.Contains(body, `id="app"`) {
			t.Errorf("%s was answered with the SPA entry point", path)
		}
		if response.StatusCode != http.StatusNotFound {
			t.Errorf("%s status = %d, want 404", path, response.StatusCode)
		}
	}
}

func TestHealthRejectsWrongMethod(t *testing.T) {
	handler := newTestHandler(t, config{}, nil)
	response := serve(t, handler, http.MethodPost, "/api/health")
	if response.StatusCode != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want 405", response.StatusCode)
	}
}
