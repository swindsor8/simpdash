package api

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"time"

	"github.com/gorilla/websocket"

	"simpdash/internal/executor"
)

// UpdatesCheck handles GET /api/updates/check.
// Refreshes the apt cache, then returns the list of upgradable packages.
// Non-interactive: if apt-get update fails (network blip, bad repo), we log
// it and still return whatever apt list --upgradable shows from the old cache.
func (s *Server) UpdatesCheck(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Minute)
	defer cancel()

	if out, err := exec.CommandContext(ctx, "apt-get", "update", "-q").CombinedOutput(); err != nil {
		log.Printf("apt-get update: %v: %s", err, strings.TrimSpace(string(out)))
	}

	out, err := exec.CommandContext(ctx, "apt", "list", "--upgradable").Output()
	if err != nil {
		// apt not present (dev machine) or hard failure — return empty, don't 500.
		writeJSON(w, http.StatusOK, map[string]any{"count": 0, "packages": []string{}})
		return
	}
	pkgs := parseUpgradable(string(out))
	writeJSON(w, http.StatusOK, map[string]any{"count": len(pkgs), "packages": pkgs})
}

// parseUpgradable extracts package names from `apt list --upgradable` output.
// Format: "curl/focal-updates 7.68.0-2 amd64 [upgradable from: 7.68.0-1]"
// We get the common case right and don't crash on unexpected lines.
func parseUpgradable(output string) []string {
	var pkgs []string
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "Listing") || strings.HasPrefix(line, "WARNING") {
			continue
		}
		name := strings.SplitN(line, "/", 2)[0]
		if name != "" {
			pkgs = append(pkgs, name)
		}
	}
	if pkgs == nil {
		pkgs = []string{}
	}
	return pkgs
}

// UpdatesApply handles POST /api/updates/apply.
// Starts an async apt-get upgrade job; returns {"job_id": ...} immediately.
// Returns 409 if a job is already running.
func (s *Server) UpdatesApply(w http.ResponseWriter, r *http.Request) {
	cmd := exec.Command("apt-get", "upgrade", "-y")
	// DEBIAN_FRONTEND=noninteractive prevents apt from hanging on a prompt
	// that nobody is watching; TERM keeps tput/whiptail-based hooks from aborting.
	cmd.Env = append(os.Environ(), "DEBIAN_FRONTEND=noninteractive", "TERM=xterm")

	id, err := s.exec.Start("apt_upgrade", cmd, s.db)
	if errors.Is(err, executor.ErrBusy) {
		writeErr(w, http.StatusConflict, "a job is already running")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"job_id": id})
}

// GuestUpdate handles POST /api/guests/:vmid/update — starts an async apt
// upgrade *inside* a local LXC container via `pct exec`, returning {"job_id":...}
// so the client can stream the live log (same plumbing as the host updater).
// Containers only: VMs have no reliable host-driven exec. vmid is validated
// numeric and the apt script is a fixed string passed as a single argv element,
// so there's no shell-injection surface. 409 if another job is already running.
func (s *Server) GuestUpdate(w http.ResponseWriter, r *http.Request, vmid string) {
	if _, err := strconv.Atoi(vmid); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid vmid")
		return
	}
	// Set DEBIAN_FRONTEND inside the container — the host process env doesn't
	// cross the pct-exec boundary — so apt never blocks on an unattended prompt.
	const script = "DEBIAN_FRONTEND=noninteractive apt-get update && DEBIAN_FRONTEND=noninteractive apt-get -y upgrade"
	cmd := exec.Command("pct", "exec", vmid, "--", "sh", "-c", script)

	id, err := s.exec.Start("ct_upgrade", cmd, s.db)
	if errors.Is(err, executor.ErrBusy) {
		writeErr(w, http.StatusConflict, "a job is already running")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"job_id": id})
}

// Jobs handles GET /api/jobs.
func (s *Server) Jobs(w http.ResponseWriter, r *http.Request) {
	jobs, err := s.db.ListJobs()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, jobs)
}

// Job handles GET /api/jobs/:id.
func (s *Server) Job(w http.ResponseWriter, r *http.Request, id string) {
	job, err := s.db.GetJob(id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if job == nil {
		writeErr(w, http.StatusNotFound, "job not found")
		return
	}
	writeJSON(w, http.StatusOK, job)
}

// JobStream handles WS /api/jobs/:id/stream.
//
// If the job is still running: sends accumulated output so far, then streams
// live lines until the job ends and the channel closes.
//
// If the job already finished: replays stored output from SQLite then closes —
// the client is never left hanging on a dead stream.
func (s *Server) JobStream(w http.ResponseWriter, r *http.Request, id string) {
	if !s.validSession(r) {
		writeErr(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	s.streamJob(w, r, id)
}

// streamJob is the auth-free body of the job stream, shared by the session-gated
// /api/jobs/:id/stream (above) and the bearer-gated /agent/jobs/:id/stream.
func (s *Server) streamJob(w http.ResponseWriter, r *http.Request, id string) {
	history, ch, active := s.exec.Subscribe(id)
	if !active {
		// Job finished (or never existed) — replay from SQLite.
		job, err := s.db.GetJob(id)
		if err != nil || job == nil {
			writeErr(w, http.StatusNotFound, "job not found")
			return
		}
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		for _, line := range strings.Split(job.Output, "\n") {
			if line == "" {
				continue
			}
			if err := conn.WriteMessage(websocket.TextMessage, []byte(line)); err != nil {
				return
			}
		}
		return
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	// Replay history to this late-joiner before subscribing to future lines.
	for _, line := range history {
		if err := conn.WriteMessage(websocket.TextMessage, []byte(line)); err != nil {
			return
		}
	}

	// Read client messages: forward them as keystrokes to the job's PTY (no-op
	// for non-interactive jobs), and detect disconnect without blocking sends.
	gone := make(chan struct{})
	go func() {
		defer close(gone)
		for {
			_, data, err := conn.ReadMessage()
			if err != nil {
				return
			}
			s.exec.Input(id, data)
		}
	}()

	for {
		select {
		case <-gone:
			return
		case line, ok := <-ch:
			if !ok {
				return // channel closed = job done, client already received "done" line
			}
			if err := conn.WriteMessage(websocket.TextMessage, []byte(line)); err != nil {
				return
			}
		}
	}
}
