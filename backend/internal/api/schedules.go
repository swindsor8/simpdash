package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"simpdash/internal/config"
	"simpdash/internal/executor"
	"simpdash/internal/proxmox"
	"simpdash/internal/store"
)

var (
	validScheduleAction = map[string]bool{
		"host_update":      true,
		"ct_update":        true,
		"lxc_batch_update": true,
		"backup":           true,
		"snapshot":         true,
		"power":            true,
		"speedtest":        true,
	}
	validTargetType = map[string]bool{
		"node":       true,
		"lxc":        true,
		"qemu":       true,
		"all_lxc":    true,
		"all_guests": true,
	}
	validBackupMode = map[string]bool{
		"":         true,
		"snapshot": true,
		"suspend":  true,
		"stop":     true,
	}
	validBackupCompress = map[string]bool{
		"":     true,
		"zstd": true,
		"gzip": true,
		"lzo":  true,
		"0":    true,
	}
	validGuestPower = map[string]bool{
		"start":    true,
		"shutdown": true,
		"stop":     true,
		"reboot":   true,
	}
	validNodePower = map[string]bool{
		"reboot":   true,
		"shutdown": true,
		"wake":     true,
	}
	validIfBusy = map[string]bool{"": true, "queue": true, "skip": true}
	validNotify = map[string]bool{"": true, "failure": true, "always": true, "never": true}

	storageNameRe = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$`)
	snapPrefixRe  = regexp.MustCompile(`[^a-zA-Z0-9_-]+`)
)

// Scheduler checks due schedules on a 15-second tick and drains a FIFO queue
// through the server's single-slot Executor so overlapping schedules never
// collide with ErrBusy.
type Scheduler struct {
	srv *Server
	loc *time.Location

	mu      sync.Mutex
	queue   []queuedScheduleRun
	queued  map[int64]bool
	running map[int64]bool
	wakeCh  chan struct{}
}

type queuedScheduleRun struct {
	scheduleID int64
	manual     bool
}

func newScheduler(srv *Server) *Scheduler {
	return &Scheduler{
		srv:     srv,
		loc:     time.Local,
		queued:  map[int64]bool{},
		running: map[int64]bool{},
		wakeCh:  make(chan struct{}, 1),
	}
}

// Run starts the tick loop and queue worker. Blocks until ctx is cancelled.
func (sc *Scheduler) Run(ctx context.Context) {
	if sc.srv.schedules == nil {
		return
	}
	sc.reconcileOnStart()
	go sc.workerLoop(ctx)

	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			sc.tick(time.Now())
		}
	}
}

// reconcileOnStart handles schedules whose NextRunAt fell in the past while
// SimpDash was offline. Safe default: skip missed runs rather than firing a
// surprise storm of updates/reboots on boot.
func (sc *Scheduler) reconcileOnStart() {
	list, err := sc.srv.schedules.List()
	if err != nil {
		log.Printf("scheduler: list on startup: %v", err)
		return
	}
	now := time.Now()
	for _, s := range list {
		if !s.Enabled {
			continue
		}
		// Recover any stale queued/running statuses left over from a crash/restart.
		staleActive := s.LastStatus == "running" || s.LastStatus == "queued"
		if s.NextRunAt != nil && !s.NextRunAt.After(now) {
			missedBy := now.Sub(*s.NextRunAt)
			if s.Frequency == "once" {
				if missedBy > 5*time.Minute {
					_, _ = sc.srv.schedules.Update(s.ID, func(cur *store.Schedule) {
						cur.Enabled = false
						cur.NextRunAt = nil
						cur.LastStatus = "missed"
						cur.LastError = "scheduled time passed while dashboard was offline"
					})
				}
				continue
			}
			next, err := store.ComputeNextRun(s, now, sc.loc)
			if err != nil {
				continue
			}
			_, _ = sc.srv.schedules.Update(s.ID, func(cur *store.Schedule) {
				cur.NextRunAt = next
				if missedBy > 2*time.Minute {
					cur.LastStatus = "missed"
					cur.LastError = "missed window while dashboard was offline"
				} else if staleActive {
					cur.LastStatus = "failed"
					cur.LastError = "interrupted by dashboard restart"
				}
			})
		} else if s.NextRunAt == nil && s.Frequency != "once" {
			next, err := store.ComputeNextRun(s, now, sc.loc)
			if err == nil {
				_, _ = sc.srv.schedules.Update(s.ID, func(cur *store.Schedule) {
					cur.NextRunAt = next
					if staleActive {
						cur.LastStatus = "failed"
						cur.LastError = "interrupted by dashboard restart"
					}
				})
			}
		} else if staleActive {
			_, _ = sc.srv.schedules.Update(s.ID, func(cur *store.Schedule) {
				cur.LastStatus = "failed"
				cur.LastError = "interrupted by dashboard restart"
			})
		}
	}
}

// tick scans enabled schedules and enqueues any whose NextRunAt <= now.
func (sc *Scheduler) tick(now time.Time) {
	list, err := sc.srv.schedules.List()
	if err != nil {
		log.Printf("scheduler: tick list: %v", err)
		return
	}
	for _, s := range list {
		if !s.Enabled || s.NextRunAt == nil || s.NextRunAt.After(now) {
			continue
		}
		// Advance NextRunAt (or disable one-time schedule) BEFORE running so
		// it can never double-fire on the next tick.
		var next *time.Time
		disableAfter := s.Frequency == "once"
		if !disableAfter {
			var err error
			next, err = store.ComputeNextRun(s, now, sc.loc)
			if err != nil {
				log.Printf("scheduler: compute next run for #%d: %v", s.ID, err)
			}
		}

		// Honour if_busy == "skip" when the executor is busy or queue is non-empty.
		if s.IfBusy == "skip" && (sc.srv.exec.Active() || sc.queueLen() > 0) {
			t := now.UTC()
			_, _ = sc.srv.schedules.Update(s.ID, func(cur *store.Schedule) {
				cur.NextRunAt = next
				if disableAfter {
					cur.Enabled = false
				}
				cur.LastRunAt = &t
				cur.LastStatus = "skipped"
				cur.LastError = "skipped: another job was already running"
			})
			continue
		}

		_, _ = sc.srv.schedules.Update(s.ID, func(cur *store.Schedule) {
			cur.NextRunAt = next
			if disableAfter {
				cur.Enabled = false
			}
			cur.LastStatus = "queued"
			cur.LastError = ""
		})
		sc.enqueue(s.ID, false)
	}
}

func (sc *Scheduler) enqueue(id int64, manual bool) bool {
	sc.mu.Lock()
	if sc.queued[id] || sc.running[id] {
		sc.mu.Unlock()
		return false
	}
	sc.queued[id] = true
	sc.queue = append(sc.queue, queuedScheduleRun{scheduleID: id, manual: manual})
	sc.mu.Unlock()

	select {
	case sc.wakeCh <- struct{}{}:
	default:
	}
	return true
}

func (sc *Scheduler) queueLen() int {
	sc.mu.Lock()
	defer sc.mu.Unlock()
	return len(sc.queue)
}

func (sc *Scheduler) workerLoop(ctx context.Context) {
	for {
		sc.mu.Lock()
		if len(sc.queue) == 0 {
			sc.mu.Unlock()
			select {
			case <-ctx.Done():
				return
			case <-sc.wakeCh:
				continue
			}
		}
		item := sc.queue[0]
		sc.queue = sc.queue[1:]
		delete(sc.queued, item.scheduleID)
		sc.running[item.scheduleID] = true
		sc.mu.Unlock()

		sc.executeQueued(ctx, item)

		sc.mu.Lock()
		delete(sc.running, item.scheduleID)
		sc.mu.Unlock()
	}
}

func (sc *Scheduler) executeQueued(ctx context.Context, item queuedScheduleRun) {
	sched, err := sc.srv.schedules.Get(item.scheduleID)
	if err != nil || sched == nil {
		return
	}

	// Wait for the Executor's single-job slot to free up.
	for sc.srv.exec.Active() {
		select {
		case <-ctx.Done():
			return
		case <-time.After(2 * time.Second):
		}
	}

	started := time.Now().UTC()
	doneCh := make(chan int, 1)
	var errMu sync.Mutex
	var runErr string
	setErr := func(msg string) {
		errMu.Lock()
		runErr = msg
		errMu.Unlock()
	}

	jobType := "sched_" + sched.Action
	var jobID string
	for {
		jobID, err = sc.srv.exec.StartFunc(jobType, func(em *executor.Emitter) int {
			code, msg := sc.srv.runScheduledTask(ctx, sched, em)
			if msg != "" {
				setErr(msg)
			}
			doneCh <- code
			return code
		}, sc.srv.db)
		if errors.Is(err, executor.ErrBusy) {
			select {
			case <-ctx.Done():
				return
			case <-time.After(2 * time.Second):
				continue
			}
		}
		break
	}

	if err != nil {
		_, _ = sc.srv.schedules.Update(sched.ID, func(cur *store.Schedule) {
			cur.LastRunAt = &started
			cur.LastStatus = "failed"
			cur.LastError = err.Error()
		})
		sc.notifyResult(sched, false, err.Error())
		return
	}

	_, _ = sc.srv.schedules.Update(sched.ID, func(cur *store.Schedule) {
		cur.LastRunAt = &started
		cur.LastStatus = "running"
		cur.LastError = ""
		cur.LastJobID = jobID
		cur.RunCount++
	})

	// Wait until the executor finishes this scheduled run before draining the
	// next item in the FIFO queue.
	var exitCode int
	select {
	case <-ctx.Done():
		return
	case exitCode = <-doneCh:
	}

	errMu.Lock()
	msg := runErr
	errMu.Unlock()

	status := "succeeded"
	if exitCode != 0 {
		status = "failed"
		if msg == "" {
			msg = fmt.Sprintf("exited with code %d", exitCode)
		}
	}

	_, _ = sc.srv.schedules.Update(sched.ID, func(cur *store.Schedule) {
		cur.LastStatus = status
		cur.LastError = msg
	})
	sc.notifyResult(sched, exitCode == 0, msg)
}

func (sc *Scheduler) notifyResult(sched *store.Schedule, ok bool, detail string) {
	if sc.srv.notifier == nil || !sc.srv.notifier.Enabled() {
		return
	}
	policy := sched.Notify
	if policy == "" {
		policy = "failure"
	}
	if policy == "never" || (policy == "failure" && ok) {
		return
	}
	if ok {
		sc.srv.notifyBG(
			"Scheduled task succeeded",
			fmt.Sprintf("%q (%s) completed on %s.", sched.Name, sched.Action, sc.targetSummary(sched)),
		)
		return
	}
	sc.srv.notifyBG(
		"Scheduled task failed",
		fmt.Sprintf("%q (%s) on %s failed: %s", sched.Name, sched.Action, sc.targetSummary(sched), truncate(detail, 200)),
	)
}

func (sc *Scheduler) targetSummary(sched *store.Schedule) string {
	node := sched.Node
	if node == "" {
		node = sc.srv.selfNode
	}
	switch sched.TargetType {
	case "lxc":
		if sched.GuestName != "" {
			return fmt.Sprintf("%s / CT %d (%s)", node, sched.VMID, sched.GuestName)
		}
		return fmt.Sprintf("%s / CT %d", node, sched.VMID)
	case "qemu":
		if sched.GuestName != "" {
			return fmt.Sprintf("%s / VM %d (%s)", node, sched.VMID, sched.GuestName)
		}
		return fmt.Sprintf("%s / VM %d", node, sched.VMID)
	case "all_lxc":
		return fmt.Sprintf("%s / all LXCs", node)
	case "all_guests":
		return fmt.Sprintf("%s / all guests", node)
	default:
		return node
	}
}

// runScheduledTask executes one schedule inside an Executor job slot,
// streaming progress lines into em. Returns (exitCode, shortErrorMessage).
func (s *Server) runScheduledTask(ctx context.Context, sched *store.Schedule, em *executor.Emitter) (int, string) {
	em.Line("stdout", fmt.Sprintf("=== Scheduled Task #%d: %s ===", sched.ID, sched.Name))
	em.Line("stdout", fmt.Sprintf("Action: %s | Target: %s", sched.Action, s.scheduler.targetSummary(sched)))

	// If targeting a paired secondary node, relay supported agent actions.
	if sched.PairedNodeID != "" {
		node, ok := s.findNode(sched.PairedNodeID)
		if !ok {
			msg := "paired node no longer exists"
			em.Line("stderr", "ERROR: "+msg)
			return 1, msg
		}
		return s.runRemoteAgentSchedule(ctx, node, sched, em)
	}

	switch sched.Action {
	case "host_update":
		em.Line("stdout", "Running apt-get update && apt-get upgrade -y on local host…")
		upd := exec.Command("apt-get", "update", "-q")
		upd.Env = append(os.Environ(), "DEBIAN_FRONTEND=noninteractive", "TERM=xterm")
		if code := em.RunCmd(upd); code != 0 {
			em.Line("stderr", fmt.Sprintf("apt-get update exited with %d; continuing to upgrade", code))
		}
		cmd := exec.Command("apt-get", "upgrade", "-y")
		cmd.Env = append(os.Environ(), "DEBIAN_FRONTEND=noninteractive", "TERM=xterm")
		code := em.RunCmd(cmd)
		if code != 0 {
			return code, fmt.Sprintf("apt-get upgrade exited with code %d", code)
		}
		em.Line("stdout", "Host OS upgrade completed successfully.")
		return 0, ""

	case "ct_update":
		if sched.VMID <= 0 {
			msg := "invalid container VMID"
			em.Line("stderr", "ERROR: "+msg)
			return 1, msg
		}
		em.Line("stdout", fmt.Sprintf("Updating CT %d via pct exec…", sched.VMID))
		cmd := exec.Command("pct", "exec", strconv.Itoa(sched.VMID), "--", "sh", "-c", lxcUpgradeScript)
		code := em.RunCmd(cmd)
		if code != 0 {
			return code, fmt.Sprintf("CT %d upgrade exited with code %d", sched.VMID, code)
		}
		em.Line("stdout", fmt.Sprintf("CT %d updated successfully.", sched.VMID))
		return 0, ""

	case "lxc_batch_update":
		snap, err := s.px.Fetch()
		if err != nil {
			msg := "could not query Proxmox resources: " + err.Error()
			em.Line("stderr", "ERROR: "+msg)
			return 1, msg
		}
		targetNode := sched.Node
		if targetNode == "" {
			targetNode = s.selfNode
		}
		localLXCs := localNodeLXCs(snap, targetNode)
		if len(localLXCs) == 0 {
			msg := "no LXC containers found on node " + targetNode
			em.Line("stderr", "ERROR: "+msg)
			return 1, msg
		}
		excludes := sched.Options.Exclude
		if excludes == nil {
			s.cfgMu.Lock()
			excludes = append([]int(nil), s.cfg.LXCUpdateExclude...)
			s.cfgMu.Unlock()
		}
		continueOnError := true
		if sched.Options.ContinueOnError != nil {
			continueOnError = *sched.Options.ContinueOnError
		}
		queued, skipped := planLXCBatch(localLXCs, nil, excludes)
		if len(queued) == 0 {
			em.Line("stdout", "No running, non-excluded LXC containers to update.")
			return 0, ""
		}
		code := runLXCBatch(em, queued, skipped, continueOnError)
		if code != 0 {
			return code, "one or more LXC containers failed to update"
		}
		return 0, ""

	case "backup":
		node := sched.Node
		if node == "" {
			node = s.selfNode
		}
		params := proxmox.BackupParams{
			VMID:     sched.VMID,
			All:      sched.TargetType == "all_guests",
			Storage:  sched.Options.Storage,
			Mode:     sched.Options.Mode,
			Compress: sched.Options.Compress,
			Notes:    sched.Options.Notes,
		}
		em.Line("stdout", fmt.Sprintf("Starting Proxmox vzdump on %s (mode=%s, compress=%s, storage=%s)…",
			node, fallbackStr(params.Mode, "snapshot"), fallbackStr(params.Compress, "zstd"), fallbackStr(params.Storage, "default")))
		upid, err := s.px.StartBackup(node, params)
		if err != nil {
			em.Line("stderr", "ERROR: "+err.Error())
			return 1, err.Error()
		}
		em.Line("stdout", "Proxmox task started: "+upid)
		exitStatus, err := s.px.WaitTask(ctx, node, upid)
		if err != nil {
			em.Line("stderr", "ERROR waiting for task: "+err.Error())
			return 1, err.Error()
		}
		if exitStatus != "OK" {
			em.Line("stderr", "Backup finished with status: "+exitStatus)
			return 1, exitStatus
		}
		em.Line("stdout", "Backup completed: OK")
		// Invalidate cached backup report so the Backups page reflects it immediately.
		s.backups.mu.Lock()
		s.backups.at = time.Time{}
		s.backups.mu.Unlock()
		return 0, ""

	case "snapshot":
		node := sched.Node
		if node == "" {
			node = s.selfNode
		}
		snapName := buildSnapshotName(sched.Options.SnapshotName, time.Now())
		desc := fmt.Sprintf("Scheduled snapshot (%s)", sched.Name)
		em.Line("stdout", fmt.Sprintf("Creating snapshot %q for %s %d on %s…", snapName, sched.TargetType, sched.VMID, node))
		upid, err := s.px.CreateSnapshot(node, sched.TargetType, sched.VMID, snapName, desc, sched.Options.IncludeRAM)
		if err != nil {
			em.Line("stderr", "ERROR: "+err.Error())
			return 1, err.Error()
		}
		em.Line("stdout", "Proxmox task started: "+upid)
		exitStatus, err := s.px.WaitTask(ctx, node, upid)
		if err != nil {
			em.Line("stderr", "ERROR waiting for snapshot task: "+err.Error())
			return 1, err.Error()
		}
		if exitStatus != "OK" {
			em.Line("stderr", "Snapshot finished with status: "+exitStatus)
			return 1, exitStatus
		}
		em.Line("stdout", fmt.Sprintf("Snapshot %q created: OK", snapName))
		return 0, ""

	case "power":
		node := sched.Node
		if node == "" {
			node = s.selfNode
		}
		act := sched.Options.PowerAction
		switch sched.TargetType {
		case "node":
			em.Line("stdout", fmt.Sprintf("Sending node power action %q to %s…", act, node))
			var err error
			if act == "wake" {
				err = s.px.NodeWake(node)
			} else {
				err = s.px.NodeAction(node, act)
			}
			if err != nil {
				em.Line("stderr", "ERROR: "+err.Error())
				return 1, err.Error()
			}
			em.Line("stdout", fmt.Sprintf("Node %s action %q accepted by Proxmox.", node, act))
			return 0, ""

		case "qemu", "lxc":
			em.Line("stdout", fmt.Sprintf("Sending %s %d power action %q on %s…", sched.TargetType, sched.VMID, act, node))
			if err := s.px.GuestAction(node, sched.TargetType, sched.VMID, act); err != nil {
				em.Line("stderr", "ERROR: "+err.Error())
				return 1, err.Error()
			}
			em.Line("stdout", fmt.Sprintf("Guest %s/%d action %q accepted by Proxmox.", sched.TargetType, sched.VMID, act))
			return 0, ""

		default:
			msg := "unsupported power target: " + sched.TargetType
			em.Line("stderr", "ERROR: "+msg)
			return 1, msg
		}

	case "speedtest":
		em.Line("stdout", "Running speedtest-cli --json --secure…")
		out, err := exec.CommandContext(ctx, "speedtest-cli", "--json", "--secure").Output()
		if err != nil {
			msg := execErr(err)
			if strings.Contains(err.Error(), "executable file not found") || strings.Contains(err.Error(), "no such file") {
				msg = "speedtest-cli not installed — run: apt install -y speedtest-cli"
			}
			em.Line("stderr", "ERROR: "+msg)
			return 1, msg
		}
		var result SpeedtestResult
		if err := json.Unmarshal(out, &result); err != nil {
			msg := "could not parse speedtest output"
			em.Line("stderr", "ERROR: "+msg)
			return 1, msg
		}
		s.appendSpeedtestHistory(STHistoryEntry{
			TS:       time.Now().Unix(),
			Download: result.Download,
			Upload:   result.Upload,
			Ping:     result.Ping,
		})
		em.Line("stdout", fmt.Sprintf("Download: %.1f Mbps | Upload: %.1f Mbps | Ping: %.1f ms",
			result.Download/1e6, result.Upload/1e6, result.Ping))
		if result.Server.Sponsor != "" {
			em.Line("stdout", fmt.Sprintf("Server: %s (%s, %s)", result.Server.Sponsor, result.Server.Name, result.Server.Country))
		}
		return 0, ""

	default:
		msg := "unsupported action: " + sched.Action
		em.Line("stderr", "ERROR: "+msg)
		return 1, msg
	}
}

// runRemoteAgentSchedule dispatches a scheduled update job to a paired
// secondary node's /agent API and polls until the remote job completes.
func (s *Server) runRemoteAgentSchedule(ctx context.Context, node config.PairedNode, sched *store.Schedule, em *executor.Emitter) (int, string) {
	var subPath string
	var bodyBytes []byte

	switch sched.Action {
	case "host_update":
		subPath = "updates/apply"
	case "ct_update":
		subPath = fmt.Sprintf("guests/%d/update", sched.VMID)
	case "lxc_batch_update":
		subPath = "guests/update-all"
		payload := map[string]any{}
		if sched.Options.Exclude != nil {
			payload["exclude"] = sched.Options.Exclude
		}
		if sched.Options.ContinueOnError != nil {
			payload["continue_on_error"] = *sched.Options.ContinueOnError
		}
		bodyBytes, _ = json.Marshal(payload)
	default:
		msg := fmt.Sprintf("action %q is not supported on paired secondary agents", sched.Action)
		em.Line("stderr", "ERROR: "+msg)
		return 1, msg
	}

	em.Line("stdout", fmt.Sprintf("Dispatching to paired node %s (%s) → /agent/%s…",
		fallbackStr(node.NodeName, node.ID), node.Address, subPath))

	var bodyReader io.Reader
	if len(bodyBytes) > 0 {
		bodyReader = bytes.NewReader(bodyBytes)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "http://"+node.Address+"/agent/"+subPath, bodyReader)
	if err != nil {
		em.Line("stderr", "ERROR: "+err.Error())
		return 1, err.Error()
	}
	req.Header.Set("Authorization", "Bearer "+node.AuthToken)
	if len(bodyBytes) > 0 {
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := nodeHTTP.Do(req)
	if err != nil {
		msg := "paired node unreachable: " + err.Error()
		em.Line("stderr", "ERROR: "+msg)
		return 1, msg
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		msg := fmt.Sprintf("secondary returned %s: %s", resp.Status, strings.TrimSpace(string(raw)))
		em.Line("stderr", "ERROR: "+msg)
		return 1, msg
	}

	var startResp struct {
		JobID string `json:"job_id"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&startResp); err != nil || startResp.JobID == "" {
		msg := "secondary did not return a job_id"
		em.Line("stderr", "ERROR: "+msg)
		return 1, msg
	}

	em.Line("stdout", "Remote job started: "+startResp.JobID+" (waiting for completion…)")

	ticker := time.NewTicker(3 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return 1, "cancelled"
		case <-ticker.C:
		}

		pollReq, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://"+node.Address+"/agent/jobs/"+startResp.JobID, nil)
		if err != nil {
			continue
		}
		pollReq.Header.Set("Authorization", "Bearer "+node.AuthToken)
		pollResp, err := nodeHTTP.Do(pollReq)
		if err != nil {
			em.Line("stderr", "Transient poll error: "+err.Error())
			continue
		}
		var job store.Job
		decErr := json.NewDecoder(pollResp.Body).Decode(&job)
		pollResp.Body.Close()
		if decErr != nil {
			continue
		}
		if job.Status == "running" {
			continue
		}

		// Replay remote output lines into the local job log.
		for _, rawLine := range strings.Split(job.Output, "\n") {
			rawLine = strings.TrimSpace(rawLine)
			if rawLine == "" {
				continue
			}
			var frame struct {
				Type string `json:"type"`
				Line string `json:"line"`
			}
			if json.Unmarshal([]byte(rawLine), &frame) == nil && (frame.Type == "stdout" || frame.Type == "stderr") {
				em.Line(frame.Type, frame.Line)
			}
		}

		if job.Status == "succeeded" {
			em.Line("stdout", "Remote job completed successfully.")
			return 0, ""
		}
		code := 1
		if job.ExitCode != nil && *job.ExitCode != 0 {
			code = *job.ExitCode
		}
		return code, fmt.Sprintf("remote job %s failed (exit %d)", startResp.JobID, code)
	}
}

func buildSnapshotName(prefix string, now time.Time) string {
	p := strings.TrimSpace(prefix)
	if p == "" {
		p = "simpdash"
	}
	p = snapPrefixRe.ReplaceAllString(p, "-")
	p = strings.Trim(p, "-_")
	if p == "" || !((p[0] >= 'a' && p[0] <= 'z') || (p[0] >= 'A' && p[0] <= 'Z')) {
		p = "sd-" + p
	}
	stamp := now.Format("20060102-1504")
	maxPrefix := 40 - 1 - len(stamp)
	if len(p) > maxPrefix {
		p = strings.TrimRight(p[:maxPrefix], "-_")
	}
	return p + "-" + stamp
}

func fallbackStr(v, def string) string {
	if strings.TrimSpace(v) == "" {
		return def
	}
	return v
}

// --- HTTP API Handlers ---

type schedulePayload struct {
	Name         *string                `json:"name"`
	Enabled      *bool                  `json:"enabled"`
	Action       *string                `json:"action"`
	TargetType   *string                `json:"target_type"`
	Node         *string                `json:"node"`
	PairedNodeID *string                `json:"paired_node_id"`
	VMID         *int                   `json:"vmid"`
	GuestName    *string                `json:"guest_name"`
	Options      *store.ScheduleOptions `json:"options"`
	Frequency    *string                `json:"frequency"`
	RunAt        *string                `json:"run_at"`
	TimeOfDay    *string                `json:"time_of_day"`
	Minute       *int                   `json:"minute"`
	DaysOfWeek   *[]int                 `json:"days_of_week"`
	DayOfMonth   *int                   `json:"day_of_month"`
	CronExpr     *string                `json:"cron_expr"`
	IfBusy       *string                `json:"if_busy"`
	Notify       *string                `json:"notify"`
}

// handleSchedules dispatches GET (list) and POST (create) on /api/schedules.
func (s *Server) handleSchedules(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		s.listSchedules(w, r)
	case http.MethodPost:
		s.createSchedule(w, r)
	default:
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

// handleSchedulesPrefix dispatches /api/schedules/:id and /api/schedules/:id/run.
func (s *Server) handleSchedulesPrefix(w http.ResponseWriter, r *http.Request) {
	tail := strings.TrimPrefix(r.URL.Path, "/api/schedules/")
	parts := strings.SplitN(tail, "/", 2)
	id, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil || id <= 0 {
		http.NotFound(w, r)
		return
	}
	sub := ""
	if len(parts) == 2 {
		sub = parts[1]
	}

	if sub == "run" {
		methodGate(http.MethodPost, func(w http.ResponseWriter, r *http.Request) {
			s.runScheduleNow(w, r, id)
		})(w, r)
		return
	}
	if sub != "" {
		http.NotFound(w, r)
		return
	}

	switch r.Method {
	case http.MethodPut:
		s.updateSchedule(w, r, id)
	case http.MethodDelete:
		s.deleteSchedule(w, id)
	default:
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) listSchedules(w http.ResponseWriter, r *http.Request) {
	list, err := s.schedules.List()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "failed to read schedules")
		return
	}
	native, err := s.px.FetchNativeBackupSchedules()
	if err != nil || native == nil {
		native = []proxmox.NativeBackupSchedule{}
	}
	tz, _ := time.Now().Zone()
	locName := time.Local.String()
	if locName == "Local" && tz != "" {
		locName = tz
	}
	qLen := 0
	if s.scheduler != nil {
		qLen = s.scheduler.queueLen()
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"schedules":      list,
		"timezone":       locName,
		"tz_abbr":        tz,
		"server_time":    time.Now().Format(time.RFC3339),
		"queue_len":      qLen,
		"native_backups": native,
	})
}

func (s *Server) createSchedule(w http.ResponseWriter, r *http.Request) {
	var p schedulePayload
	if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid body")
		return
	}

	sched := &store.Schedule{
		Enabled: true,
		IfBusy:  "queue",
		Notify:  "failure",
	}
	if err := s.applySchedulePayload(sched, p, true); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}

	if sched.Enabled {
		next, err := store.ComputeNextRun(sched, time.Now(), time.Local)
		if err != nil {
			writeErr(w, http.StatusBadRequest, err.Error())
			return
		}
		if sched.Frequency == "once" && next == nil {
			writeErr(w, http.StatusBadRequest, "one-time run_at must be in the future")
			return
		}
		sched.NextRunAt = next
	}

	created, err := s.schedules.Create(sched)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "failed to save schedule")
		return
	}
	writeJSON(w, http.StatusCreated, created)
}

func (s *Server) updateSchedule(w http.ResponseWriter, r *http.Request, id int64) {
	var p schedulePayload
	if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid body")
		return
	}

	existing, err := s.schedules.Get(id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "failed to read schedule")
		return
	}
	if existing == nil {
		writeErr(w, http.StatusNotFound, "schedule not found")
		return
	}

	if err := s.applySchedulePayload(existing, p, false); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}

	if existing.Enabled {
		next, err := store.ComputeNextRun(existing, time.Now(), time.Local)
		if err != nil {
			writeErr(w, http.StatusBadRequest, err.Error())
			return
		}
		if existing.Frequency == "once" && next == nil {
			writeErr(w, http.StatusBadRequest, "one-time run_at must be in the future to enable")
			return
		}
		existing.NextRunAt = next
	} else {
		existing.NextRunAt = nil
	}

	updated, err := s.schedules.Update(id, func(cur *store.Schedule) {
		cur.Name = existing.Name
		cur.Enabled = existing.Enabled
		cur.Action = existing.Action
		cur.TargetType = existing.TargetType
		cur.Node = existing.Node
		cur.PairedNodeID = existing.PairedNodeID
		cur.VMID = existing.VMID
		cur.GuestName = existing.GuestName
		cur.Options = existing.Options
		cur.Frequency = existing.Frequency
		cur.RunAt = existing.RunAt
		cur.TimeOfDay = existing.TimeOfDay
		cur.Minute = existing.Minute
		cur.DaysOfWeek = existing.DaysOfWeek
		cur.DayOfMonth = existing.DayOfMonth
		cur.CronExpr = existing.CronExpr
		cur.IfBusy = existing.IfBusy
		cur.Notify = existing.Notify
		cur.NextRunAt = existing.NextRunAt
	})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "failed to save schedule")
		return
	}
	if updated == nil {
		writeErr(w, http.StatusNotFound, "schedule not found")
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

func (s *Server) deleteSchedule(w http.ResponseWriter, id int64) {
	ok, err := s.schedules.Delete(id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "failed to delete schedule")
		return
	}
	if !ok {
		writeErr(w, http.StatusNotFound, "schedule not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) runScheduleNow(w http.ResponseWriter, r *http.Request, id int64) {
	sched, err := s.schedules.Get(id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "failed to read schedule")
		return
	}
	if sched == nil {
		writeErr(w, http.StatusNotFound, "schedule not found")
		return
	}
	if s.scheduler == nil {
		writeErr(w, http.StatusServiceUnavailable, "scheduler not running")
		return
	}
	if !s.scheduler.enqueue(id, true) {
		writeErr(w, http.StatusConflict, "schedule is already queued or running")
		return
	}
	_, _ = s.schedules.Update(id, func(cur *store.Schedule) {
		cur.LastStatus = "queued"
		cur.LastError = ""
	})
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "queued": true})
}

// SchedulesPreview handles POST /api/schedules/preview — validates timing
// fields and returns the next 3 computed run times in the server timezone.
func (s *Server) SchedulesPreview(w http.ResponseWriter, r *http.Request) {
	var p schedulePayload
	if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid body")
		return
	}
	tmp := &store.Schedule{}
	if err := applyTimingFields(tmp, p); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	runs, err := store.PreviewNextRuns(tmp, time.Now(), 3, time.Local)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	tz, _ := time.Now().Zone()
	locName := time.Local.String()
	if locName == "Local" && tz != "" {
		locName = tz
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"next_runs": runs,
		"timezone":  locName,
		"tz_abbr":   tz,
	})
}

// SchedulesStorages handles GET /api/schedules/storages?node=<node>.
func (s *Server) SchedulesStorages(w http.ResponseWriter, r *http.Request) {
	node := strings.TrimSpace(r.URL.Query().Get("node"))
	stors, err := s.px.ListBackupStorages(node)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"storages": []string{}})
		return
	}
	if stors == nil {
		stors = []string{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"storages": stors})
}

// --- validation helpers ---

func applyTimingFields(dst *store.Schedule, p schedulePayload) error {
	if p.Frequency != nil {
		dst.Frequency = strings.TrimSpace(*p.Frequency)
	}
	if p.RunAt != nil {
		raw := strings.TrimSpace(*p.RunAt)
		if raw == "" {
			dst.RunAt = nil
		} else {
			t, err := parseRunAt(raw)
			if err != nil {
				return err
			}
			dst.RunAt = &t
		}
	}
	if p.TimeOfDay != nil {
		dst.TimeOfDay = strings.TrimSpace(*p.TimeOfDay)
	}
	if p.Minute != nil {
		dst.Minute = *p.Minute
	}
	if p.DaysOfWeek != nil {
		dst.DaysOfWeek = store.NormalizeDaysOfWeek(*p.DaysOfWeek)
	}
	if p.DayOfMonth != nil {
		dst.DayOfMonth = *p.DayOfMonth
	}
	if p.CronExpr != nil {
		dst.CronExpr = strings.TrimSpace(*p.CronExpr)
	}
	return store.ValidateTiming(dst)
}

func parseRunAt(raw string) (time.Time, error) {
	if t, err := time.Parse(time.RFC3339, raw); err == nil {
		return t.UTC(), nil
	}
	// Accept HTML datetime-local ("2006-01-02T15:04") interpreted in server local TZ.
	if t, err := time.ParseInLocation("2006-01-02T15:04", raw, time.Local); err == nil {
		return t.UTC(), nil
	}
	if t, err := time.ParseInLocation("2006-01-02T15:04:05", raw, time.Local); err == nil {
		return t.UTC(), nil
	}
	return time.Time{}, fmt.Errorf("invalid run_at timestamp (use RFC3339 or YYYY-MM-DDTHH:MM)")
}

func (s *Server) applySchedulePayload(dst *store.Schedule, p schedulePayload, isCreate bool) error {
	if p.Name != nil {
		dst.Name = strings.TrimSpace(*p.Name)
	}
	if p.Enabled != nil {
		dst.Enabled = *p.Enabled
	}
	if p.Action != nil {
		dst.Action = strings.TrimSpace(*p.Action)
	}
	if p.TargetType != nil {
		dst.TargetType = strings.TrimSpace(*p.TargetType)
	}
	if p.Node != nil {
		dst.Node = strings.TrimSpace(*p.Node)
	}
	if p.PairedNodeID != nil {
		dst.PairedNodeID = strings.TrimSpace(*p.PairedNodeID)
	}
	if p.VMID != nil {
		dst.VMID = *p.VMID
	}
	if p.GuestName != nil {
		dst.GuestName = strings.TrimSpace(*p.GuestName)
	}
	if p.Options != nil {
		dst.Options = *p.Options
	}
	if p.IfBusy != nil {
		dst.IfBusy = strings.TrimSpace(*p.IfBusy)
	}
	if p.Notify != nil {
		dst.Notify = strings.TrimSpace(*p.Notify)
	}

	if dst.Name == "" {
		return fmt.Errorf("name is required")
	}
	if len(dst.Name) > 120 {
		return fmt.Errorf("name must be 120 characters or fewer")
	}
	if !validScheduleAction[dst.Action] {
		return fmt.Errorf("unsupported action %q", dst.Action)
	}
	if !validTargetType[dst.TargetType] {
		return fmt.Errorf("unsupported target_type %q", dst.TargetType)
	}
	if !validIfBusy[dst.IfBusy] {
		return fmt.Errorf("if_busy must be queue or skip")
	}
	if dst.IfBusy == "" {
		dst.IfBusy = "queue"
	}
	if !validNotify[dst.Notify] {
		return fmt.Errorf("notify must be failure, always, or never")
	}
	if dst.Notify == "" {
		dst.Notify = "failure"
	}
	if dst.Node != "" && !proxmox.ValidNodeName(dst.Node) {
		return fmt.Errorf("invalid node name")
	}
	if dst.PairedNodeID != "" {
		if _, ok := s.findNode(dst.PairedNodeID); !ok {
			return fmt.Errorf("unknown paired_node_id")
		}
	}

	if err := validateActionAndTarget(dst); err != nil {
		return err
	}
	if err := applyTimingFields(dst, p); err != nil {
		return err
	}
	if isCreate && dst.Node == "" && dst.PairedNodeID == "" {
		dst.Node = s.selfNode
	}
	return nil
}

func validateActionAndTarget(sc *store.Schedule) error {
	switch sc.Action {
	case "host_update":
		if sc.TargetType != "node" {
			return fmt.Errorf("host_update requires target_type=node")
		}
		sc.VMID = 0

	case "ct_update":
		if sc.TargetType != "lxc" {
			return fmt.Errorf("ct_update requires target_type=lxc")
		}
		if sc.VMID <= 0 {
			return fmt.Errorf("ct_update requires a valid container VMID")
		}

	case "lxc_batch_update":
		if sc.TargetType != "all_lxc" {
			return fmt.Errorf("lxc_batch_update requires target_type=all_lxc")
		}
		sc.VMID = 0
		if sc.Options.Exclude != nil {
			sc.Options.Exclude = normalizeVMIDs(sc.Options.Exclude)
		}

	case "backup":
		if sc.PairedNodeID != "" {
			return fmt.Errorf("backups run through the local Proxmox cluster API, not a paired agent")
		}
		if sc.TargetType != "lxc" && sc.TargetType != "qemu" && sc.TargetType != "all_guests" {
			return fmt.Errorf("backup requires target_type lxc, qemu, or all_guests")
		}
		if sc.TargetType != "all_guests" && sc.VMID <= 0 {
			return fmt.Errorf("backup requires a valid VMID")
		}
		if sc.TargetType == "all_guests" {
			sc.VMID = 0
		}
		if sc.Options.Storage != "" && !storageNameRe.MatchString(sc.Options.Storage) {
			return fmt.Errorf("invalid backup storage name")
		}
		if !validBackupMode[sc.Options.Mode] {
			return fmt.Errorf("backup mode must be snapshot, suspend, or stop")
		}
		if !validBackupCompress[sc.Options.Compress] {
			return fmt.Errorf("backup compress must be zstd, gzip, lzo, or 0")
		}

	case "snapshot":
		if sc.PairedNodeID != "" {
			return fmt.Errorf("snapshots run through the local Proxmox cluster API, not a paired agent")
		}
		if sc.TargetType != "lxc" && sc.TargetType != "qemu" {
			return fmt.Errorf("snapshot requires target_type lxc or qemu")
		}
		if sc.VMID <= 0 {
			return fmt.Errorf("snapshot requires a valid VMID")
		}

	case "power":
		if sc.PairedNodeID != "" {
			return fmt.Errorf("power actions run through the local Proxmox cluster API")
		}
		switch sc.TargetType {
		case "node":
			sc.VMID = 0
			if !validNodePower[sc.Options.PowerAction] {
				return fmt.Errorf("node power_action must be reboot, shutdown, or wake")
			}
		case "lxc", "qemu":
			if sc.VMID <= 0 {
				return fmt.Errorf("guest power action requires a valid VMID")
			}
			if !validGuestPower[sc.Options.PowerAction] {
				return fmt.Errorf("guest power_action must be start, shutdown, stop, or reboot")
			}
		default:
			return fmt.Errorf("power requires target_type node, lxc, or qemu")
		}

	case "speedtest":
		if sc.PairedNodeID != "" {
			return fmt.Errorf("speedtest runs on the main host")
		}
		if sc.TargetType != "node" {
			return fmt.Errorf("speedtest requires target_type=node")
		}
		sc.VMID = 0
	}
	return nil
}
