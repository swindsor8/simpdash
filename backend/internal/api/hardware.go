package api

import (
	"net/http"
)

// Hardware handles GET /api/hardware (and GET /agent/hardware on secondaries).
// Returns live sysfs thermal/fan sensors plus cached SMART drive health and
// ZFS pool status. Pass ?refresh=1 to bypass the 60s SMART/ZFS cache.
func (s *Server) Hardware(w http.ResponseWriter, r *http.Request) {
	force := r.URL.Query().Get("refresh") == "1"
	rep := s.hw.Collect(r.Context(), force)
	writeJSON(w, http.StatusOK, rep)
}
