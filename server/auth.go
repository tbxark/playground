package main

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/json"
	"log/slog"
	"net"
	"net/http"
	"net/netip"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	defaultJWTTTL = 168 * time.Hour // 7 days, same as the Hono server

	maxLoginFailures  = 5
	loginLockDuration = time.Minute
	loginFailureTTL   = 15 * time.Minute
	pruneInterval     = time.Minute
	maxLimiterEntries = 10_000
	maxLoginBodyBytes = 64 << 10
)

type loginResponse struct {
	Token string `json:"token"`
	// Unix seconds at which the token expires.
	Exp int64 `json:"exp"`
}

type loginRequest struct {
	Username *string `json:"username"`
	Password *string `json:"password"`
}

func (c config) loginHandler(limiter *loginLimiter) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !c.authConfigured() {
			writeError(w, http.StatusServiceUnavailable, "server_auth_unconfigured")
			return
		}

		ip := c.clientIP(r)
		if limiter.isLocked(ip) {
			writeError(w, http.StatusTooManyRequests, "too_many_attempts")
			return
		}

		r.Body = http.MaxBytesReader(w, r.Body, maxLoginBodyBytes)
		var body loginRequest
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil ||
			body.Username == nil || body.Password == nil {
			writeError(w, http.StatusBadRequest, "invalid_request")
			return
		}

		// Both digests are computed before branching so a wrong username and a
		// wrong password take the same path (and time) through the comparison.
		userOK := digestEqual(*body.Username, c.authUsername)
		passOK := digestEqual(*body.Password, c.authPassword)
		if !userOK || !passOK {
			limiter.recordFailure(ip)
			writeError(w, http.StatusUnauthorized, "invalid_credentials")
			return
		}

		limiter.reset(ip)

		exp := time.Now().Add(c.jwtTTL).Unix()
		token, err := signToken(c.jwtSecret, *body.Username, exp)
		if err != nil {
			slog.Error("sign login token", "error", err)
			writeError(w, http.StatusInternalServerError, "server_error")
			return
		}
		writeJSON(w, http.StatusOK, loginResponse{Token: token, Exp: exp})
	}
}

// requireAuth guards the proxy routes: a valid HS256 JWT with an expiry is
// mandatory. It deliberately depends only on JWT_SECRET: removing
// AUTH_USERNAME/AUTH_PASSWORD stops new logins but does not revoke tokens that
// were already issued. Rotate JWT_SECRET to invalidate every session.
func (c config) requireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token, ok := bearerToken(r.Header.Get("Authorization"))
		if !ok || c.jwtSecret == "" || verifyToken(token, c.jwtSecret) != nil {
			writeError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func bearerToken(header string) (string, bool) {
	fields := strings.Fields(header)
	if len(fields) != 2 || !strings.EqualFold(fields[0], "Bearer") {
		return "", false
	}
	return fields[1], true
}

// digestEqual compares SHA-256 digests in constant time so the comparison does
// not leak where the first differing byte is.
func digestEqual(got, want string) bool {
	gotDigest := sha256.Sum256([]byte(got))
	wantDigest := sha256.Sum256([]byte(want))
	return subtle.ConstantTimeCompare(gotDigest[:], wantDigest[:]) == 1
}

// clientIP resolves the address used for login throttling. Forwarded headers
// are only honored when TRUST_PROXY_HEADERS is enabled: they are otherwise
// client-controlled, and a proxy that appends to X-Forwarded-For (rather than
// overwriting it) leaves the first value spoofable.
func (c config) clientIP(r *http.Request) string {
	if c.trustProxyHeaders {
		if ip := strings.TrimSpace(r.Header.Get("CF-Connecting-IP")); ip != "" {
			return ip
		}
		if forwarded := r.Header.Get("X-Forwarded-For"); forwarded != "" {
			first, _, _ := strings.Cut(forwarded, ",")
			if ip := strings.TrimSpace(first); ip != "" {
				return ip
			}
		}
	}
	if host, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
		return host
	}
	if r.RemoteAddr == "" {
		return "local"
	}
	return r.RemoteAddr
}

// limiterKey collapses IPv6 addresses to their /64 so rotating within one
// allocation cannot reset the failure counter. IPv4-mapped addresses are
// unmapped to plain IPv4; unparseable values are kept as-is.
func limiterKey(ip string) string {
	ip = strings.TrimSpace(ip)
	addr, err := netip.ParseAddr(ip)
	if err != nil {
		return ip
	}
	addr = addr.Unmap()
	if addr.Is6() {
		if prefix, err := addr.Prefix(64); err == nil {
			return prefix.String()
		}
	}
	return addr.String()
}

type loginFailure struct {
	count       int
	lockedUntil time.Time
	lastSeen    time.Time
}

type loginLimiter struct {
	mu        sync.Mutex
	entries   map[string]loginFailure
	now       func() time.Time
	lastPrune time.Time
}

func newLoginLimiter() *loginLimiter {
	return &loginLimiter{entries: make(map[string]loginFailure), now: time.Now}
}

func (l *loginLimiter) isLocked(ip string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()

	key := limiterKey(ip)
	entry, ok := l.entries[key]
	if !ok || entry.lockedUntil.IsZero() {
		return false
	}
	if l.now().Before(entry.lockedUntil) {
		return true
	}
	delete(l.entries, key)
	return false
}

func (l *loginLimiter) recordFailure(ip string) {
	l.mu.Lock()
	defer l.mu.Unlock()

	now := l.now()
	key := limiterKey(ip)
	entry := l.entries[key]
	entry.count++
	entry.lastSeen = now
	if entry.count >= maxLoginFailures {
		entry.lockedUntil = now.Add(loginLockDuration)
		entry.count = 0
	}
	l.entries[key] = entry

	// Rate-limit the cleanup itself: one scan per minute bounds idle entries,
	// while the hard cap triggers an immediate prune.
	if now.Sub(l.lastPrune) >= pruneInterval || len(l.entries) > maxLimiterEntries {
		l.prune(now)
		l.lastPrune = now
	}
}

// prune drops entries that have not failed within loginFailureTTL and then
// enforces the hard cap by evicting the oldest entries. Callers hold l.mu.
func (l *loginLimiter) prune(now time.Time) {
	for key, entry := range l.entries {
		if now.Sub(entry.lastSeen) > loginFailureTTL {
			delete(l.entries, key)
		}
	}
	if len(l.entries) <= maxLimiterEntries {
		return
	}

	type candidate struct {
		key      string
		lastSeen time.Time
	}
	candidates := make([]candidate, 0, len(l.entries))
	for key, entry := range l.entries {
		candidates = append(candidates, candidate{key: key, lastSeen: entry.lastSeen})
	}
	sort.Slice(candidates, func(i, j int) bool {
		return candidates[i].lastSeen.Before(candidates[j].lastSeen)
	})
	for _, candidate := range candidates[:len(candidates)-maxLimiterEntries] {
		delete(l.entries, candidate.key)
	}
}

func (l *loginLimiter) reset(ip string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.entries, limiterKey(ip))
}
