package api

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"simpdash/internal/catalog"
	"simpdash/internal/config"
	"simpdash/internal/executor"
	"simpdash/internal/proxmox"
	"simpdash/internal/store"
	"simpdash/internal/update"
)

const (
	cookieName = "session"
	cookieTTL  = 30 * 24 * time.Hour
)

// Server holds shared state for all HTTP handlers.
type Server struct {
	cfg          *config.Config
	cfgPath      string
	px           *proxmox.Client
	poller       *Poller
	exec         *executor.Executor
	db           *store.DB
	notes        *store.NotesDB
	serviceLinks *store.ServiceLinksDB
	catalog      *catalog.Catalog
	update       *update.Checker

	// secretMu guards cfg.SessionSecret, read on every authenticated request
	// (validSession) and written by logout (rotateSecret).
	secretMu sync.RWMutex

	// cfgMu guards the rarely-written cfg fields touched by M5: AgentToken
	// (secondary) and PairedNodes (main). Separate from secretMu (hot read path).
	// ponytail: single admin, pairing and logout never overlap in practice.
	cfgMu sync.Mutex

	// agent holds the secondary's single-use pairing code until it is paired.
	agent *agentPairing

	// backups memoizes the (multi-call) backup report; zero value is ready.
	backups backupCache

	// selfNode is this host's Proxmox node name (its hostname). The local node
	// is always "managed"; see managedNodeNames (M6).
	selfNode string

	loginLimiter *limiter
}

func NewServer(cfg *config.Config, cfgPath string, px *proxmox.Client, poller *Poller, exec *executor.Executor, db *store.DB, notes *store.NotesDB, serviceLinks *store.ServiceLinksDB, cat *catalog.Catalog, version string) *Server {
	host, _ := os.Hostname()
	s := &Server{
		cfg:          cfg,
		cfgPath:      cfgPath,
		px:           px,
		poller:       poller,
		exec:         exec,
		db:           db,
		notes:        notes,
		serviceLinks: serviceLinks,
		catalog:      cat,
		update:       update.New(version),
		agent:        &agentPairing{},
		selfNode:     host,
		loginLimiter: newLimiter(5, time.Minute),
	}
	// The live resource stream is annotated with the same managed/monitor-only
	// flags as the one-shot view (M6).
	poller.SetManaged(s.managedNodeNames)
	return s
}

// managedNodeNames returns the set of Proxmox node names SimpDash can act on:
// the local host plus every paired secondary. Cluster nodes outside this set
// are "monitor only" — visible via the cluster API but without an agent.
//
// ponytail: keyed on hostname == PVE node name, which holds on a standard
// Proxmox install. If someone renames a node away from its hostname, it just
// shows as monitor-only — honest, if conservative.
func (s *Server) managedNodeNames() map[string]bool {
	m := map[string]bool{}
	if s.selfNode != "" {
		m[s.selfNode] = true
	}
	s.cfgMu.Lock()
	for _, n := range s.cfg.PairedNodes {
		if n.NodeName != "" {
			m[n.NodeName] = true
		}
	}
	s.cfgMu.Unlock()
	return m
}

// Routes registers every HTTP/WS route on mux.
func (s *Server) Routes(mux *http.ServeMux) {
	mux.HandleFunc("/api/setup/status", methodGate(http.MethodGet, s.SetupStatus))
	mux.HandleFunc("/api/setup/password", methodGate(http.MethodPost, s.SetupPassword))
	mux.HandleFunc("/api/auth/login", methodGate(http.MethodPost, s.Login))
	mux.HandleFunc("/api/auth/logout", methodGate(http.MethodPost, s.Logout))
	mux.HandleFunc("/api/auth/me", methodGate(http.MethodGet, s.Me))
	mux.HandleFunc("/api/info", methodGate(http.MethodGet, s.requireAuth(s.Info)))
	mux.HandleFunc("/api/version", methodGate(http.MethodGet, s.requireAuth(s.Version)))
	mux.HandleFunc("/api/update-check", methodGate(http.MethodGet, s.requireAuth(s.UpdateCheck)))
	mux.HandleFunc("/api/network", methodGate(http.MethodGet, s.requireAuth(s.Network)))
	mux.HandleFunc("/api/network/stats", methodGate(http.MethodGet, s.requireAuth(s.NetworkStats)))
	mux.HandleFunc("/api/network/speedtest", methodGate(http.MethodPost, s.requireAuth(s.Speedtest)))
	mux.HandleFunc("/api/resources", methodGate(http.MethodGet, s.requireAuth(s.Resources)))
	mux.HandleFunc("/api/resources/stream", s.ResourcesStream)
	mux.HandleFunc("/api/backups", methodGate(http.MethodGet, s.requireAuth(s.Backups)))
	mux.HandleFunc("/api/updates/check", methodGate(http.MethodGet, s.requireAuth(s.UpdatesCheck)))
	mux.HandleFunc("/api/updates/apply", methodGate(http.MethodPost, s.requireAuth(s.UpdatesApply)))
	mux.HandleFunc("/api/jobs", methodGate(http.MethodGet, s.requireAuth(s.Jobs)))
	// /api/jobs/ is a prefix match; the handler parses /:id and /:id/stream.
	mux.HandleFunc("/api/jobs/", s.handleJobsPrefix)
	mux.HandleFunc("/api/catalog", methodGate(http.MethodGet, s.requireAuth(s.Catalog)))
	// /api/catalog/ is a prefix match; the handler parses /:slug/run.
	mux.HandleFunc("/api/catalog/", s.handleCatalogPrefix)
	// /api/guests/:vmid/services — running services inside a local guest.
	mux.HandleFunc("/api/guests/", s.handleGuestsPrefix)
	// Paired secondary nodes (M5). /api/nodes lists; /api/nodes/ handles pair,
	// unpair, and per-node proxy (resources/updates/catalog/jobs + WS relay).
	mux.HandleFunc("/api/nodes", methodGate(http.MethodGet, s.requireAuth(s.ListNodes)))
	mux.HandleFunc("/api/nodes/", s.handleNodesPrefix)
	// Lab notebook. /api/notes handles GET (list) + POST (create); the counts
	// exact route shadows the /api/notes/ prefix (PUT/DELETE :id).
	// Power actions: POST /api/entities/:type/:id/action
	mux.HandleFunc("/api/entities/", s.handleEntitiesPrefix)
	// Service links: GET /api/service-links; PUT|DELETE /api/service-links/:type/:id
	mux.HandleFunc("/api/service-links", s.requireAuth(s.GetServiceLinks))
	mux.HandleFunc("/api/service-links/", s.handleServiceLinksPrefix)
	mux.HandleFunc("/api/notes", s.requireAuth(s.handleNotes))
	mux.HandleFunc("/api/notes/counts", methodGate(http.MethodGet, s.requireAuth(s.NotesCounts)))
	mux.HandleFunc("/api/notes/", s.requireAuth(s.handleNotesPrefix))
}

// Info handles GET /api/info — exposes the backend host's Proxmox node name so
// the frontend can detect when a power action targets the node it's running on.
func (s *Server) Info(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"self_node": s.selfNode})
}

// handleCatalogPrefix dispatches POST /api/catalog/:slug/run.
func (s *Server) handleCatalogPrefix(w http.ResponseWriter, r *http.Request) {
	tail := strings.TrimPrefix(r.URL.Path, "/api/catalog/")
	parts := strings.SplitN(tail, "/", 2)
	slug := parts[0]
	if slug == "" || len(parts) != 2 || parts[1] != "run" {
		http.NotFound(w, r)
		return
	}
	methodGate(http.MethodPost, s.requireAuth(func(w http.ResponseWriter, r *http.Request) {
		s.CatalogRun(w, r, slug)
	}))(w, r)
}

// handleGuestsPrefix dispatches /api/guests/:vmid/{services,update}.
func (s *Server) handleGuestsPrefix(w http.ResponseWriter, r *http.Request) {
	tail := strings.TrimPrefix(r.URL.Path, "/api/guests/")
	parts := strings.SplitN(tail, "/", 2)
	vmid := parts[0]
	if vmid == "" || len(parts) != 2 {
		http.NotFound(w, r)
		return
	}
	switch parts[1] {
	case "services":
		methodGate(http.MethodGet, s.requireAuth(func(w http.ResponseWriter, r *http.Request) {
			s.GuestServices(w, r, vmid)
		}))(w, r)
	case "update":
		methodGate(http.MethodPost, s.requireAuth(func(w http.ResponseWriter, r *http.Request) {
			s.GuestUpdate(w, r, vmid)
		}))(w, r)
	default:
		http.NotFound(w, r)
	}
}

// handleJobsPrefix dispatches /api/jobs/:id and /api/jobs/:id/stream.
// stdlib 1.18 mux has no path-param support, so we parse manually.
// ponytail: switch to chi when M5 secondary routes need params too.
func (s *Server) handleJobsPrefix(w http.ResponseWriter, r *http.Request) {
	tail := strings.TrimPrefix(r.URL.Path, "/api/jobs/")
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
		s.JobStream(w, r, id)
	case "":
		methodGate(http.MethodGet, s.requireAuth(func(w http.ResponseWriter, r *http.Request) {
			s.Job(w, r, id)
		}))(w, r)
	default:
		http.NotFound(w, r)
	}
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
