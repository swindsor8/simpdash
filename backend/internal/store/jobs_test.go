package store

import (
	"fmt"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestJobPruningAndTruncation(t *testing.T) {
	db, err := Open(filepath.Join(t.TempDir(), "jobs.json"))
	if err != nil {
		t.Fatal(err)
	}

	base := time.Now().UTC().Add(-time.Hour)
	// Insert more than maxStoredJobs finished jobs and ensure disk store stays capped.
	for i := 0; i < maxStoredJobs+15; i++ {
		id := fmt.Sprintf("job-%03d", i)
		ts := base.Add(time.Duration(i) * time.Second)
		if err := db.CreateJob(id, "apt_upgrade", ts); err != nil {
			t.Fatal(err)
		}
		if err := db.FinishJob(id, "succeeded", 0, ts.Add(time.Second), `{"type":"stdout","line":"ok"}`); err != nil {
			t.Fatal(err)
		}
	}

	list, err := db.ListJobs()
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != maxStoredJobs {
		t.Fatalf("len(list) = %d, want %d", len(list), maxStoredJobs)
	}
	// Oldest job (job-000) should have been pruned; newest should remain.
	if old, _ := db.GetJob("job-000"); old != nil {
		t.Error("expected job-000 to be pruned")
	}
	if newest, _ := db.GetJob(fmt.Sprintf("job-%03d", maxStoredJobs+14)); newest == nil {
		t.Error("expected newest job to remain")
	}

	// Oversized output gets truncated cleanly on a line boundary.
	bigID := "job-big"
	_ = db.CreateJob(bigID, "apt_upgrade", time.Now().UTC())
	line := `{"type":"stdout","line":"` + strings.Repeat("x", 1000) + `"}` + "\n"
	bigOut := strings.Repeat(line, (maxJobOutputBytes/len(line))+50)
	if err := db.FinishJob(bigID, "succeeded", 0, time.Now().UTC(), bigOut); err != nil {
		t.Fatal(err)
	}
	got, err := db.GetJob(bigID)
	if err != nil || got == nil {
		t.Fatalf("GetJob(bigID): %v", err)
	}
	if !strings.HasPrefix(got.Output, `{"type":"stderr","line":"[earlier output truncated]"}`) {
		t.Errorf("expected truncation header, got prefix %q", got.Output[:min(80, len(got.Output))])
	}
	if len(got.Output) > maxJobOutputBytes+200 {
		t.Errorf("truncated output too large: %d", len(got.Output))
	}
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
