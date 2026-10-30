package main

import (
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
)

const (
	llmProxyPrefix   = "/api/proxy/llm"
	imageProxyPrefix = "/api/proxy/image"
)

// allowedProxyPaths is the closed set of upstream suffixes a session may reach.
// Everything the app needs is covered; the closed list stops a logged-in user
// from walking arbitrary endpoints of the upstream with the server's key.
var allowedProxyPaths = []string{"models", "chat/completions", "images/", "tasks/"}

func isAllowedProxyPath(path string) bool {
	// Defense in depth: ServeMux already cleans dot segments, but the forwarded
	// path must never be able to walk out of the allowlisted prefix.
	for _, segment := range strings.Split(path, "/") {
		if segment == "." || segment == ".." {
			return false
		}
	}
	for _, prefix := range allowedProxyPaths {
		if path == prefix || strings.HasPrefix(path, prefix) {
			return true
		}
	}
	return false
}

// Headers that must not be copied to the upstream. Authorization is replaced by
// the server key, cookies are never forwarded, framing/hop-by-hop headers are
// the transport's business, and client-supplied forwarding headers are dropped
// so a caller cannot spoof the upstream's view of its own IP. Accept-Encoding is
// dropped so Go's transport negotiates (and transparently decodes) gzip itself.
var skipRequestHeaders = map[string]bool{
	"Accept-Encoding":     true,
	"Authorization":       true,
	"Connection":          true,
	"Content-Length":      true,
	"Cookie":              true,
	"Forwarded":           true,
	"Host":                true,
	"Keep-Alive":          true,
	"Proxy-Authenticate":  true,
	"Proxy-Authorization": true,
	"Proxy-Connection":    true,
	"Te":                  true,
	"Trailer":             true,
	"Transfer-Encoding":   true,
	"Upgrade":             true,
	"X-Forwarded-For":     true,
	"X-Forwarded-Host":    true,
	"X-Forwarded-Proto":   true,
	"X-Real-Ip":           true,
}

// Headers the proxy never forwards from the upstream. Hop-by-hop framing is
// handled by the transport; cache and cookie directives are dropped because the
// API middleware owns Cache-Control (no-store) and the app never needs upstream
// cookies. Keeping the upstream directives here would emit two contradictory
// Cache-Control headers.
var skipResponseHeaders = map[string]bool{
	"Cache-Control":       true,
	"Connection":          true,
	"Expires":             true,
	"Keep-Alive":          true,
	"Pragma":              true,
	"Proxy-Authenticate":  true,
	"Proxy-Authorization": true,
	"Proxy-Connection":    true,
	"Set-Cookie":          true,
	"Te":                  true,
	"Trailer":             true,
	"Transfer-Encoding":   true,
	"Upgrade":             true,
}

func newProxyHandler(cfg config, kind proxyKind, client *http.Client) http.Handler {
	prefix := llmProxyPrefix
	if kind == kindImage {
		prefix = imageProxyPrefix
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		allowed, valid := checkOrigin(r)
		if !valid {
			writeError(w, http.StatusBadRequest, "invalid_request")
			return
		}
		if !allowed {
			writeError(w, http.StatusForbidden, "cross_origin_forbidden")
			return
		}

		target := cfg.upstreamFor(kind)
		if target == nil {
			writeError(w, http.StatusServiceUnavailable, "upstream_unconfigured")
			return
		}

		rest := strings.TrimPrefix(r.URL.Path, prefix+"/")
		if rest == "" || !isAllowedProxyPath(rest) {
			writeError(w, http.StatusNotFound, "path_not_allowed")
			return
		}

		upstreamURL := *target.baseURL
		upstreamURL.Path = strings.TrimSuffix(upstreamURL.Path, "/") + "/" + rest
		upstreamURL.RawPath = ""
		upstreamURL.RawQuery = r.URL.RawQuery

		outReq, err := http.NewRequestWithContext(r.Context(), r.Method, upstreamURL.String(), r.Body)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid_request")
			return
		}
		for name, values := range r.Header {
			if skipRequestHeaders[http.CanonicalHeaderKey(name)] {
				continue
			}
			for _, value := range values {
				outReq.Header.Add(name, value)
			}
		}
		outReq.Header.Set("Authorization", "Bearer "+target.apiKey)
		outReq.ContentLength = r.ContentLength

		resp, err := client.Do(outReq)
		if err != nil {
			slog.Warn("upstream request failed",
				"kind", kindName(kind),
				"method", r.Method,
				"path", r.URL.Path,
				"error", err,
			)
			writeError(w, http.StatusBadGateway, "upstream_unreachable")
			return
		}
		defer resp.Body.Close()

		for name, values := range resp.Header {
			if skipResponseHeaders[http.CanonicalHeaderKey(name)] {
				continue
			}
			for _, value := range values {
				w.Header().Add(name, value)
			}
		}

		w.WriteHeader(resp.StatusCode)
		if _, err := io.Copy(w, resp.Body); err != nil {
			slog.Debug("proxy response interrupted",
				"kind", kindName(kind),
				"path", r.URL.Path,
				"error", err,
			)
		}
	})
}

// checkOrigin enforces the same-origin rule. The browser client always talks to
// the proxy from its own origin, so a cross-origin Origin header is never
// legitimate. valid=false means the Origin value could not be parsed at all.
func checkOrigin(r *http.Request) (allowed bool, valid bool) {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true, true
	}
	parsed, err := url.Parse(origin)
	if err != nil || parsed.Host == "" {
		return false, false
	}
	return strings.EqualFold(parsed.Host, r.Host), true
}

func kindName(kind proxyKind) string {
	if kind == kindImage {
		return "image"
	}
	return "llm"
}
