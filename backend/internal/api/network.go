package api

import "net/http"

// Network handles GET /api/network — returns the PVE host's network interfaces.
func (s *Server) Network(w http.ResponseWriter, r *http.Request) {
	ifaces, err := s.px.FetchNetwork(s.selfNode)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, ifaces)
}
