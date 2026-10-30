package main

import (
	"encoding/json"
	"io/fs"
	"log/slog"
	"net/http"
	"strings"
	"time"
)

type handlerOptions struct {
	httpClient *http.Client
	staticFS   fs.FS
}

// newHandler wires the API and the embedded SPA into one http.Handler. It is
// shared by main and the tests, which inject an httptest-friendly client and an
// in-memory static filesystem.
func newHandler(cfg config, opts handlerOptions) http.Handler {
	if opts.httpClient == nil {
		opts.httpClient = newUpstreamClient()
	}
	if opts.staticFS == nil {
		opts.staticFS = embeddedStatic()
	}

	limiter := newLoginLimiter()
	health := healthHandler(cfg)
	login := cfg.loginHandler(limiter)

	mux := http.NewServeMux()
	mux.HandleFunc("/api/health", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			methodNotAllowed(w, "GET, HEAD")
			return
		}
		health.ServeHTTP(w, r)
	})
	mux.HandleFunc("/api/auth/login", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			methodNotAllowed(w, "POST")
			return
		}
		login.ServeHTTP(w, r)
	})
	mux.Handle(llmProxyPrefix+"/", cfg.requireAuth(newProxyHandler(cfg, kindLLM, opts.httpClient)))
	mux.Handle(imageProxyPrefix+"/", cfg.requireAuth(newProxyHandler(cfg, kindImage, opts.httpClient)))
	apiNotFound := func(w http.ResponseWriter, _ *http.Request) {
		writeError(w, http.StatusNotFound, "not_found")
	}
	// "/api" is separate from the "/api/" subtree: without it the SPA handler
	// would answer a bare /api (and /api?query) with index.html.
	mux.HandleFunc("/api", apiNotFound)
	mux.HandleFunc("/api/", apiNotFound)
	mux.Handle("/", newWebHandler(opts.staticFS))

	return withAPIMiddleware(mux, cfg)
}

func methodNotAllowed(w http.ResponseWriter, allow string) {
	w.Header().Set("Allow", allow)
	writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
}

// withAPIMiddleware keeps API responses uncached and logs one line per API call.
// Static assets are deliberately excluded so page loads do not flood the log.
func withAPIMiddleware(next http.Handler, cfg config) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api" && !strings.HasPrefix(r.URL.Path, "/api/") {
			next.ServeHTTP(w, r)
			return
		}

		w.Header().Set("Cache-Control", "no-store")
		start := time.Now()
		recorder := &statusRecorder{ResponseWriter: w}
		next.ServeHTTP(recorder, r)

		status := recorder.status
		if status == 0 {
			status = http.StatusOK
		}
		slog.Info("api request",
			"method", r.Method,
			"path", r.URL.Path,
			"status", status,
			"bytes", recorder.bytes,
			"duration", time.Since(start).Round(time.Millisecond),
			"ip", cfg.clientIP(r),
		)
	})
}

type statusRecorder struct {
	http.ResponseWriter
	status int
	bytes  int64
}

func (s *statusRecorder) WriteHeader(status int) {
	if s.status == 0 {
		s.status = status
	}
	s.ResponseWriter.WriteHeader(status)
}

func (s *statusRecorder) Write(body []byte) (int, error) {
	if s.status == 0 {
		s.status = http.StatusOK
	}
	n, err := s.ResponseWriter.Write(body)
	s.bytes += int64(n)
	return n, err
}

// Unwrap keeps ResponseController features (flush, deadlines) reachable.
func (s *statusRecorder) Unwrap() http.ResponseWriter {
	return s.ResponseWriter
}

type healthResponse struct {
	OK   bool `json:"ok"`
	Auth struct {
		Enabled bool `json:"enabled"`
	} `json:"auth"`
	Upstreams struct {
		LLM   bool `json:"llm"`
		Image bool `json:"image"`
	} `json:"upstreams"`
	// Model ids the operator pre-approves; merged client-side after login.
	DefaultModels []string `json:"defaultModels,omitempty"`
}

func healthHandler(cfg config) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		body := healthResponse{OK: true}
		body.Auth.Enabled = cfg.authConfigured()
		body.Upstreams.LLM = cfg.upstreamFor(kindLLM) != nil
		body.Upstreams.Image = cfg.upstreamFor(kindImage) != nil
		body.DefaultModels = cfg.defaultModels
		writeJSON(w, http.StatusOK, body)
	})
}

type errorBody struct {
	Error string `json:"error"`
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func writeError(w http.ResponseWriter, status int, code string) {
	writeJSON(w, status, errorBody{Error: code})
}
