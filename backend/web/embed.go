package web

import "embed"

// DistFS holds the compiled frontend (frontend/dist, copied here by npm build).
// Build first: cd frontend && npm run build
//
//go:embed all:dist
var DistFS embed.FS
