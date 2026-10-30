package main

import (
	"embed"
	"io/fs"
)

// The build script (server/build.sh) and the Dockerfile copy the Vite output
// into web/static before `go build`, so the SPA ends up inside the binary. The
// committed .gitkeep keeps this pattern valid on a clean checkout; a binary
// built without the copy still runs and explains how to rebuild.
//
//go:embed all:web/static
var embeddedWeb embed.FS

func embeddedStatic() fs.FS {
	sub, err := fs.Sub(embeddedWeb, "web/static")
	if err != nil {
		panic("embed web/static: " + err.Error())
	}
	return sub
}
