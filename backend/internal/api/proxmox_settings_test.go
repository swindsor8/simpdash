package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"simpdash/internal/config"
	"simpdash/internal/proxmox"
)

func TestPutAndGetProxmoxSettings(t *testing.T) {
	cfgPath := filepath.Join(t.TempDir(), "config.yaml")
	cfg := &config.Config{Mode: "main", ListenAddr: ":7575"}
	px := proxmox.NewClient()
	s := &Server{cfg: cfg, cfgPath: cfgPath, px: px}

	// Reject malformed host
	rec := httptest.NewRecorder()
	s.PutProxmox(rec, httptest.NewRequest(http.MethodPut, "/api/settings/proxmox",
		bytes.NewBufferString(`{"host":"not-a-url","token_id":"simpdash@pve!tok","secret":"abc"}`)))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("bad host: status = %d, want 400", rec.Code)
	}

	// Reject malformed token ID (missing '!')
	rec = httptest.NewRecorder()
	s.PutProxmox(rec, httptest.NewRequest(http.MethodPut, "/api/settings/proxmox",
		bytes.NewBufferString(`{"host":"https://192.168.1.10:8006","token_id":"simpdash@pve","secret":"abc"}`)))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("bad token_id: status = %d, want 400", rec.Code)
	}

	// Valid save (trailing slash should be stripped)
	rec = httptest.NewRecorder()
	s.PutProxmox(rec, httptest.NewRequest(http.MethodPut, "/api/settings/proxmox",
		bytes.NewBufferString(`{"host":"https://192.168.1.10:8006/","token_id":"simpdash@pve!dashtoken","secret":"my-secret"}`)))
	if rec.Code != http.StatusOK {
		t.Fatalf("save: status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if !px.Configured() {
		t.Fatal("expected proxmox client to be configured after PutProxmox")
	}

	// GET settings masks secret and exposes has_secret=true
	rec = httptest.NewRecorder()
	s.GetSettings(rec, httptest.NewRequest(http.MethodGet, "/api/settings", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("GET settings: status = %d", rec.Code)
	}
	var got struct {
		Proxmox struct {
			Host      string `json:"host"`
			TokenID   string `json:"token_id"`
			HasSecret bool   `json:"has_secret"`
		} `json:"proxmox"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.Proxmox.Host != "https://192.168.1.10:8006" || got.Proxmox.TokenID != "simpdash@pve!dashtoken" || !got.Proxmox.HasSecret {
		t.Fatalf("unexpected settings.proxmox: %+v", got.Proxmox)
	}

	// Updating host with secret:null keeps stored secret
	rec = httptest.NewRecorder()
	s.PutProxmox(rec, httptest.NewRequest(http.MethodPut, "/api/settings/proxmox",
		bytes.NewBufferString(`{"host":"https://192.168.1.11:8006","token_id":"simpdash@pve!dashtoken","secret":null}`)))
	if rec.Code != http.StatusOK {
		t.Fatalf("update host keeping secret: status = %d, body = %s", rec.Code, rec.Body.String())
	}
	reloaded, err := config.Load(cfgPath)
	if err != nil {
		t.Fatal(err)
	}
	if reloaded.Proxmox == nil || reloaded.Proxmox.Secret != "my-secret" || reloaded.Proxmox.Host != "https://192.168.1.11:8006" {
		t.Fatalf("unexpected persisted proxmox config: %+v", reloaded.Proxmox)
	}
}

func TestProxmoxConnectionTestEndpoint(t *testing.T) {
	pve := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api2/json/cluster/resources" {
			http.NotFound(w, r)
			return
		}
		if r.Header.Get("Authorization") != "PVEAPIToken=simpdash@pve!tok=sec123" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.Write([]byte(`{"data":[{"type":"node","node":"pve1","status":"online"}]}`))
	}))
	defer pve.Close()

	s := &Server{cfg: &config.Config{Mode: "main"}, px: proxmox.NewClient()}
	payload, _ := json.Marshal(map[string]any{
		"host":     pve.URL,
		"token_id": "simpdash@pve!tok",
		"secret":   "sec123",
	})
	rec := httptest.NewRecorder()
	s.TestProxmox(rec, httptest.NewRequest(http.MethodPost, "/api/settings/proxmox/test", bytes.NewReader(payload)))
	if rec.Code != http.StatusOK {
		t.Fatalf("TestProxmox status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var resp struct {
		OK    bool `json:"ok"`
		Nodes int  `json:"nodes"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if !resp.OK || resp.Nodes != 1 {
		t.Fatalf("unexpected TestProxmox response: %+v", resp)
	}
}
