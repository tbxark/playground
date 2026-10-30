package main

import (
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
)

// parseProxyURL validates UPSTREAM_PROXY_URL. A bare host:port is accepted and
// treated as an HTTP proxy, the same shorthand HTTP_PROXY allows; the accepted
// schemes are exactly the ones net/http can dial.
func parseProxyURL(raw string) (*url.URL, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil
	}
	if !strings.Contains(raw, "://") {
		raw = "http://" + raw
	}
	parsed, err := url.Parse(raw)
	if err != nil {
		return nil, fmt.Errorf("invalid proxy URL %q: %w", raw, err)
	}
	switch parsed.Scheme {
	case "http", "https", "socks5", "socks5h":
	default:
		return nil, fmt.Errorf("proxy URL %q must use http, https, socks5 or socks5h", raw)
	}
	if parsed.Host == "" {
		return nil, fmt.Errorf("proxy URL %q must include a host", raw)
	}
	// A path, query or fragment never reaches the proxy, so a stray "?" would
	// silently drop part of a password instead of failing loudly.
	if (parsed.Path != "" && parsed.Path != "/") || parsed.RawQuery != "" || parsed.Fragment != "" {
		return nil, fmt.Errorf("proxy URL %q must not include a path, query or fragment", raw)
	}
	parsed.Path = ""
	parsed.RawPath = ""
	return parsed, nil
}

// upstreamProxyFunc selects the proxy for one upstream request. An explicit
// UPSTREAM_PROXY_URL wins for every external target; otherwise the standard
// HTTP_PROXY / HTTPS_PROXY / NO_PROXY variables decide per request, which is
// net/http's default. Loopback targets are always dialed directly so a local
// gateway (LLM_BASE_URL=http://127.0.0.1:11434/v1) keeps working when the
// process inherits a global proxy — net/http exempts only the literal name
// "localhost", not 127.0.0.1 or [::1].
func upstreamProxyFunc(explicit *url.URL) func(*http.Request) (*url.URL, error) {
	return func(req *http.Request) (*url.URL, error) {
		if req == nil || req.URL == nil || isLoopbackHost(req.URL.Hostname()) {
			return nil, nil
		}
		if explicit != nil {
			return explicit, nil
		}
		return http.ProxyFromEnvironment(req)
	}
}

func isLoopbackHost(host string) bool {
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

// proxyLabel reports the outbound proxy for startup logging without leaking
// the credentials that may sit in its userinfo.
func proxyLabel(cfg config) string {
	if cfg.upstreamProxy != nil {
		safe := *cfg.upstreamProxy
		safe.User = nil
		return safe.String()
	}
	for _, key := range []string{"HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"} {
		if strings.TrimSpace(os.Getenv(key)) != "" {
			return "environment"
		}
	}
	return "none"
}
