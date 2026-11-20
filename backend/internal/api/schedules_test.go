package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"simpdash/internal/catalog"
	"simpdash/internal/config"
	"simpdash/internal/executor"
	"simpdash/internal/proxmox"
	"simpdash/internal/store"
)

func newTestServerWithSchedules(t *testing.T) *Server {
	t.Helper()
	dir := t.TempDir()
	cfg := &config.Config{
		Mode:          "main",
		ListenAddr:    ":7575",
		SessionSecret: "testsecret",
		DBPath:        filepath.Join(dir, "jobs.json"),
	}
	db, err := store.Open(cfg.DBPath)
	if err != nil {
		t.Fatal(err)
	}
	notes, err := store.OpenNotes(filepath.Join(dir, "notes.json"))
	if err != nil {
		t.Fatal(err)
	}
	links, err := store.OpenServiceLinks(filepath.Join(dir, "links.json"))
	if err != nil {
		t.Fatal(err)
	}
	scheds, err := store.OpenSchedules(filepath.Join(dir, "schedules.json"))
	if err != nil {
		t.Fatal(err)
	}
	cat, err := catalog.Load()
	if err != nil {
		t.Fatal(err)
	}
	px := proxmox.NewClient()
	return NewServer(cfg, filepath.Join(dir, "config.yaml"), px, NewPoller(px, time.Second), executor.New(), db, notes, links, scheds, cat, "dev")
}

func TestSchedulesCRUDAndValidation(t *testing.T) {
	s := newTestServerWithSchedules(t)
	s.selfNode = "pve1"

	// 1. Create a weekly backup schedule
	createBody := `{
		"name": "Sunday Plex Backup",
		"enabled": true,
		"action": "backup",
		"target_type": "lxc",
		"node": "pve1",
		"vmid": 105,
		"guest_name": "plex",
		"options": {"storage": "local", "mode": "snapshot", "compress": "zstd"},
		"frequency": "weekly",
		"time_of_day": "03:30",
		"days_of_week": [0],
		"if_busy": "queue",
		"notify": "failure"
	}`
	rec := httptest.NewRecorder()
	s.handleSchedules(rec, httptest.NewRequest(http.MethodPost, "/api/schedules", bytes.NewBufferString(createBody)))
	if rec.Code != http.StatusCreated {
		t.Fatalf("POST /api/schedules status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var created store.Schedule
	if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	if created.ID != 1 || created.NextRunAt == nil || created.Action != "backup" || created.VMID != 105 {
		t.Fatalf("unexpected created schedule: %+v", created)
	}

	// 2. List schedules
	rec2 := httptest.NewRecorder()
	s.handleSchedules(rec2, httptest.NewRequest(http.MethodGet, "/api/schedules", nil))
	if rec2.Code != http.StatusOK {
		t.Fatalf("GET /api/schedules status = %d", rec2.Code)
	}
	var listResp struct {
		Schedules []store.Schedule `json:"schedules"`
		Timezone  string           `json:"timezone"`
	}
	if err := json.Unmarshal(rec2.Body.Bytes(), &listResp); err != nil {
		t.Fatal(err)
	}
	if len(listResp.Schedules) != 1 || listResp.Schedules[0].Name != "Sunday Plex Backup" {
		t.Fatalf("unexpected list response: %+v", listResp)
	}

	// 3. Partial update: disable schedule clears NextRunAt
	rec3 := httptest.NewRecorder()
	s.handleSchedulesPrefix(rec3, httptest.NewRequest(http.MethodPut, "/api/schedules/1", bytes.NewBufferString(`{"enabled":false}`)))
	if rec3.Code != http.StatusOK {
		t.Fatalf("PUT /api/schedules/1 status = %d, body = %s", rec3.Code, rec3.Body.String())
	}
	var updated store.Schedule
	if err := json.Unmarshal(rec3.Body.Bytes(), &updated); err != nil {
		t.Fatal(err)
	}
	if updated.Enabled || updated.NextRunAt != nil {
		t.Fatalf("disabled schedule should have enabled=false and nil NextRunAt: %+v", updated)
	}

	// 4. Reject invalid combinations (ct_update targeting qemu, past one-time, bad cron)
	badCases := []string{
		`{"name":"bad ct","action":"ct_update","target_type":"qemu","vmid":100,"frequency":"daily","time_of_day":"02:00"}`,
		`{"name":"past once","action":"host_update","target_type":"node","frequency":"once","run_at":"2020-01-01T00:00:00Z"}`,
		`{"name":"bad cron","action":"host_update","target_type":"node","frequency":"cron","cron_expr":"* *"}`,
		`{"name":"bad power","action":"power","target_type":"node","options":{"power_action":"start"},"frequency":"daily","time_of_day":"01:00"}`,
	}
	for _, body := range badCases {
		r := httptest.NewRecorder()
		s.handleSchedules(r, httptest.NewRequest(http.MethodPost, "/api/schedules", bytes.NewBufferString(body)))
		if r.Code != http.StatusBadRequest {
			t.Fatalf("expected 400 for %s, got %d (%s)", body, r.Code, r.Body.String())
		}
	}

	// 5. Preview endpoint returns next 3 runs
	prevRec := httptest.NewRecorder()
	s.SchedulesPreview(prevRec, httptest.NewRequest(http.MethodPost, "/api/schedules/preview",
		bytes.NewBufferString(`{"frequency":"daily","time_of_day":"04:15"}`)))
	if prevRec.Code != http.StatusOK {
		t.Fatalf("POST /api/schedules/preview status = %d, body = %s", prevRec.Code, prevRec.Body.String())
	}
	var prevResp struct {
		NextRuns []time.Time `json:"next_runs"`
	}
	if err := json.Unmarshal(prevRec.Body.Bytes(), &prevResp); err != nil {
		t.Fatal(err)
	}
	if len(prevResp.NextRuns) != 3 {
		t.Fatalf("expected 3 preview runs, got %d", len(prevResp.NextRuns))
	}

	// 6. Delete schedule
	delRec := httptest.NewRecorder()
	s.handleSchedulesPrefix(delRec, httptest.NewRequest(http.MethodDelete, "/api/schedules/1", nil))
	if delRec.Code != http.StatusOK {
		t.Fatalf("DELETE /api/schedules/1 status = %d", delRec.Code)
	}
}

func TestBuildSnapshotName(t *testing.T) {
	now := time.Date(2026, 11, 19, 20, 15, 0, 0, time.UTC)
	got := buildSnapshotName("pre update!!", now)
	if got != "pre-update-20261119-2015" {
		t.Fatalf("got %q", got)
	}
	got2 := buildSnapshotName("123bad", now)
	if got2 != "sd-123bad-20261119-2015" {
		t.Fatalf("got %q", got2)
	}
}
