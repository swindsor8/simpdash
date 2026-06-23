package api

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"time"

	"golang.org/x/crypto/bcrypt"

	"simpdash/internal/config"
)

const (
	cookieName = "session"
	cookieTTL  = 30 * 24 * time.Hour
)

// AuthHandler handles all auth and setup routes.
type AuthHandler struct {
	cfg     *config.Config
	cfgPath string
}

// NewAuthHandler wires auth routes to the given config.
func NewAuthHandler(cfg *config.Config, cfgPath string) *AuthHandler {
	return &AuthHandler{cfg: cfg, cfgPath: cfgPath}
}

// sessionToken derives the expected cookie value from the secret.
// ponytail: static HMAC per secret — rotate secret to invalidate all sessions
func sessionToken(secret string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte("simpdash-session-v1"))
	return hex.EncodeToString(mac.Sum(nil))
}

func (h *AuthHandler) authenticated(r *http.Request) bool {
	c, err := r.Cookie(cookieName)
	if err != nil {
		return false
	}
	return hmac.Equal([]byte(c.Value), []byte(sessionToken(h.cfg.SessionSecret)))
}

func (h *AuthHandler) setSession(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     cookieName,
		Value:    sessionToken(h.cfg.SessionSecret),
		Path:     "/",
		MaxAge:   int(cookieTTL.Seconds()),
		HttpOnly: true,
		SameSite: http.SameSiteStrictMode,
	})
}

func (h *AuthHandler) clearSession(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     cookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		SameSite: http.SameSiteStrictMode,
	})
}

// SetupStatus handles GET /api/setup/status
func (h *AuthHandler) SetupStatus(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"onboarded": h.cfg.Onboarded,
		"mode":      h.cfg.Mode,
	})
}

// SetupPassword handles POST /api/setup/password
func (h *AuthHandler) SetupPassword(w http.ResponseWriter, r *http.Request) {
	if h.cfg.Onboarded {
		writeErr(w, http.StatusPreconditionFailed, "already onboarded")
		return
	}
	var body struct {
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Password == "" {
		writeErr(w, http.StatusBadRequest, "password required")
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(body.Password), bcrypt.DefaultCost)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal error")
		return
	}
	h.cfg.PasswordHash = string(hash)
	h.cfg.Onboarded = true
	if err := h.cfg.Save(h.cfgPath); err != nil {
		writeErr(w, http.StatusInternalServerError, "failed to save config")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// Login handles POST /api/auth/login
func (h *AuthHandler) Login(w http.ResponseWriter, r *http.Request) {
	if !h.cfg.Onboarded {
		writeErr(w, http.StatusForbidden, "not onboarded")
		return
	}
	var body struct {
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Password == "" {
		writeErr(w, http.StatusBadRequest, "password required")
		return
	}
	if err := bcrypt.CompareHashAndPassword([]byte(h.cfg.PasswordHash), []byte(body.Password)); err != nil {
		writeErr(w, http.StatusUnauthorized, "invalid password")
		return
	}
	h.setSession(w)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// Logout handles POST /api/auth/logout
func (h *AuthHandler) Logout(w http.ResponseWriter, r *http.Request) {
	h.clearSession(w)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// Me handles GET /api/auth/me — 200 if session valid, 401 otherwise
func (h *AuthHandler) Me(w http.ResponseWriter, r *http.Request) {
	if !h.authenticated(r) {
		writeErr(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v) //nolint:errcheck
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
