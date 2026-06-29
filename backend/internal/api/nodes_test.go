package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"simpdash/internal/catalog"
	"simpdash/internal/config"
	"simpdash/internal/executor"
	"simpdash/internal/proxmox"
	"simpdash/internal/store"
)

func testServer(t *testing.T, cfg *config.Config) *Server {
	t.Helper()
	dir := t.TempDir()
	cfg.DBPath = filepath.Join(dir, "jobs.json")
	db, err := store.Open(cfg.DBPath)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	cat, err := catalog.Load()
	if err != nil {
		t.Fatalf("load catalog: %v", err)
	}
	notes, err := store.OpenNotes(filepath.Join(dir, "notes.json"))
	if err != nil {
		t.Fatalf("open notes: %v", err)
	}
	links, err := store.OpenServiceLinks(filepath.Join(dir, "service-links.json"))
	if err != nil {
		t.Fatalf("open service links: %v", err)
	}
	px := proxmox.NewClient()
	return NewServer(cfg, filepath.Join(dir, "config.yaml"), px, NewPoller(px, time.Second), executor.New(), db, notes, links, cat, "dev")
}

func postJSON(t *testing.T, url, body string, cookie *http.Cookie) *http.Response {
	t.Helper()
	req, _ := http.NewRequest(http.MethodPost, url, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if cookie != nil {
		req.AddCookie(cookie)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("POST %s: %v", url, err)
	}
	return resp
}

// End-to-end: a main server pairs with a secondary agent, then proxies catalog
// and relays a live job's output through main. Covers the whole M5 happy path
// plus single-use pairing, token gating, and the unreachable degraded case.
func TestPairProxyAndRelay(t *testing.T) {
	// --- secondary agent (no UI, bearer-gated) ---
	agentSrv := testServer(t, &config.Config{Mode: "secondary"})
	amux := http.NewServeMux()
	agentSrv.AgentRoutes(amux)
	agent := httptest.NewServer(amux)
	defer agent.Close()
	agentAddr := strings.TrimPrefix(agent.URL, "http://")
	code := agentSrv.NewPairingCode()

	// --- main (session-gated) ---
	mainSrv := testServer(t, &config.Config{Mode: "main", SessionSecret: "testsecret", Onboarded: true})
	mmux := http.NewServeMux()
	mainSrv.Routes(mmux)
	main := httptest.NewServer(mmux)
	defer main.Close()
	cookie := &http.Cookie{Name: cookieName, Value: sessionToken("testsecret")}

	// 1. Pair main -> agent.
	resp := postJSON(t, main.URL+"/api/nodes/pair",
		`{"address":"`+agentAddr+`","code":"`+code+`"}`, cookie)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("pair: status %d", resp.StatusCode)
	}
	var node struct{ ID, Address string }
	json.NewDecoder(resp.Body).Decode(&node)
	resp.Body.Close()
	if node.ID == "" {
		t.Fatal("pair: no node id returned")
	}
	if agentSrv.cfg.AgentToken == "" {
		t.Fatal("agent did not persist a token after pairing")
	}

	// 2. The code is single-use: pairing again with it must fail.
	resp = postJSON(t, main.URL+"/api/nodes/pair",
		`{"address":"`+agentAddr+`","code":"`+code+`"}`, cookie)
	if resp.StatusCode == http.StatusOK {
		t.Error("reusing a spent pairing code succeeded; want failure")
	}
	resp.Body.Close()

	// 3. Token gating: a bad bearer is rejected on the agent directly.
	req, _ := http.NewRequest(http.MethodGet, agent.URL+"/agent/catalog", nil)
	req.Header.Set("Authorization", "Bearer wrong")
	if r, _ := http.DefaultClient.Do(req); r == nil || r.StatusCode != http.StatusUnauthorized {
		t.Fatalf("bad agent token: want 401, got %v", r)
	}

	// 4. Proxy: main fetches the agent's catalog on the admin's behalf.
	req, _ = http.NewRequest(http.MethodGet, main.URL+"/api/nodes/"+node.ID+"/catalog", nil)
	req.AddCookie(cookie)
	r, err := http.DefaultClient.Do(req)
	if err != nil || r.StatusCode != http.StatusOK {
		t.Fatalf("proxy catalog: %v status=%v", err, r)
	}
	var scripts []map[string]any
	json.NewDecoder(r.Body).Decode(&scripts)
	r.Body.Close()
	if len(scripts) == 0 {
		t.Fatal("proxied catalog was empty")
	}

	// 5. Relay: start a benign job on the AGENT, stream it through MAIN.
	jobID, err := agentSrv.exec.Start("apt_upgrade",
		exec.Command("sh", "-c", "echo hello-from-agent; sleep 0.3"), agentSrv.db)
	if err != nil {
		t.Fatalf("start agent job: %v", err)
	}
	wsURL := "ws" + strings.TrimPrefix(main.URL, "http") +
		"/api/nodes/" + node.ID + "/jobs/" + jobID + "/stream"
	conn, _, err := websocket.DefaultDialer.Dial(wsURL,
		http.Header{"Cookie": []string{cookieName + "=" + sessionToken("testsecret")}})
	if err != nil {
		t.Fatalf("relay dial: %v", err)
	}
	defer conn.Close()
	conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	var sawLine bool
	for {
		_, msg, err := conn.ReadMessage()
		if err != nil {
			break // channel closed = job done
		}
		if strings.Contains(string(msg), "hello-from-agent") {
			sawLine = true
		}
	}
	if !sawLine {
		t.Error("did not receive the agent job's output through the main relay")
	}

	// 6. Unreachable node: stop the agent, then a proxied request degrades to 502.
	agent.Close()
	req, _ = http.NewRequest(http.MethodGet, main.URL+"/api/nodes/"+node.ID+"/resources", nil)
	req.AddCookie(cookie)
	r, err = http.DefaultClient.Do(req)
	if err != nil || r.StatusCode != http.StatusBadGateway {
		t.Fatalf("unreachable node: want 502, got %v (err %v)", r, err)
	}
	r.Body.Close()
}

// Monitor-only detection: the local node and paired secondaries are managed;
// a cluster-visible node with no agent is not.
func TestManagedAnnotation(t *testing.T) {
	srv := testServer(t, &config.Config{
		Mode:        "main",
		PairedNodes: []config.PairedNode{{ID: "a", Address: "10.0.0.2:7575", NodeName: "pve2"}},
	})
	srv.selfNode = "pve1" // deterministic; real value is os.Hostname()

	snap := &proxmox.Snapshot{Nodes: []proxmox.Node{{ID: "pve1"}, {ID: "pve2"}, {ID: "pve3"}}}
	annotateManaged(snap, srv.managedNodeNames())

	want := map[string]bool{"pve1": true, "pve2": true, "pve3": false}
	for _, n := range snap.Nodes {
		if n.Managed != want[n.ID] {
			t.Errorf("node %s managed=%v, want %v", n.ID, n.Managed, want[n.ID])
		}
	}
}

func TestNormalizeAddr(t *testing.T) {
	cases := map[string]string{
		"192.168.1.5":             "192.168.1.5:7575",
		"192.168.1.5:8006":        "192.168.1.5:8006",
		"http://192.168.1.5:7575": "192.168.1.5:7575",
		"https://10.0.0.2/":       "10.0.0.2:7575",
		"10.0.0.2/agent/pair":     "", // path injection rejected
		"with space":              "",
		"":                        "",
	}
	for in, want := range cases {
		if got := normalizeAddr(in); got != want {
			t.Errorf("normalizeAddr(%q) = %q, want %q", in, got, want)
		}
	}
}
