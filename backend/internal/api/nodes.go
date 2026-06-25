package api

// Main-side node management (Milestone 5). Main pairs with a secondary's agent,
// stores the returned permanent token, and thereafter proxies the resource,
// updates, and catalog views to that secondary's /agent API on the admin's
// behalf. The browser never talks to a secondary directly — everything (live
// job output included) relays through main.

import (
	"encoding/json"
	"io"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/gorilla/websocket"

	"simpdash/internal/config"
)

// nodeHTTP proxies main->secondary requests. Dial timeout keeps an unreachable
// node from hanging the UI; no overall timeout so legitimately slow operations
// (apt-get update can take a minute) aren't cut off mid-flight.
var nodeHTTP = &http.Client{
	Transport: &http.Transport{
		DialContext: (&net.Dialer{Timeout: 5 * time.Second}).DialContext,
	},
}

// ListNodes handles GET /api/nodes — paired secondaries (never their tokens).
func (s *Server) ListNodes(w http.ResponseWriter, r *http.Request) {
	s.cfgMu.Lock()
	out := make([]map[string]string, 0, len(s.cfg.PairedNodes))
	for _, n := range s.cfg.PairedNodes {
		out = append(out, map[string]string{"id": n.ID, "address": n.Address})
	}
	s.cfgMu.Unlock()
	writeJSON(w, http.StatusOK, out)
}

// PairNode handles POST /api/nodes/pair. Main calls out to the secondary's
// /agent/pair with the code, stores the returned token + address, and adds the
// node to the dashboard list.
func (s *Server) PairNode(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Address string `json:"address"`
		Code    string `json:"code"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "address and code required")
		return
	}
	addr := normalizeAddr(body.Address)
	if addr == "" || body.Code == "" {
		writeErr(w, http.StatusBadRequest, "valid address and code required")
		return
	}

	req, _ := http.NewRequest(http.MethodPost, "http://"+addr+"/agent/pair", nil)
	req.Header.Set("Authorization", "Bearer "+body.Code)
	resp, err := nodeHTTP.Do(req)
	if err != nil {
		writeErr(w, http.StatusBadGateway, "could not reach node at "+addr)
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		writeErr(w, http.StatusBadRequest, "pairing rejected (check the code — it may be expired or already used)")
		return
	}
	var pr struct {
		Token string `json:"token"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&pr); err != nil || pr.Token == "" {
		writeErr(w, http.StatusBadGateway, "node returned no token")
		return
	}

	node := config.PairedNode{ID: randomHex(4), Address: addr, AuthToken: pr.Token}
	s.cfgMu.Lock()
	s.cfg.PairedNodes = append(s.cfg.PairedNodes, node)
	err = s.cfg.Save(s.cfgPath)
	s.cfgMu.Unlock()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "failed to save node")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"id": node.ID, "address": node.Address})
}

// handleNodesPrefix dispatches everything under /api/nodes/ : pairing, unpair,
// and the per-node proxy (HTTP + WS relay). Cookie/session gated like the rest
// of /api.
func (s *Server) handleNodesPrefix(w http.ResponseWriter, r *http.Request) {
	tail := strings.TrimPrefix(r.URL.Path, "/api/nodes/")

	if tail == "pair" {
		methodGate(http.MethodPost, s.requireAuth(s.PairNode))(w, r)
		return
	}

	parts := strings.SplitN(tail, "/", 2)
	id := parts[0]
	if id == "" {
		http.NotFound(w, r)
		return
	}
	node, ok := s.findNode(id)
	if !ok {
		writeErr(w, http.StatusNotFound, "unknown node")
		return
	}
	sub := ""
	if len(parts) == 2 {
		sub = parts[1]
	}

	// DELETE /api/nodes/:id — unpair (drop the stored token + address).
	if sub == "" && r.Method == http.MethodDelete {
		s.requireAuth(func(w http.ResponseWriter, r *http.Request) { s.unpairNode(w, r, id) })(w, r)
		return
	}

	// Live job output: relay the secondary's WS through main. Cookie + same
	// origin gated (the browser connects to main, not the secondary).
	if strings.HasPrefix(sub, "jobs/") && strings.HasSuffix(sub, "/stream") {
		if !s.validSession(r) {
			writeErr(w, http.StatusUnauthorized, "not authenticated")
			return
		}
		s.relayNodeStream(w, r, node, sub)
		return
	}

	// Everything else: plain JSON proxy to /agent/<sub>.
	s.requireAuth(func(w http.ResponseWriter, r *http.Request) { s.proxyNode(w, r, node, sub) })(w, r)
}

// proxyNode forwards the request to the node's /agent/<sub> with its bearer
// token and copies the response back. An unreachable node yields 502 with a
// clear message rather than hanging the UI (the M2 "degraded" pattern).
func (s *Server) proxyNode(w http.ResponseWriter, r *http.Request, node config.PairedNode, sub string) {
	target := "http://" + node.Address + "/agent/" + sub
	if r.URL.RawQuery != "" {
		target += "?" + r.URL.RawQuery
	}
	req, err := http.NewRequestWithContext(r.Context(), r.Method, target, r.Body)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	req.Header.Set("Authorization", "Bearer "+node.AuthToken)
	if ct := r.Header.Get("Content-Type"); ct != "" {
		req.Header.Set("Content-Type", ct)
	}
	resp, err := nodeHTTP.Do(req)
	if err != nil {
		writeErr(w, http.StatusBadGateway, "node unreachable")
		return
	}
	defer resp.Body.Close()
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	io.Copy(w, resp.Body) //nolint:errcheck
}

// relayNodeStream bridges a browser WS (downstream) to the secondary's agent WS
// (upstream), pumping job-output frames through. If the node is unreachable the
// dial fails before the upgrade, so the browser gets a normal 502.
func (s *Server) relayNodeStream(w http.ResponseWriter, r *http.Request, node config.PairedNode, sub string) {
	dialer := websocket.Dialer{HandshakeTimeout: 5 * time.Second}
	hdr := http.Header{"Authorization": []string{"Bearer " + node.AuthToken}}
	up, _, err := dialer.Dial("ws://"+node.Address+"/agent/"+sub, hdr)
	if err != nil {
		writeErr(w, http.StatusBadGateway, "node unreachable")
		return
	}
	defer up.Close()

	down, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer down.Close()

	// Drain browser reads so close frames are processed and we notice hangups.
	go func() {
		for {
			if _, _, err := down.ReadMessage(); err != nil {
				up.Close()
				return
			}
		}
	}()

	for {
		mt, msg, err := up.ReadMessage()
		if err != nil {
			return
		}
		if err := down.WriteMessage(mt, msg); err != nil {
			return
		}
	}
}

// unpairNode removes a paired node from config.
func (s *Server) unpairNode(w http.ResponseWriter, r *http.Request, id string) {
	s.cfgMu.Lock()
	kept := s.cfg.PairedNodes[:0]
	found := false
	for _, n := range s.cfg.PairedNodes {
		if n.ID == id {
			found = true
			continue
		}
		kept = append(kept, n)
	}
	s.cfg.PairedNodes = kept
	err := s.cfg.Save(s.cfgPath)
	s.cfgMu.Unlock()
	if !found {
		writeErr(w, http.StatusNotFound, "unknown node")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "failed to save")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) findNode(id string) (config.PairedNode, bool) {
	s.cfgMu.Lock()
	defer s.cfgMu.Unlock()
	for _, n := range s.cfg.PairedNodes {
		if n.ID == id {
			return n, true
		}
	}
	return config.PairedNode{}, false
}

// normalizeAddr strips scheme/trailing slash, defaults the port to 7575, and
// rejects anything with a path or whitespace (so we never proxy to an
// attacker-shaped URL built from admin input).
func normalizeAddr(in string) string {
	in = strings.TrimSpace(in)
	in = strings.TrimPrefix(in, "http://")
	in = strings.TrimPrefix(in, "https://")
	in = strings.Trim(in, "/")
	if in == "" || strings.ContainsAny(in, " /\\?#") {
		return ""
	}
	if !strings.Contains(in, ":") {
		in += ":7575"
	}
	return in
}
