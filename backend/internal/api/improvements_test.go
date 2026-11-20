package api

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"golang.org/x/crypto/bcrypt"

	"simpdash/internal/config"
	"simpdash/internal/store"
)

func TestParseUpgradableDetailed(t *testing.T) {
	raw := `Listing...
curl/bookworm-security 7.88.1-10+deb12u8 amd64 [upgradable from: 7.88.1-10+deb12u7]
pve-manager/stable 8.2.4 amd64 [upgradable from: 8.2.2]
WARNING: apt does not have a stable CLI interface.
`
	pkgs, details := parseUpgradableDetailed(raw)
	if len(pkgs) != 2 || pkgs[0] != "curl" || pkgs[1] != "pve-manager" {
		t.Fatalf("pkgs = %v", pkgs)
	}
	if len(details) != 2 {
		t.Fatalf("details len = %d", len(details))
	}
	if !details[0].Security || details[0].Current != "7.88.1-10+deb12u7" || details[0].Candidate != "7.88.1-10+deb12u8" {
		t.Fatalf("unexpected curl detail: %+v", details[0])
	}
	if details[1].Security || details[1].Current != "8.2.2" {
		t.Fatalf("unexpected pve-manager detail: %+v", details[1])
	}
}

func TestCheckRebootRequired(t *testing.T) {
	root := t.TempDir()
	req, pkgs := checkRebootRequired(root)
	if req || len(pkgs) != 0 {
		t.Fatalf("want false when absent, got %v %v", req, pkgs)
	}
	runDir := filepath.Join(root, "var", "run")
	if err := os.MkdirAll(runDir, 0755); err != nil {
		t.Fatal(err)
	}
	_ = os.WriteFile(filepath.Join(runDir, "reboot-required"), []byte("*** System restart required ***\n"), 0644)
	_ = os.WriteFile(filepath.Join(runDir, "reboot-required.pkgs"), []byte("proxmox-kernel-6.8\nlibc6\nproxmox-kernel-6.8\n"), 0644)

	req, pkgs = checkRebootRequired(root)
	if !req || len(pkgs) != 2 || pkgs[0] != "proxmox-kernel-6.8" || pkgs[1] != "libc6" {
		t.Fatalf("got req=%v pkgs=%v", req, pkgs)
	}
}

func TestChangePassword(t *testing.T) {
	hash, _ := bcrypt.GenerateFromPassword([]byte("oldpassword1"), bcrypt.MinCost)
	srv := testServer(t, &config.Config{
		Mode:          "main",
		Onboarded:     true,
		PasswordHash:  string(hash),
		SessionSecret: "initial-secret",
	})

	// Wrong current password rejected
	rec := httptest.NewRecorder()
	srv.ChangePassword(rec, httptest.NewRequest(http.MethodPost, "/api/settings/password",
		bytes.NewBufferString(`{"current_password":"wrong","new_password":"newpassword2"}`)))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("wrong current pw: status=%d, want 401", rec.Code)
	}

	// Short new password rejected
	rec = httptest.NewRecorder()
	srv.ChangePassword(rec, httptest.NewRequest(http.MethodPost, "/api/settings/password",
		bytes.NewBufferString(`{"current_password":"oldpassword1","new_password":"short"}`)))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("short pw: status=%d, want 400", rec.Code)
	}

	// Valid change succeeds, rotates session secret, and issues fresh cookie
	rec = httptest.NewRecorder()
	srv.ChangePassword(rec, httptest.NewRequest(http.MethodPost, "/api/settings/password",
		bytes.NewBufferString(`{"current_password":"oldpassword1","new_password":"newpassword2"}`)))
	if rec.Code != http.StatusOK {
		t.Fatalf("valid change: status=%d body=%s", rec.Code, rec.Body.String())
	}
	if srv.cfg.SessionSecret == "initial-secret" {
		t.Error("expected session secret rotation on password change")
	}
	if len(rec.Result().Cookies()) == 0 {
		t.Error("expected fresh session cookie on response")
	}
	if bcrypt.CompareHashAndPassword([]byte(srv.cfg.PasswordHash), []byte("newpassword2")) != nil {
		t.Error("new password hash did not match")
	}
}

func TestPBSConnectionTestEndpoint(t *testing.T) {
	pbsSrv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "PBSAPIToken=dash@pbs!tok:secret123" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		switch r.URL.Path {
		case "/api2/json/status/datastore-usage":
			w.Write([]byte(`{"data":[{"store":"backups","total":1000,"used":250,"avail":750}]}`))
		case "/api2/json/admin/datastore/backups/snapshots":
			w.Write([]byte(`{"data":[{"backup-type":"vm","backup-id":"101","backup-time":1700000000,"verification":{"state":"ok"}}]}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer pbsSrv.Close()

	sum := sha256.Sum256(pbsSrv.Certificate().Raw)
	fp := hex.EncodeToString(sum[:])

	srv := testServer(t, &config.Config{Mode: "main"})
	payload, _ := json.Marshal(map[string]any{
		"url":         pbsSrv.URL,
		"token_id":    "dash@pbs!tok",
		"secret":      "secret123",
		"fingerprint": fp,
	})
	rec := httptest.NewRecorder()
	srv.TestPBS(rec, httptest.NewRequest(http.MethodPost, "/api/settings/pbs/test", bytes.NewReader(payload)))
	if rec.Code != http.StatusOK {
		t.Fatalf("TestPBS status=%d body=%s", rec.Code, rec.Body.String())
	}
	var out struct {
		OK         bool `json:"ok"`
		Datastores int  `json:"datastores"`
		Guests     int  `json:"guests"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if !out.OK || out.Datastores != 1 || out.Guests != 1 {
		t.Fatalf("unexpected TestPBS output: %+v", out)
	}
}

func TestConfigExportAndImport(t *testing.T) {
	srv := testServer(t, &config.Config{
		Mode:             "main",
		LXCUpdateExclude: []int{101, 202},
	})
	lbl := "Jellyfin"
	_ = srv.serviceLinks.Upsert("lxc:101", store.ServiceLink{URL: "http://192.168.1.50:8096", Label: &lbl})
	_, _ = srv.notes.CreateNote("Remember GPU passthrough", "lxc", "101", "teal")

	rec := httptest.NewRecorder()
	srv.ExportConfig(rec, httptest.NewRequest(http.MethodGet, "/api/settings/export", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("export status=%d", rec.Code)
	}
	exported := rec.Body.Bytes()
	if strings.Contains(string(exported), "session_secret") || strings.Contains(string(exported), "password_hash") {
		t.Fatal("export must not contain secrets")
	}

	// Import into a clean server in replace mode
	srv2 := testServer(t, &config.Config{Mode: "main"})
	var bundle map[string]any
	_ = json.Unmarshal(exported, &bundle)
	bundle["mode"] = "replace"
	impBody, _ := json.Marshal(bundle)

	rec2 := httptest.NewRecorder()
	srv2.ImportConfig(rec2, httptest.NewRequest(http.MethodPost, "/api/settings/import", bytes.NewReader(impBody)))
	if rec2.Code != http.StatusOK {
		t.Fatalf("import status=%d body=%s", rec2.Code, rec2.Body.String())
	}
	links, _ := srv2.serviceLinks.GetAll()
	if len(links) != 1 || links["lxc:101"].URL != "http://192.168.1.50:8096" {
		t.Fatalf("imported links = %+v", links)
	}
	notes, _ := srv2.notes.ListNotes("", "", "")
	if len(notes) != 1 || notes[0].Content != "Remember GPU passthrough" {
		t.Fatalf("imported notes = %+v", notes)
	}
	if len(srv2.cfg.LXCUpdateExclude) != 2 {
		t.Fatalf("imported excludes = %v", srv2.cfg.LXCUpdateExclude)
	}
}

// Verify secondary PTY relay forwards browser keystrokes upstream to the agent PTY.
func TestRelayForwardsPTYInput(t *testing.T) {
	agentSrv := testServer(t, &config.Config{Mode: "secondary"})
	amux := http.NewServeMux()
	agentSrv.AgentRoutes(amux)
	agent := httptest.NewServer(amux)
	defer agent.Close()
	agentAddr := strings.TrimPrefix(agent.URL, "http://")
	code := agentSrv.NewPairingCode()

	mainSrv := testServer(t, &config.Config{Mode: "main", SessionSecret: "sec", Onboarded: true})
	mmux := http.NewServeMux()
	mainSrv.Routes(mmux)
	main := httptest.NewServer(mmux)
	defer main.Close()
	cookie := &http.Cookie{Name: cookieName, Value: sessionToken("sec")}

	resp := postJSON(t, main.URL+"/api/nodes/pair", `{"address":"`+agentAddr+`","code":"`+code+`"}`, cookie)
	var node struct{ ID string }
	_ = json.NewDecoder(resp.Body).Decode(&node)
	resp.Body.Close()

	// PTY command on the agent waits for one line of input and echoes it back.
	jobID, err := agentSrv.exec.StartPTY("catalog_script",
		exec.Command("sh", "-c", `read line; echo "GOT:$line"`), agentSrv.db)
	if err != nil {
		t.Fatalf("StartPTY: %v", err)
	}

	wsURL := "ws" + strings.TrimPrefix(main.URL, "http") + "/api/nodes/" + node.ID + "/jobs/" + jobID + "/stream"
	conn, _, err := websocket.DefaultDialer.Dial(wsURL,
		http.Header{"Cookie": []string{cookieName + "=" + sessionToken("sec")}})
	if err != nil {
		t.Fatalf("dial relay: %v", err)
	}
	defer conn.Close()

	// Send input through main -> secondary PTY.
	time.Sleep(100 * time.Millisecond)
	if err := conn.WriteMessage(websocket.TextMessage, []byte("ping123\r")); err != nil {
		t.Fatalf("write input: %v", err)
	}

	conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	var sawEcho bool
	for {
		_, msg, err := conn.ReadMessage()
		if err != nil {
			break
		}
		if strings.Contains(string(msg), "GOT:ping123") {
			sawEcho = true
		}
	}
	if !sawEcho {
		t.Fatal("secondary PTY did not receive forwarded input from browser through main relay")
	}
}
