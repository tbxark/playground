package main

import (
	"io"
	"io/fs"
	"net/http"
	"path"
	"strings"
)

const (
	cacheImmutable  = "public, max-age=31536000, immutable"
	cacheRevalidate = "public, max-age=0, must-revalidate"
)

// webHandler serves the embedded SPA build: hashed assets immutable, the entry
// revalidated, and any extension-less route falling back to index.html.
type webHandler struct {
	fs    fs.FS
	files http.Handler
}

func newWebHandler(staticFS fs.FS) http.Handler {
	return &webHandler{fs: staticFS, files: http.FileServerFS(staticFS)}
}

func (h *webHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
		return
	}

	name := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
	if name == "" {
		h.serveIndex(w, r)
		return
	}
	if info, err := fs.Stat(h.fs, name); err == nil && !info.IsDir() {
		h.serveStatic(w, r, name)
		return
	}
	if isSPARoute(r.URL.Path) {
		h.serveIndex(w, r)
		return
	}
	http.NotFound(w, r)
}

func (h *webHandler) serveStatic(w http.ResponseWriter, r *http.Request, name string) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if strings.HasPrefix(name, "assets/") {
		w.Header().Set("Cache-Control", cacheImmutable)
	} else {
		w.Header().Set("Cache-Control", cacheRevalidate)
	}
	h.files.ServeHTTP(w, withPath(r, "/"+name))
}

func (h *webHandler) serveIndex(w http.ResponseWriter, r *http.Request) {
	if _, err := fs.Stat(h.fs, "index.html"); err != nil {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(http.StatusServiceUnavailable)
		_, _ = io.WriteString(w, "The web build is not embedded in this binary.\n\n"+
			"Run `pnpm build:go` (or build the Dockerfile at the repository root) to embed dist/.\n")
		return
	}
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", cacheRevalidate)
	// Serve the root path: http.FileServer redirects an explicit /index.html
	// request to "./", which would loop through the SPA fallback.
	h.files.ServeHTTP(w, withPath(r, "/"))
}

// isSPARoute decides whether a missing path is a client-side route. Hashed
// assets and anything that looks like a file must 404 instead of returning the
// SPA entry, otherwise a missing .js/.wasm would be answered with HTML.
func isSPARoute(requestPath string) bool {
	if strings.HasPrefix(requestPath, "/assets/") {
		return false
	}
	return !strings.Contains(path.Base(requestPath), ".")
}

func withPath(r *http.Request, newPath string) *http.Request {
	clone := r.Clone(r.Context())
	clone.URL.Path = newPath
	clone.URL.RawPath = ""
	return clone
}
