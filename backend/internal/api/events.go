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

// Event engine: background apt update checks, node-offline & storage-threshold
// detection, service-down transitions, backup-failure & stale-backup sweeps,
// and PBS verification checks — each optionally pushed through the notifier.
// Everything here is best-effort and must never take the dashboard down.

// pendingUpdates caches the last apt check so the UI can show a count without
// triggering apt, and the nav badge stays cheap.
type pendingUpdates struct {
	mu        sync.Mutex
	packages  []string
	checkedAt time.Time
	notified  time.Time // last "updates available" push, to avoid daily spam
}

// UpdatesPending handles GET /api/updates/pending — cached count + live
// reboot-required marker, never runs apt.
func (s *Server) UpdatesPending(w http.ResponseWriter, r *http.Request) {
	s.pending.mu.Lock()
	var at int64
	if !s.pending.checkedAt.IsZero() {
		at = s.pending.checkedAt.Unix()
	}
	count := len(s.pending.packages)
	s.pending.mu.Unlock()

	rebootReq, rebootPkgs := checkRebootRequired("")
	writeJSON(w, http.StatusOK, map[string]any{
		"count":           count,
		"checked_at":      at,
		"reboot_required": rebootReq,
		"reboot_packages": rebootPkgs,
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

// runAptCheck refreshes the apt cache and returns upgradable package names.
func runAptCheck(ctx context.Context) []string {
	pkgs, _ := runAptCheckDetailed(ctx)
	return pkgs
}

// runAptCheckDetailed refreshes the apt cache and returns both package names
// and parsed version details.
func runAptCheckDetailed(ctx context.Context) ([]string, []PackageUpdate) {
	if out, err := exec.CommandContext(ctx, "apt-get", "update", "-q").CombinedOutput(); err != nil {
		log.Printf("apt-get update: %v: %s", err, strings.TrimSpace(string(out)))
	}
	out, err := exec.CommandContext(ctx, "apt", "list", "--upgradable").Output()
	if err != nil {
		return []string{}, []PackageUpdate{}
	}
	return parseUpgradableDetailed(string(out))
}

// RunBackground starts the periodic workers: apt auto-check, backup-failure,
// stale-backup & PBS-verify sweeps every 12h (first pass shortly after boot),
// service health probing, scheduler, and node/storage watching. Main mode only.
func (s *Server) RunBackground(ctx context.Context) {
	go s.health.run(ctx)
	go s.watchNodes(ctx)
	if s.scheduler != nil {
		go s.scheduler.Run(ctx)
	}
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
	s.sweepStaleBackups()
	s.sweepPBSVerify()
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

// sweepStaleBackups alerts at most once per day when guests have no backup or
// a backup older than BackupStaleDays.
func (s *Server) sweepStaleBackups() {
	enabled, ev := s.notifyConfigSnapshot()
	if !enabled || ev.backupStaleDays <= 0 {
		return
	}
	s.notifyState.mu.Lock()
	tooSoon := time.Since(s.notifyState.lastStaleAlert) < 23*time.Hour
	s.notifyState.mu.Unlock()
	if tooSoon {
		return
	}

	rep, err := s.backups.get(s.px)
	if err != nil {
		return
	}
	cutoff := time.Now().Add(-time.Duration(ev.backupStaleDays) * 24 * time.Hour).Unix()
	var stale []string
	for _, g := range rep.Guests {
		if g.LastBackup == 0 || g.LastBackup < cutoff {
			label := g.Name
			if label == "" {
				label = fmt.Sprintf("%s %d", g.Type, g.VMID)
			}
			if g.LastBackup == 0 {
				stale = append(stale, label+" (never)")
			} else {
				stale = append(stale, label)
			}
		}
	}
	if len(stale) == 0 {
		return
	}
	s.notifyState.mu.Lock()
	s.notifyState.lastStaleAlert = time.Now()
	s.notifyState.mu.Unlock()

	shown := stale
	extra := ""
	if len(shown) > 6 {
		extra = fmt.Sprintf(" (+%d more)", len(shown)-6)
		shown = shown[:6]
	}
	s.notifyBG("Stale or missing backups",
		fmt.Sprintf("%d guest(s) have no backup within %d days: %s%s.",
			len(stale), ev.backupStaleDays, strings.Join(shown, ", "), extra))
}

// sweepPBSVerify alerts at most once per day when PBS reports failed verifications.
func (s *Server) sweepPBSVerify() {
	enabled, ev := s.notifyConfigSnapshot()
	if !enabled || !ev.pbsVerify || !s.pbs.Configured() {
		return
	}
	s.notifyState.mu.Lock()
	tooSoon := time.Since(s.notifyState.lastPBSVerifyAlert) < 23*time.Hour
	s.notifyState.mu.Unlock()
	if tooSoon {
		return
	}

	st, err := s.pbs.FetchStatus()
	if err != nil {
		return
	}
	var failed []string
	for _, g := range st.Guests {
		if g.Verified == "failed" {
			prefix := "CT"
			if g.Type == "vm" {
				prefix = "VM"
			}
			failed = append(failed, fmt.Sprintf("%s%s (%s)", prefix, g.ID, g.Store))
		}
	}
	if len(failed) == 0 {
		return
	}
	s.notifyState.mu.Lock()
	s.notifyState.lastPBSVerifyAlert = time.Now()
	s.notifyState.mu.Unlock()

	s.notifyBG("PBS verification failed",
		fmt.Sprintf("%d guest backup(s) failed PBS verification: %s.", len(failed), truncate(strings.Join(failed, ", "), 220)))
}

// serviceHealthChanged is the callback wired from healthChecker when a tracked
// service transitions to down (after 3 consecutive failures) or recovers.
func (s *Server) serviceHealthChanged(key, label, url string, up bool, status int) {
	if !s.notifyEnabled(func(n notifyEvents) bool { return n.serviceDown }) {
		return
	}
	if up {
		s.notifyBG("Service recovered", fmt.Sprintf("%s (%s) is reachable again (HTTP %d).", label, url, status))
		return
	}
	detail := "unreachable"
	if status > 0 {
		detail = fmt.Sprintf("HTTP %d", status)
	}
	s.notifyBG("Service down", fmt.Sprintf("%s (%s) failed health checks (%s).", label, url, detail))
}

// watchNodes subscribes to poller snapshots and reports node status flips and
// storage pool fill-level thresholds. Three consecutive failing frames (~9 s)
// are required before alerting; storage alerts use 5% hysteresis to avoid flap.
func (s *Server) watchNodes(ctx context.Context) {
	ch := s.poller.subscribe()
	defer s.poller.unsubscribe(ch)
	offlineTicks := map[string]int{}
	alerted := map[string]bool{}
	storageTicks := map[string]int{}
	storageAlerted := map[string]bool{}

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
		enabled, ev := s.notifyConfigSnapshot()
		if !enabled {
			continue
		}
		for _, n := range snap.Nodes {
			if ev.node {
				if n.Status == "online" {
					offlineTicks[n.ID] = 0
					if alerted[n.ID] {
						alerted[n.ID] = false
						s.notifyBG("Node back online", fmt.Sprintf("Proxmox node %s is reachable again.", n.ID))
					}
				} else {
					offlineTicks[n.ID]++
					if offlineTicks[n.ID] == 3 && !alerted[n.ID] {
						alerted[n.ID] = true
						s.notifyBG("Node offline", fmt.Sprintf("Proxmox node %s stopped responding.", n.ID))
					}
				}
			}

			if ev.storageThreshold > 0 && n.Status == "online" {
				thresh := float64(ev.storageThreshold)
				for _, pool := range n.Storage {
					if pool.Status != "available" || pool.MaxDisk <= 0 {
						continue
					}
					key := n.ID + ":" + pool.ID
					pct := (float64(pool.Disk) / float64(pool.MaxDisk)) * 100
					if pct >= thresh {
						storageTicks[key]++
						if storageTicks[key] >= 3 && !storageAlerted[key] {
							storageAlerted[key] = true
							s.notifyBG("Storage pool high usage",
								fmt.Sprintf("Storage %q on %s is %.0f%% full (threshold %d%%).", pool.ID, n.ID, pct, ev.storageThreshold))
						}
					} else {
						storageTicks[key] = 0
						if storageAlerted[key] && pct < thresh-5 {
							storageAlerted[key] = false
							s.notifyBG("Storage pool recovered",
								fmt.Sprintf("Storage %q on %s dropped to %.0f%% usage.", pool.ID, n.ID, pct))
						}
					}
				}
			}
		}
	}
}

// JobFinished is the executor's completion hook (wired in NewServer).
func (s *Server) JobFinished(jobType, status string, exitCode int) {
	// Scheduled tasks emit their own notifications with per-schedule policies.
	if strings.HasPrefix(jobType, "sched_") {
		return
	}
	if status == "succeeded" || status == "cancelled" {
		return
	}
	if !s.notifyEnabled(func(n notifyEvents) bool { return n.job }) {
		return
	}
	s.notifyBG("Job failed", fmt.Sprintf("%s on %s exited with code %d.", jobType, s.selfNode, exitCode))
}

// --- notification plumbing ---

type notifyEvents struct {
	job              bool
	node             bool
	updates          bool
	backup           bool
	serviceDown      bool
	pbsVerify        bool
	storageThreshold int
	backupStaleDays  int
}

type notifyState struct {
	mu                 sync.Mutex
	lastBackupSweep    int64
	lastStaleAlert     time.Time
	lastPBSVerifyAlert time.Time
}

func (s *Server) notifyConfigSnapshot() (bool, notifyEvents) {
	s.cfgMu.Lock()
	defer s.cfgMu.Unlock()
	n := s.cfg.Notify
	if n == nil || n.URL == "" {
		return false, notifyEvents{}
	}
	return true, notifyEvents{
		job:              n.JobFailed,
		node:             n.NodeOffline,
		updates:          n.UpdatesAvailable,
		backup:           n.BackupFailed,
		serviceDown:      n.ServiceDown,
		pbsVerify:        n.PBSVerifyFailed,
		storageThreshold: n.StorageThreshold,
		backupStaleDays:  n.BackupStaleDays,
	}
}

func (s *Server) notifyEnabled(pick func(notifyEvents) bool) bool {
	enabled, ev := s.notifyConfigSnapshot()
	if !enabled {
		return false
	}
	return pick(ev)
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
