package api

import (
	"encoding/json"
	"net/http"
	"net/url"
	"strings"

	"simpdash/internal/store"
)

// handleServiceLinksPrefix dispatches:
//   GET  /api/service-links        → GetServiceLinks
//   PUT  /api/service-links/:t/:id → UpsertServiceLink
//   DELETE /api/service-links/:t/:id → DeleteServiceLink
func (s *Server) handleServiceLinksPrefix(w http.ResponseWriter, r *http.Request) {
	tail := strings.TrimPrefix(r.URL.Path, "/api/service-links")
	if tail == "" || tail == "/" {
		methodGate(http.MethodGet, s.requireAuth(s.GetServiceLinks))(w, r)
		return
	}
	parts := strings.SplitN(strings.TrimPrefix(tail, "/"), "/", 2)
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		http.NotFound(w, r)
		return
	}
	key := parts[0] + ":" + parts[1]
	switch r.Method {
	case http.MethodPut:
		s.requireAuth(func(w http.ResponseWriter, r *http.Request) {
			s.UpsertServiceLink(w, r, key)
		})(w, r)
	case http.MethodDelete:
		s.requireAuth(func(w http.ResponseWriter, r *http.Request) {
			s.DeleteServiceLink(w, r, key)
		})(w, r)
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) GetServiceLinks(w http.ResponseWriter, r *http.Request) {
	m, err := s.serviceLinks.GetAll()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, m)
}

func (s *Server) UpsertServiceLink(w http.ResponseWriter, r *http.Request, key string) {
	var body struct {
		URL   string  `json:"url"`
		Label *string `json:"label"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid body")
		return
	}
	u, err := url.Parse(body.URL)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		writeErr(w, http.StatusBadRequest, "url must be a valid http(s):// URL")
		return
	}
	if err := s.serviceLinks.Upsert(key, store.ServiceLink{URL: body.URL, Label: body.Label}); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) DeleteServiceLink(w http.ResponseWriter, r *http.Request, key string) {
	if err := s.serviceLinks.Delete(key); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
