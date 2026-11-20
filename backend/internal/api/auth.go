package api

import (
	"encoding/json"
	"log"
	"net/http"
	"strings"

	"golang.org/x/crypto/bcrypt"

	"simpdash/internal/config"
	"simpdash/internal/proxmox"
)

// SetupStatus handles GET /api/setup/status
func (s *Server) SetupStatus(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"onboarded":          s.cfg.Onboarded,
		"mode":               s.cfg.Mode,
		"pve_local":          proxmox.HasLocalPVE(),
		"proxmox_configured": s.px.Configured(),
	})
}

// SetupPassword handles POST /api/setup/password. After the password is set,
// it either stores the user-supplied Proxmox API credentials (e.g. when running
// inside an LXC container where pveum is unavailable) or auto-provisions a
// local Proxmox token via pveum. Auto-provisioning failure is non-fatal.
func (s *Server) SetupPassword(w http.ResponseWriter, r *http.Request) {
	if s.cfg.Onboarded {
		writeErr(w, http.StatusPreconditionFailed, "already onboarded")
		return
	}
	var body struct {
		Password string `json:"password"`
		Proxmox  *struct {
			Host    string `json:"host"`
			TokenID string `json:"token_id"`
			Secret  string `json:"secret"`
		} `json:"proxmox"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "password required")
		return
	}
	if len(body.Password) < 8 {
		writeErr(w, http.StatusBadRequest, "password must be at least 8 characters")
		return
	}

	var manualPX *config.ProxmoxConfig
	if body.Proxmox != nil {
		host := strings.TrimRight(strings.TrimSpace(body.Proxmox.Host), "/")
		tokenID := strings.TrimSpace(body.Proxmox.TokenID)
		secret := strings.TrimSpace(body.Proxmox.Secret)
		if host != "" || tokenID != "" || secret != "" {
			if err := validateProxmoxCreds(host, tokenID, secret); err != nil {
				writeErr(w, http.StatusBadRequest, err.Error())
				return
			}
			if _, err := proxmox.TestCreds(host, tokenID, secret); err != nil {
				writeErr(w, http.StatusBadGateway, "Proxmox connection failed: "+err.Error())
				return
			}
			manualPX = &config.ProxmoxConfig{Host: host, TokenID: tokenID, Secret: secret}
		}
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(body.Password), bcrypt.DefaultCost)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal error")
		return
	}
	s.cfgMu.Lock()
	s.cfg.PasswordHash = string(hash)
	s.cfg.Onboarded = true
	if manualPX != nil {
		s.cfg.Proxmox = manualPX
	}
	err = s.cfg.Save(s.cfgPath)
	s.cfgMu.Unlock()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "failed to save config")
		return
	}

	if manualPX != nil {
		s.px.SetCreds(manualPX.Host, manualPX.TokenID, manualPX.Secret)
		log.Printf("proxmox API configured manually: %s (%s)", manualPX.Host, manualPX.TokenID)
	} else if s.cfg.Mode == "main" {
		// Provision Proxmox token (main mode only). Best-effort: log and continue
		// so LXC/dev hosts without local pveum still reach the dashboard.
		if err := proxmox.Provision(s.cfg, s.cfgPath); err != nil {
			log.Printf("proxmox provisioning failed (configure API token in Settings): %v", err)
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
		Code     string `json:"code"` // TOTP or recovery code, when 2FA is enabled
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

	// Second factor. The step-up response confirms the password was right —
	// inherent to any 2FA flow; the rate limiter covers code guessing too.
	if s.cfg.TOTPEnabled {
		if body.Code == "" {
			writeJSON(w, http.StatusOK, map[string]any{"totp_required": true})
			return
		}
		if !s.checkSecondFactor(body.Code) {
			s.loginLimiter.recordFailure(ip)
			writeErr(w, http.StatusUnauthorized, "invalid code")
			return
		}
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

// ChangePassword handles POST /api/settings/password — updates the admin
// password after verifying the current password (and a 2FA code when TOTP is
// enabled). Rotates the session secret to revoke other sessions and re-issues
// a fresh cookie to the current browser so it stays signed in.
func (s *Server) ChangePassword(w http.ResponseWriter, r *http.Request) {
	ip := clientIP(r)
	if !s.loginLimiter.allow(ip) {
		writeErr(w, http.StatusTooManyRequests, "too many attempts, try again shortly")
		return
	}
	var body struct {
		CurrentPassword string `json:"current_password"`
		NewPassword     string `json:"new_password"`
		Code            string `json:"code"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid body")
		return
	}
	if body.CurrentPassword == "" {
		writeErr(w, http.StatusBadRequest, "current password required")
		return
	}
	if len(body.NewPassword) < 8 {
		writeErr(w, http.StatusBadRequest, "new password must be at least 8 characters")
		return
	}
	if err := bcrypt.CompareHashAndPassword([]byte(s.cfg.PasswordHash), []byte(body.CurrentPassword)); err != nil {
		s.loginLimiter.recordFailure(ip)
		writeErr(w, http.StatusUnauthorized, "current password is incorrect")
		return
	}
	if s.cfg.TOTPEnabled {
		if body.Code == "" {
			writeErr(w, http.StatusBadRequest, "2FA code required to change password")
			return
		}
		if !s.checkSecondFactor(body.Code) {
			s.loginLimiter.recordFailure(ip)
			writeErr(w, http.StatusUnauthorized, "invalid 2FA code")
			return
		}
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(body.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal error")
		return
	}
	s.cfgMu.Lock()
	s.cfg.PasswordHash = string(hash)
	err = s.cfg.Save(s.cfgPath)
	s.cfgMu.Unlock()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "failed to save config")
		return
	}

	// Revoke any other sessions while keeping this browser logged in.
	if err := s.rotateSecret(); err == nil {
		s.setSession(w, r)
	}
	s.loginLimiter.reset(ip)
	log.Printf("admin password changed")
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
