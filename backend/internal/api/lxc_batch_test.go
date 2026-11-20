package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"reflect"
	"testing"

	"simpdash/internal/config"
	"simpdash/internal/proxmox"
)

func TestPlanLXCBatch(t *testing.T) {
	lxcs := []proxmox.Guest{
		{VMID: 103, Name: "jellyfin", Status: "running"},
		{VMID: 101, Name: "pihole", Status: "running"},
		{VMID: 102, Name: "stopped-ct", Status: "stopped"},
		{VMID: 100, Name: "nginx", Status: "running"},
	}

	queued, skipped := planLXCBatch(lxcs, nil, []int{101})

	wantQueued := []lxcBatchItem{
		{VMID: 100, Name: "nginx"},
		{VMID: 103, Name: "jellyfin"},
	}
	wantSkipped := []lxcBatchItem{
		{VMID: 101, Name: "pihole", Reason: "excluded"},
		{VMID: 102, Name: "stopped-ct", Reason: "stopped"},
	}

	if !reflect.DeepEqual(queued, wantQueued) {
		t.Fatalf("queued = %+v, want %+v", queued, wantQueued)
	}
	if !reflect.DeepEqual(skipped, wantSkipped) {
		t.Fatalf("skipped = %+v, want %+v", skipped, wantSkipped)
	}
}

func TestPlanLXCBatchExplicitVMIDs(t *testing.T) {
	lxcs := []proxmox.Guest{
		{VMID: 100, Name: "nginx", Status: "running"},
		{VMID: 101, Name: "pihole", Status: "running"},
		{VMID: 102, Name: "stopped-ct", Status: "stopped"},
	}

	queued, skipped := planLXCBatch(lxcs, []int{101, 102}, []int{101})

	if len(queued) != 1 || queued[0].VMID != 101 {
		t.Fatalf("explicit vmid should run even if in default exclude list: got %+v", queued)
	}
	if len(skipped) != 1 || skipped[0].VMID != 102 || skipped[0].Reason != "stopped" {
		t.Fatalf("stopped explicit vmid should be skipped: got %+v", skipped)
	}
}

func TestLXCExcludesRoundTrip(t *testing.T) {
	cfgPath := filepath.Join(t.TempDir(), "config.yaml")
	cfg := &config.Config{Mode: "main", ListenAddr: ":7575"}
	s := &Server{cfg: cfg, cfgPath: cfgPath}

	// PUT unsorted with duplicates
	req := httptest.NewRequest(http.MethodPut, "/api/guests/update-all/excludes", bytes.NewBufferString(`{"excluded":[105,101,105]}`))
	rec := httptest.NewRecorder()
	s.PutLXCUpdateExcludes(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("PUT status = %d, body = %s", rec.Code, rec.Body.String())
	}

	var putResp struct {
		Excluded []int `json:"excluded"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &putResp); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(putResp.Excluded, []int{101, 105}) {
		t.Fatalf("PUT excluded = %v, want [101 105]", putResp.Excluded)
	}

	// GET returns normalized list
	rec2 := httptest.NewRecorder()
	s.GetLXCUpdateExcludes(rec2, httptest.NewRequest(http.MethodGet, "/api/guests/update-all/excludes", nil))
	if rec2.Code != http.StatusOK {
		t.Fatalf("GET status = %d", rec2.Code)
	}
	var getResp struct {
		Excluded []int `json:"excluded"`
	}
	if err := json.Unmarshal(rec2.Body.Bytes(), &getResp); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(getResp.Excluded, []int{101, 105}) {
		t.Fatalf("GET excluded = %v, want [101 105]", getResp.Excluded)
	}

	// Reload from disk to verify persistence
	reloaded, err := config.Load(cfgPath)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(reloaded.LXCUpdateExclude, []int{101, 105}) {
		t.Fatalf("reloaded excludes = %v, want [101 105]", reloaded.LXCUpdateExclude)
	}

	// Reject non-positive VMIDs
	rec3 := httptest.NewRecorder()
	s.PutLXCUpdateExcludes(rec3, httptest.NewRequest(http.MethodPut, "/api/guests/update-all/excludes", bytes.NewBufferString(`{"excluded":[0]}`)))
	if rec3.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for vmid 0, got %d", rec3.Code)
	}
}
