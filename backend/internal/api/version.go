package api

import "net/http"

// Version handles GET /api/version — the running build's version string.
func (s *Server) Version(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"version": s.update.Current()})
}

// UpdateCheck handles GET /api/update-check — compares the running build
// against the latest GitHub release (cached ~daily by the Checker).
func (s *Server) UpdateCheck(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.update.Check())
}
