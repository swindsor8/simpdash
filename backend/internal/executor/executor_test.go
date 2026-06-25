package executor

import (
	"encoding/json"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"simpdash/internal/store"
)

// drain reads a subscriber channel to completion, returning decoded frames.
func drain(ch chan string) []map[string]any {
	var frames []map[string]any
	for line := range ch {
		var m map[string]any
		if json.Unmarshal([]byte(line), &m) == nil {
			frames = append(frames, m)
		}
	}
	return frames
}

func newStore(t *testing.T) *store.DB {
	t.Helper()
	db, err := store.Open(filepath.Join(t.TempDir(), "jobs.json"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	return db
}

// Covers the three M3 guarantees in one pass: live streaming of stdout+stderr,
// the single-job lock (ErrBusy), and persistence readable after the run.
func TestStreamLockPersist(t *testing.T) {
	db := newStore(t)
	e := New()

	cmd := exec.Command("sh", "-c", "echo hello; echo oops 1>&2; sleep 0.4")
	id, err := e.Start("apt_upgrade", cmd, db)
	if err != nil {
		t.Fatalf("start: %v", err)
	}

	// Lock: a second job must be refused while the first runs.
	if _, err := e.Start("apt_upgrade", exec.Command("true"), db); err != ErrBusy {
		t.Fatalf("second Start: want ErrBusy, got %v", err)
	}

	// Stream: subscribe and collect frames until the channel closes.
	_, ch, active := e.Subscribe(id)
	if !active {
		t.Fatal("Subscribe: want active, got inactive")
	}
	frames := drain(ch)

	var sawStdout, sawStderr, sawDone bool
	for _, f := range frames {
		switch f["type"] {
		case "stdout":
			if f["line"] == "hello" {
				sawStdout = true
			}
		case "stderr":
			if f["line"] == "oops" {
				sawStderr = true
			}
		case "done":
			sawDone = true
			if f["exit_code"].(float64) != 0 {
				t.Errorf("done exit_code = %v, want 0", f["exit_code"])
			}
		}
	}
	if !sawStdout || !sawStderr || !sawDone {
		t.Fatalf("missing frames: stdout=%v stderr=%v done=%v", sawStdout, sawStderr, sawDone)
	}

	// Lock released after the run finishes.
	if e.Active() {
		t.Error("executor still Active after job finished")
	}

	// Persistence: GetJob reads the file fresh every call (no in-memory cache),
	// so a successful read here is the same path a post-reload request takes.
	job, err := db.GetJob(id)
	if err != nil || job == nil {
		t.Fatalf("GetJob: %v (job=%v)", err, job)
	}
	if job.Status != "succeeded" {
		t.Errorf("status = %q, want succeeded", job.Status)
	}
	if job.ExitCode == nil || *job.ExitCode != 0 {
		t.Errorf("exit_code = %v, want 0", job.ExitCode)
	}
	if !strings.Contains(job.Output, "hello") || !strings.Contains(job.Output, "oops") {
		t.Errorf("output missing streamed lines: %q", job.Output)
	}
}

// A non-zero exit must persist as failed with the real exit code.
func TestFailedJobPersists(t *testing.T) {
	db := newStore(t)
	e := New()

	id, err := e.Start("apt_upgrade", exec.Command("sh", "-c", "exit 3"), db)
	if err != nil {
		t.Fatalf("start: %v", err)
	}
	// Wait for completion via the subscription, falling back to a poll.
	if _, ch, active := e.Subscribe(id); active {
		drain(ch)
	} else {
		time.Sleep(200 * time.Millisecond)
	}

	job, err := db.GetJob(id)
	if err != nil || job == nil {
		t.Fatalf("GetJob: %v", err)
	}
	if job.Status != "failed" {
		t.Errorf("status = %q, want failed", job.Status)
	}
	if job.ExitCode == nil || *job.ExitCode != 3 {
		t.Errorf("exit_code = %v, want 3", job.ExitCode)
	}
}
