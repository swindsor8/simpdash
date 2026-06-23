package api

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net"
	"net/http"
	"sync"
	"time"

	"simpdash/internal/config"
	"simpdash/internal/proxmox"
)

const (
	cookieName = "session"
	cookieTTL  = 30 * 24 * time.Hour
)

// Server holds shared state for all HTTP handlers: the live config, the
// Proxmox client, and the resource poller.
type Server struct {
	cfg     *config.Config
	cfgPath string
	px      *proxmox.Client
	poller  *Poller

	// secretMu guards cfg.SessionSecret, read on every authenticated request
	// (validSession) and written by logout (rotateSecret).
	secretMu sync.RWMutex

	loginLimiter *limiter
}

func NewServer(cfg *config.Config, cfgPath string, px *proxmox.Client, poller *Poller) *Server {
	return &Server{
		cfg:     cfg,
		cfgPath: cfgPath,
		px:      px,
		poller:  poller,
		// 5 failed logins per IP, then a 1-minute lockout for that IP.
		loginLimiter: newLimiter(5, time.Minute),
	}
}

// Routes registers every HTTP/WS route on mux.
func (s *Server) Routes(mux *http.ServeMux) {
	mux.HandleFunc("/api/setup/status", methodGate(http.MethodGet, s.SetupStatus))
	mux.HandleFunc("/api/setup/password", methodGate(http.MethodPost, s.SetupPassword))
	mux.HandleFunc("/api/auth/login", methodGate(http.MethodPost, s.Login))
	mux.HandleFunc("/api/auth/logout", methodGate(http.MethodPost, s.Logout))
	mux.HandleFunc("/api/auth/me", methodGate(http.MethodGet, s.Me))
	mux.HandleFunc("/api/resources", methodGate(http.MethodGet, s.requireAuth(s.Resources)))
	// WS upgrade is a GET; auth is checked inside the handler (browser sends the cookie).
	mux.HandleFunc("/api/resources/stream", s.ResourcesStream)
}

// --- session helpers ---

func (s *Server) secret() string {
	s.secretMu.RLock()
	defer s.secretMu.RUnlock()
	return s.cfg.SessionSecret
}

// rotateSecret generates a fresh SessionSecret and persists it. This
// invalidates EVERY existing session cookie — used by logout so signing out
// genuinely revokes server-side (the session token is a static HMAC, so
// rotating the key is the only way to kill an outstanding cookie).
func (s *Server) rotateSecret() error {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return err
	}
	s.secretMu.Lock()
	s.cfg.SessionSecret = hex.EncodeToString(b)
	err := s.cfg.Save(s.cfgPath)
	s.secretMu.Unlock()
	return err
}

// sessionToken derives the expected cookie value from the secret.
// ponytail: static HMAC per secret — rotate secret to invalidate all sessions.
func sessionToken(secret string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte("simpdash-session-v1"))
	return hex.EncodeToString(mac.Sum(nil))
}

func (s *Server) validSession(r *http.Request) bool {
	c, err := r.Cookie(cookieName)
	if err != nil {
		return false
	}
	return hmac.Equal([]byte(c.Value), []byte(sessionToken(s.secret())))
}

func (s *Server) setSession(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{
		Name:     cookieName,
		Value:    sessionToken(s.secret()),
		Path:     "/",
		MaxAge:   int(cookieTTL.Seconds()),
		HttpOnly: true,
		Secure:   isHTTPS(r),
		SameSite: http.SameSiteStrictMode,
	})
}

func (s *Server) clearSession(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{
		Name:     cookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   isHTTPS(r),
		SameSite: http.SameSiteStrictMode,
	})
}

func (s *Server) requireAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.validSession(r) {
			writeErr(w, http.StatusUnauthorized, "not authenticated")
			return
		}
		next(w, r)
	}
}

// --- small shared helpers ---

// isHTTPS reports whether the request reached us over TLS, directly or via a
// trusted reverse proxy. Controls the cookie Secure flag — we can't set Secure
// unconditionally because SimpDash is commonly served over plain HTTP on the
// LAN, where a Secure cookie would never be sent back.
func isHTTPS(r *http.Request) bool {
	return r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https"
}

// clientIP returns the connecting socket's IP (not X-Forwarded-For, which a
// client can spoof to evade the rate limiter). Behind a reverse proxy this is
// the proxy's IP, making the login limiter effectively global — acceptable for
// a single-admin tool.
func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func methodGate(method string, h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != method {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		h(w, r)
	}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v) //nolint:errcheck
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
