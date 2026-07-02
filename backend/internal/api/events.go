package api

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os/exec"
	"strings"
	"sync"
	"time"

	"simpdash/internal/proxmox"
)

// Event engine: background apt update checks, node-offline detection, and
// backup-failure sweeps — each optionally pushed through the notifier.
// Everything here is best-effort and must never take the dashboard down.

// pendingUpdates caches the last apt check so the UI can show a count without
// triggering apt, and the nav badge stays cheap.
type pendingUpdates struct {
	mu        sync.Mutex
	packages  []string
	checkedAt time.Time
	notified  time.Time // last "updates available" push, to avoid daily spam
}

// UpdatesPending handles GET /api/updates/pending — cached count only, never
// runs apt.
func (s *Server) UpdatesPending(w http.ResponseWriter, r *http.Request) {
	s.pending.mu.Lock()
	defer s.pending.mu.Unlock()
	var at int64
	if !s.pending.checkedAt.IsZero() {
		at = s.pending.checkedAt.Unix()
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"count":      len(s.pending.packages),
		"checked_at": at,
	})
}

// recordAptCheck updates the pending-updates cache (called by both the manual
// check endpoint and the background ticker).
func (s *Server) recordAptCheck(pkgs []string) {
	s.pending.mu.Lock()
	s.pending.packages = pkgs
	s.pending.checkedAt = time.Now()
	notify := len(pkgs) > 0 && time.Since(s.pending.notified) > 23*time.Hour
	if notify {
		s.pending.notified = time.Now()
	}
	s.pending.mu.Unlock()

	if notify && s.notifyEnabled(func(n notifyEvents) bool { return n.updates }) {
		s.notifyBG("Updates available",
			fmt.Sprintf("%d apt package(s) can be upgraded on %s.", len(pkgs), s.selfNode))
	}
}

// runAptCheck refreshes the apt cache and returns upgradable packages.
func runAptCheck(ctx context.Context) []string {
	if out, err := exec.CommandContext(ctx, "apt-get", "update", "-q").CombinedOutput(); err != nil {
		log.Printf("apt-get update: %v: %s", err, strings.TrimSpace(string(out)))
	}
	out, err := exec.CommandContext(ctx, "apt", "list", "--upgradable").Output()
	if err != nil {
		return []string{}
	}
	return parseUpgradable(string(out))
}

// RunBackground starts the periodic workers: apt auto-check + backup-failure
// sweep every 12h (first pass shortly after boot), and node-offline watching
// via poller snapshots. Main mode only.
func (s *Server) RunBackground(ctx context.Context) {
	go s.health.run(ctx)
	go s.watchNodes(ctx)
	go func() {
		select {
		case <-ctx.Done():
			return
		case <-time.After(2 * time.Minute): // let the box settle after boot
		}
		s.periodicSweep(ctx)
		t := time.NewTicker(12 * time.Hour)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				s.periodicSweep(ctx)
			}
		}
	}()
}

func (s *Server) periodicSweep(ctx context.Context) {
	cctx, cancel := context.WithTimeout(ctx, 3*time.Minute)
	s.recordAptCheck(runAptCheck(cctx))
	cancel()
	s.sweepBackupFailures()
}

// sweepBackupFailures notifies once per newly-seen failed vzdump job.
func (s *Server) sweepBackupFailures() {
	if !s.notifyEnabled(func(n notifyEvents) bool { return n.backup }) {
		return
	}
	rep, err := s.backups.get(s.px)
	if err != nil {
		return
	}
	s.notifyState.mu.Lock()
	last := s.notifyState.lastBackupSweep
	s.notifyState.lastBackupSweep = time.Now().Unix()
	s.notifyState.mu.Unlock()
	if last == 0 {
		return // first sweep after boot: set the watermark, don't replay history
	}
	for _, j := range rep.Jobs {
		if j.Status != "OK" && j.Status != "" && j.StartTime > last {
			s.notifyBG("Backup failed",
				fmt.Sprintf("vzdump on %s failed: %s", j.Node, truncate(j.Status, 200)))
		}
	}
}

// watchNodes subscribes to poller snapshots and reports node status flips.
// Three consecutive offline frames (~9 s) are required before alerting, so a
// single missed poll doesn't page anyone; recovery notifies immediately.
func (s *Server) watchNodes(ctx context.Context) {
	ch := s.poller.subscribe()
	defer s.poller.unsubscribe(ch)
	offlineTicks := map[string]int{}
	alerted := map[string]bool{}
	for {
		var raw []byte
		select {
		case <-ctx.Done():
			return
		case raw = <-ch:
		}
		var snap proxmox.Snapshot
		if json.Unmarshal(raw, &snap) != nil || len(snap.Nodes) == 0 {
			continue
		}
		if !s.notifyEnabled(func(n notifyEvents) bool { return n.node }) {
			continue
		}
		for _, n := range snap.Nodes {
			if n.Status == "online" {
				offlineTicks[n.ID] = 0
				if alerted[n.ID] {
					alerted[n.ID] = false
					s.notifyBG("Node back online", fmt.Sprintf("Proxmox node %s is reachable again.", n.ID))
				}
				continue
			}
			offlineTicks[n.ID]++
			if offlineTicks[n.ID] == 3 && !alerted[n.ID] {
				alerted[n.ID] = true
				s.notifyBG("Node offline", fmt.Sprintf("Proxmox node %s stopped responding.", n.ID))
			}
		}
	}
}

// JobFinished is the executor's completion hook (wired in main.go).
func (s *Server) JobFinished(jobType, status string, exitCode int) {
	if status == "succeeded" {
		return
	}
	if !s.notifyEnabled(func(n notifyEvents) bool { return n.job }) {
		return
	}
	s.notifyBG("Job failed", fmt.Sprintf("%s on %s exited with code %d.", jobType, s.selfNode, exitCode))
}

// --- notification plumbing ---

type notifyEvents struct{ job, node, updates, backup bool }

type notifyState struct {
	mu              sync.Mutex
	lastBackupSweep int64
}

func (s *Server) notifyEnabled(pick func(notifyEvents) bool) bool {
	s.cfgMu.Lock()
	defer s.cfgMu.Unlock()
	n := s.cfg.Notify
	if n == nil || n.URL == "" {
		return false
	}
	return pick(notifyEvents{job: n.JobFailed, node: n.NodeOffline, updates: n.UpdatesAvailable, backup: n.BackupFailed})
}

// notifyBG sends without blocking the caller; failures are logged, never fatal.
func (s *Server) notifyBG(title, message string) {
	go func() {
		if err := s.notifier.Send(title, message); err != nil {
			log.Printf("notify %q: %v", title, err)
		}
	}()
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
