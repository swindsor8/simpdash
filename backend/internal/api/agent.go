package api

// Agent-side (secondary node) HTTP API. A secondary runs the same binary in
// `mode: secondary`, exposes this minimal API, and has NO session/UI auth:
// pairing establishes a permanent bearer token that gates everything else.
//
// Security model (matches the "main trusts itself" simplicity in the M5 design):
//   - /agent/pair is unauthenticated — the single-use, 15-min pairing code IS
//     the credential. It is advertised on boot (logged) until the node pairs.
//   - Every other /agent/* route requires the permanent token via
//     `Authorization: Bearer <token>`. No expiry, no rotation.
// The token and pairing code are compared in constant time (hmac.Equal).

import (
	"crypto/hmac"
	"crypto/rand"
	"encoding/hex"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"
)

// agentPairing holds the single-use code a not-yet-paired secondary advertises.
// Once paired, cfg.AgentToken is the permanent credential and code is cleared.
type agentPairing struct {
	mu      sync.Mutex
	code    string
	expires time.Time
}

// NewPairingCode generates a fresh 6-char code valid for 15 minutes and stores
// it. Returns the code so the caller (main.go on boot) can print it.
func (s *Server) NewPairingCode() string {
	code := randomCode(6)
	s.agent.mu.Lock()
	s.agent.code = code
	s.agent.expires = time.Now().Add(15 * time.Minute)
	s.agent.mu.Unlock()
	return code
}

// AgentPair handles POST /agent/pair. The pairing code is presented as a bearer
// credential. On success it mints a permanent token, persists it, invalidates
// the (single-use) code, and returns the token to main.
func (s *Server) AgentPair(w http.ResponseWriter, r *http.Request) {
	code := bearerToken(r)

	s.agent.mu.Lock()
	valid := s.agent.code != "" &&
		time.Now().Before(s.agent.expires) &&
		hmac.Equal([]byte(code), []byte(s.agent.code))
	if !valid {
		s.agent.mu.Unlock()
		writeErr(w, http.StatusUnauthorized, "invalid or expired pairing code")
		return
	}
	s.agent.code = "" // single-use: burn it even before we persist the token
	s.agent.mu.Unlock()

	token := randomHex(32)
	s.cfgMu.Lock()
	s.cfg.AgentToken = token
	err := s.cfg.Save(s.cfgPath)
	s.cfgMu.Unlock()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "failed to persist pairing")
		return
	}
	log.Printf("agent paired with main; permanent token issued")
	writeJSON(w, http.StatusOK, map[string]string{"token": token})
}

// requireAgentToken gates every agent endpoint except pairing.
func (s *Server) requireAgentToken(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		s.cfgMu.Lock()
		want := s.cfg.AgentToken
		s.cfgMu.Unlock()
		got := bearerToken(r)
		if want == "" || got == "" || !hmac.Equal([]byte(got), []byte(want)) {
			writeErr(w, http.StatusUnauthorized, "invalid agent token")
			return
		}
		next(w, r)
	}
}

// AgentRoutes registers the agent HTTP API (secondary mode only). It reuses the
// exact same Resources/Updates/Catalog/Job handlers main uses locally — they're
// just bearer-gated here instead of session-gated, and served under /agent.
func (s *Server) AgentRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/agent/pair", methodGate(http.MethodPost, s.AgentPair))
	mux.HandleFunc("/agent/resources", methodGate(http.MethodGet, s.requireAgentToken(s.Resources)))
	mux.HandleFunc("/agent/updates/check", methodGate(http.MethodGet, s.requireAgentToken(s.UpdatesCheck)))
	mux.HandleFunc("/agent/updates/apply", methodGate(http.MethodPost, s.requireAgentToken(s.UpdatesApply)))
	mux.HandleFunc("/agent/catalog", methodGate(http.MethodGet, s.requireAgentToken(s.Catalog)))
	mux.HandleFunc("/agent/catalog/", s.agentCatalogPrefix)
	mux.HandleFunc("/agent/jobs/", s.agentJobsPrefix)
}

// agentCatalogPrefix dispatches POST /agent/catalog/:slug/run.
func (s *Server) agentCatalogPrefix(w http.ResponseWriter, r *http.Request) {
	tail := strings.TrimPrefix(r.URL.Path, "/agent/catalog/")
	parts := strings.SplitN(tail, "/", 2)
	slug := parts[0]
	if slug == "" || len(parts) != 2 || parts[1] != "run" {
		http.NotFound(w, r)
		return
	}
	methodGate(http.MethodPost, s.requireAgentToken(func(w http.ResponseWriter, r *http.Request) {
		s.CatalogRun(w, r, slug)
	}))(w, r)
}

// agentJobsPrefix dispatches /agent/jobs/:id and /agent/jobs/:id/stream.
func (s *Server) agentJobsPrefix(w http.ResponseWriter, r *http.Request) {
	tail := strings.TrimPrefix(r.URL.Path, "/agent/jobs/")
	parts := strings.SplitN(tail, "/", 2)
	id := parts[0]
	if id == "" {
		http.NotFound(w, r)
		return
	}
	suffix := ""
	if len(parts) == 2 {
		suffix = parts[1]
	}
	switch suffix {
	case "stream":
		// WS: bearer-check inline (requireAgentToken wraps HandlerFunc, but we
		// need the raw conn). The dialer is main's relay, not a browser.
		s.cfgMu.Lock()
		want := s.cfg.AgentToken
		s.cfgMu.Unlock()
		if want == "" || !hmac.Equal([]byte(bearerToken(r)), []byte(want)) {
			writeErr(w, http.StatusUnauthorized, "invalid agent token")
			return
		}
		s.streamJob(w, r, id)
	case "":
		methodGate(http.MethodGet, s.requireAgentToken(func(w http.ResponseWriter, r *http.Request) {
			s.Job(w, r, id)
		}))(w, r)
	default:
		http.NotFound(w, r)
	}
}

// --- shared helpers ---

// bearerToken extracts the token from an `Authorization: Bearer <token>` header.
func bearerToken(r *http.Request) string {
	h := r.Header.Get("Authorization")
	if strings.HasPrefix(h, "Bearer ") {
		return strings.TrimSpace(h[len("Bearer "):])
	}
	return ""
}

func randomHex(n int) string {
	b := make([]byte, n)
	rand.Read(b) //nolint:errcheck
	return hex.EncodeToString(b)
}

// codeAlphabet omits 0/O/1/I to keep hand-typed pairing codes unambiguous.
const codeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

func randomCode(n int) string {
	b := make([]byte, n)
	rand.Read(b) //nolint:errcheck
	out := make([]byte, n)
	for i := range b {
		// ponytail: modulo bias over 32 symbols is negligible for a 6-char
		// single-use code that expires in 15 min — not a key.
		out[i] = codeAlphabet[int(b[i])%len(codeAlphabet)]
	}
	return string(out)
}
