package api

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/gorilla/websocket"

	"simpdash/internal/executor"
)

// PackageUpdate describes one upgradable apt package with version details.
type PackageUpdate struct {
	Name      string `json:"name"`
	Current   string `json:"current,omitempty"`
	Candidate string `json:"candidate,omitempty"`
	Security  bool   `json:"security,omitempty"`
}

// UpdatesCheck handles GET /api/updates/check.
// Refreshes the apt cache, then returns the list of upgradable packages plus
// version metadata and host reboot-required status.
// Non-interactive: if apt-get update fails (network blip, bad repo), we log
// it and still return whatever apt list --upgradable shows from the old cache.
func (s *Server) UpdatesCheck(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Minute)
	defer cancel()

	pkgs, details := runAptCheckDetailed(ctx)
	s.recordAptCheck(pkgs) // keep the cached badge count in sync with manual checks
	rebootReq, rebootPkgs := checkRebootRequired("")
	writeJSON(w, http.StatusOK, map[string]any{
		"count":           len(pkgs),
		"packages":        pkgs,
		"package_details": details,
		"reboot_required": rebootReq,
		"reboot_packages": rebootPkgs,
	})
}

// parseUpgradable extracts package names from `apt list --upgradable` output.
// Format: "curl/focal-updates 7.68.0-2 amd64 [upgradable from: 7.68.0-1]"
// We get the common case right and don't crash on unexpected lines.
func parseUpgradable(output string) []string {
	pkgs, _ := parseUpgradableDetailed(output)
	return pkgs
}

// parseUpgradableDetailed parses both flat package names and rich version info
// from `apt list --upgradable` output.
func parseUpgradableDetailed(output string) ([]string, []PackageUpdate) {
	pkgs := []string{}
	details := []PackageUpdate{}
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "Listing") || strings.HasPrefix(line, "WARNING") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) == 0 {
			continue
		}
		nameRepo := strings.SplitN(fields[0], "/", 2)
		name := nameRepo[0]
		if name == "" {
			continue
		}
		repo := ""
		if len(nameRepo) == 2 {
			repo = nameRepo[1]
		}
		cand := ""
		if len(fields) >= 2 {
			cand = fields[1]
		}
		cur := ""
		if idx := strings.Index(line, "[upgradable from:"); idx >= 0 {
			rest := strings.TrimSpace(line[idx+len("[upgradable from:"):])
			cur = strings.TrimSpace(strings.TrimSuffix(rest, "]"))
		}
		pkgs = append(pkgs, name)
		details = append(details, PackageUpdate{
			Name:      name,
			Current:   cur,
			Candidate: cand,
			Security:  strings.Contains(strings.ToLower(repo), "security"),
		})
	}
	return pkgs, details
}

// checkRebootRequired checks Debian/Proxmox's standard /var/run/reboot-required
// marker file (root may be overridden in tests).
func checkRebootRequired(root string) (bool, []string) {
	base := "/var/run"
	if root != "" {
		base = filepath.Join(root, "var", "run")
	}
	if _, err := os.Stat(filepath.Join(base, "reboot-required")); err != nil {
		return false, nil
	}
	pkgs := []string{}
	if raw, err := os.ReadFile(filepath.Join(base, "reboot-required.pkgs")); err == nil {
		seen := map[string]bool{}
		for _, line := range strings.Split(string(raw), "\n") {
			p := strings.TrimSpace(line)
			if p != "" && !seen[p] {
				seen[p] = true
				pkgs = append(pkgs, p)
			}
		}
	}
	return true, pkgs
}

// UpdatesApply handles POST /api/updates/apply.
// Starts an async apt-get upgrade (or dist-upgrade when requested) job;
// returns {"job_id": ...} immediately. Returns 409 if a job is already running.
func (s *Server) UpdatesApply(w http.ResponseWriter, r *http.Request) {
	var body struct {
		DistUpgrade bool `json:"dist_upgrade"`
	}
	if r.Body != nil {
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil && !errors.Is(err, io.EOF) {
			writeErr(w, http.StatusBadRequest, "invalid body")
			return
		}
	}

	subcmd := "upgrade"
	if body.DistUpgrade {
		subcmd = "dist-upgrade"
	}
	cmd := exec.Command("apt-get", subcmd, "-y")
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

// GuestUpdate handles POST /api/guests/:vmid/update — starts an async package
// upgrade *inside* a local LXC container via `pct exec`, returning {"job_id":...}
// so the client can stream the live log (same plumbing as the host updater).
// Containers only: VMs have no reliable host-driven exec. vmid is validated
// numeric and the upgrade script is a fixed string passed as a single argv
// element, so there's no shell-injection surface. 409 if another job is already running.
func (s *Server) GuestUpdate(w http.ResponseWriter, r *http.Request, vmid string) {
	if _, err := strconv.Atoi(vmid); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid vmid")
		return
	}
	// Set DEBIAN_FRONTEND inside the container — the host process env doesn't
	// cross the pct-exec boundary — so apt never blocks on an unattended prompt.
	cmd := exec.Command("pct", "exec", vmid, "--", "sh", "-c", lxcUpgradeScript)

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

// ActiveJob handles GET /api/jobs/active (and /agent/jobs/active).
// Returns {"active": false} when idle, or {"active": true, "job": {...}} while running.
func (s *Server) ActiveJob(w http.ResponseWriter, r *http.Request) {
	info := s.exec.ActiveInfo()
	if info == nil {
		writeJSON(w, http.StatusOK, map[string]any{"active": false})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"active": true, "job": info})
}

// CancelJob handles POST /api/jobs/:id/cancel (and /agent/jobs/:id/cancel).
func (s *Server) CancelJob(w http.ResponseWriter, r *http.Request, id string) {
	if !s.exec.Cancel(id) {
		writeErr(w, http.StatusNotFound, "job is not currently running")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
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
// If the job already finished: replays stored output from disk then closes —
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
		// Job finished (or never existed) — replay from persisted store.
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
