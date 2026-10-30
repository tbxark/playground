package main

import (
	"encoding/base64"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestParseProxyURL(t *testing.T) {
	for raw, want := range map[string]string{
		"http://127.0.0.1:7890":                     "http://127.0.0.1:7890",
		"127.0.0.1:7890":                            "http://127.0.0.1:7890",
		" http://proxy.example.com:3128/ ":          "http://proxy.example.com:3128",
		"https://proxy.example.com:8443":            "https://proxy.example.com:8443",
		"http://user:secret@proxy.example.com:3128": "http://user:secret@proxy.example.com:3128",
		"socks5://127.0.0.1:1080":                   "socks5://127.0.0.1:1080",
		"SOCKS5H://10.0.0.2:1080":                   "socks5h://10.0.0.2:1080",
	} {
		parsed, err := parseProxyURL(raw)
		if err != nil {
			t.Fatalf("parseProxyURL(%q): %v", raw, err)
		}
		if parsed == nil {
			t.Fatalf("parseProxyURL(%q) = nil, want %q", raw, want)
		}
		if got := parsed.String(); got != want {
			t.Errorf("parseProxyURL(%q) = %q, want %q", raw, got, want)
		}
	}

	for _, raw := range []string{"", "   "} {
		parsed, err := parseProxyURL(raw)
		if err != nil || parsed != nil {
			t.Errorf("parseProxyURL(%q) = %v, %v; want nil, nil", raw, parsed, err)
		}
	}

	for _, raw := range []string{
		"ftp://proxy.example.com:21",
		"http://",
		"http://proxy.example.com:3128/prefix",
		"http://proxy.example.com:3128/?x=1",
		"http://proxy.example.com:3128/#frag",
		"http://proxy.example.com:notaport",
	} {
		if _, err := parseProxyURL(raw); err == nil {
			t.Errorf("parseProxyURL(%q) should fail", raw)
		}
	}
}

func TestUpstreamProxyFuncBypassesLoopback(t *testing.T) {
	explicit := mustParseURL(t, "http://user:secret@proxy.example.com:3128")
	proxyFor := upstreamProxyFunc(explicit)

	for _, raw := range []string{
		"http://localhost:11434/v1/models",
		"http://127.0.0.1:8080/api/health",
		"http://127.10.20.30/v1/models",
		"http://[::1]:8080/api/health",
	} {
		request, err := http.NewRequest(http.MethodGet, raw, nil)
		if err != nil {
			t.Fatalf("build request %q: %v", raw, err)
		}
		got, err := proxyFor(request)
		if err != nil {
			t.Fatalf("proxy for %q: %v", raw, err)
		}
		if got != nil {
			t.Errorf("%q should be dialed directly, got proxy %v", raw, got)
		}
	}

	request, err := http.NewRequest(http.MethodPost, "https://gateway.example.com/v1/images/generations", nil)
	if err != nil {
		t.Fatalf("build request: %v", err)
	}
	got, err := proxyFor(request)
	if err != nil {
		t.Fatalf("proxy: %v", err)
	}
	if got == nil || got.String() != explicit.String() {
		t.Errorf("external target proxy = %v, want %v", got, explicit)
	}
}

// The transport, not just the selector, has to route through the proxy: this
// exercises a real proxy server standing in for the upstream.
func TestUpstreamClientRoutesThroughProxy(t *testing.T) {
	var (
		sawAbsoluteForm bool
		sawTargetHost   string
		sawProxyAuth    string
	)
	proxyServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sawAbsoluteForm = r.URL.IsAbs()
		sawTargetHost = r.Host
		sawProxyAuth = r.Header.Get("Proxy-Authorization")
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"proxied":true}`)
	}))
	defer proxyServer.Close()

	proxyURL := mustParseURL(t, strings.Replace(proxyServer.URL, "http://", "http://proxyuser:proxypass@", 1))
	client := newUpstreamClient(config{upstreamProxy: proxyURL})
	response, err := client.Get("http://upstream.invalid/v1/models")
	if err != nil {
		t.Fatalf("GET through proxy: %v", err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatalf("read body: %v", err)
	}
	if string(body) != `{"proxied":true}` {
		t.Errorf("body = %q; the proxy did not answer the request", body)
	}
	if !sawAbsoluteForm || sawTargetHost != "upstream.invalid" {
		t.Errorf("proxy saw absolute=%v host=%q; request was not in proxy form", sawAbsoluteForm, sawTargetHost)
	}
	wantAuth := "Basic " + base64.StdEncoding.EncodeToString([]byte("proxyuser:proxypass"))
	if sawProxyAuth != wantAuth {
		t.Errorf("Proxy-Authorization = %q, want %q", sawProxyAuth, wantAuth)
	}
}

func TestUpstreamClientSkipsProxyForLoopbackUpstream(t *testing.T) {
	upstreamServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(w, "direct")
	}))
	defer upstreamServer.Close()

	// The proxy points at a server that would answer differently if used.
	proxyServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(w, "proxied")
	}))
	defer proxyServer.Close()

	client := newUpstreamClient(config{upstreamProxy: mustParseURL(t, proxyServer.URL)})
	response, err := client.Get(upstreamServer.URL + "/v1/models")
	if err != nil {
		t.Fatalf("GET upstream: %v", err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatalf("read body: %v", err)
	}
	if string(body) != "direct" {
		t.Errorf("body = %q; a loopback upstream must bypass the proxy", body)
	}
}

func TestHealthcheckClientNeverUsesProxy(t *testing.T) {
	transport, ok := newHealthcheckClient().Transport.(*http.Transport)
	if !ok {
		t.Fatal("healthcheck client transport is not *http.Transport")
	}
	if transport.Proxy != nil {
		t.Error("healthcheck client must not consult a proxy; the probe is loopback-only")
	}
}

func TestProxyLabelRedactsCredentials(t *testing.T) {
	clearServerEnv(t)
	cfg := config{upstreamProxy: mustParseURL(t, "http://user:secret@proxy.example.com:3128")}
	label := proxyLabel(cfg)
	if label != "http://proxy.example.com:3128" {
		t.Errorf("label = %q", label)
	}
	if strings.Contains(label, "user") || strings.Contains(label, "secret") {
		t.Errorf("label leaked proxy credentials: %q", label)
	}
	if got := proxyLabel(config{}); got != "none" {
		t.Errorf("unconfigured label = %q, want none", got)
	}
}
