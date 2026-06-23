package api

import (
	"encoding/json"
	"log"
	"net/http"

	"golang.org/x/crypto/bcrypt"

	"simpdash/internal/proxmox"
)

// SetupStatus handles GET /api/setup/status
func (s *Server) SetupStatus(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"onboarded": s.cfg.Onboarded,
		"mode":      s.cfg.Mode,
	})
}

// SetupPassword handles POST /api/setup/password. After the password is set,
// it provisions the Proxmox token inline so monitoring "just works" with no
// separate user step. Provisioning failure is non-fatal (degraded mode).
func (s *Server) SetupPassword(w http.ResponseWriter, r *http.Request) {
	if s.cfg.Onboarded {
		writeErr(w, http.StatusPreconditionFailed, "already onboarded")
		return
	}
	var body struct {
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "password required")
		return
	}
	if len(body.Password) < 8 {
		writeErr(w, http.StatusBadRequest, "password must be at least 8 characters")
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(body.Password), bcrypt.DefaultCost)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal error")
		return
	}
	s.cfg.PasswordHash = string(hash)
	s.cfg.Onboarded = true
	if err := s.cfg.Save(s.cfgPath); err != nil {
		writeErr(w, http.StatusInternalServerError, "failed to save config")
		return
	}

	// Provision Proxmox token (main mode only). Best-effort: log and continue
	// so dev/test hosts without PVE still reach the dashboard.
	if s.cfg.Mode == "main" {
		if err := proxmox.Provision(s.cfg, s.cfgPath); err != nil {
			log.Printf("proxmox provisioning failed (running degraded): %v", err)
		} else if s.cfg.Proxmox != nil {
			s.px.SetCreds(s.cfg.Proxmox.Host, s.cfg.Proxmox.TokenID, s.cfg.Proxmox.Secret)
			log.Printf("proxmox token provisioned: %s", s.cfg.Proxmox.TokenID)
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// Login handles POST /api/auth/login
func (s *Server) Login(w http.ResponseWriter, r *http.Request) {
	if !s.cfg.Onboarded {
		writeErr(w, http.StatusForbidden, "not onboarded")
		return
	}
	ip := clientIP(r)
	if !s.loginLimiter.allow(ip) {
		writeErr(w, http.StatusTooManyRequests, "too many attempts, try again shortly")
		return
	}
	var body struct {
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Password == "" {
		writeErr(w, http.StatusBadRequest, "password required")
		return
	}
	if err := bcrypt.CompareHashAndPassword([]byte(s.cfg.PasswordHash), []byte(body.Password)); err != nil {
		s.loginLimiter.recordFailure(ip)
		writeErr(w, http.StatusUnauthorized, "invalid password")
		return
	}
	s.loginLimiter.reset(ip)
	s.setSession(w, r)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// Logout handles POST /api/auth/logout. Rotating the session secret revokes
// the cookie server-side (not just clearing it client-side), so a copied
// cookie can't be replayed after logout.
func (s *Server) Logout(w http.ResponseWriter, r *http.Request) {
	if err := s.rotateSecret(); err != nil {
		writeErr(w, http.StatusInternalServerError, "failed to rotate session")
		return
	}
	s.clearSession(w, r)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// Me handles GET /api/auth/me — 200 if session valid, 401 otherwise
func (s *Server) Me(w http.ResponseWriter, r *http.Request) {
	if !s.validSession(r) {
		writeErr(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}
