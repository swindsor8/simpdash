package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os/exec"
	"sort"
	"strconv"
	"time"

	"simpdash/internal/executor"
	"simpdash/internal/proxmox"
)

// lxcUpgradeScript runs a non-interactive package upgrade inside an LXC,
// supporting the common homelab container distros (Debian/Ubuntu, Alpine,
// Fedora/Rocky/Alma). Fixed constant passed as a single argv element to sh -c
// so there is zero shell-injection surface.
const lxcUpgradeScript = `if command -v apt-get >/dev/null 2>&1; then
  DEBIAN_FRONTEND=noninteractive apt-get update && DEBIAN_FRONTEND=noninteractive apt-get -y upgrade
elif command -v apk >/dev/null 2>&1; then
  apk update && apk upgrade
elif command -v dnf >/dev/null 2>&1; then
  dnf -y upgrade
else
  echo "No supported package manager (apt-get, apk, dnf) found" >&2
  exit 127
fi`

type lxcBatchItem struct {
	VMID   int    `json:"vmid"`
	Name   string `json:"name"`
	Reason string `json:"reason,omitempty"` // populated for skipped items: "excluded" | "stopped"
}

type lxcProgressFrame struct {
	Type       string `json:"type"`
	VMID       int    `json:"vmid"`
	Name       string `json:"name"`
	Status     string `json:"status"` // queued | running | succeeded | failed | skipped
	Reason     string `json:"reason,omitempty"`
	ExitCode   *int   `json:"exit_code,omitempty"`
	DurationMs int64  `json:"duration_ms,omitempty"`
	Index      int    `json:"index,omitempty"`
	Total      int    `json:"total,omitempty"`
}

// handleLXCExcludes dispatches GET and PUT /api/guests/update-all/excludes.
func (s *Server) handleLXCExcludes(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		s.GetLXCUpdateExcludes(w, r)
	case http.MethodPut:
		s.PutLXCUpdateExcludes(w, r)
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

// GetLXCUpdateExcludes handles GET /api/guests/update-all/excludes.
func (s *Server) GetLXCUpdateExcludes(w http.ResponseWriter, r *http.Request) {
	s.cfgMu.Lock()
	out := normalizeVMIDs(s.cfg.LXCUpdateExclude)
	s.cfgMu.Unlock()
	writeJSON(w, http.StatusOK, map[string]any{"excluded": out})
}

// PutLXCUpdateExcludes handles PUT /api/guests/update-all/excludes.
func (s *Server) PutLXCUpdateExcludes(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Excluded []int `json:"excluded"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid body")
		return
	}
	for _, id := range body.Excluded {
		if id <= 0 {
			writeErr(w, http.StatusBadRequest, "vmid must be a positive integer")
			return
		}
	}
	clean := normalizeVMIDs(body.Excluded)

	s.cfgMu.Lock()
	s.cfg.LXCUpdateExclude = clean
	err := s.cfg.Save(s.cfgPath)
	s.cfgMu.Unlock()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "failed to save config")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"excluded": clean})
}

// GuestUpdateAll handles POST /api/guests/update-all — queues a sequential
// package upgrade across all running local LXC containers (skipping excluded
// and stopped containers) inside the Executor's single-job slot.
func (s *Server) GuestUpdateAll(w http.ResponseWriter, r *http.Request) {
	var body struct {
		VMIDs           []int `json:"vmids"`
		Exclude         []int `json:"exclude"`
		ContinueOnError *bool `json:"continue_on_error"`
	}
	if r.Body != nil {
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil && !errors.Is(err, io.EOF) {
			writeErr(w, http.StatusBadRequest, "invalid body")
			return
		}
	}

	continueOnError := true
	if body.ContinueOnError != nil {
		continueOnError = *body.ContinueOnError
	}

	snap, err := s.px.Fetch()
	if err != nil {
		writeErr(w, http.StatusBadGateway, "could not query Proxmox resources: "+err.Error())
		return
	}

	localLXCs := localNodeLXCs(snap, s.selfNode)
	if len(localLXCs) == 0 {
		writeErr(w, http.StatusBadRequest, "no local LXC containers found")
		return
	}

	s.cfgMu.Lock()
	cfgExcludes := append([]int(nil), s.cfg.LXCUpdateExclude...)
	s.cfgMu.Unlock()

	excludes := cfgExcludes
	if body.Exclude != nil {
		excludes = body.Exclude
	}

	queued, skipped := planLXCBatch(localLXCs, body.VMIDs, excludes)
	if len(queued) == 0 {
		writeErr(w, http.StatusBadRequest, "no running, non-excluded LXC containers to update")
		return
	}

	id, err := s.exec.StartFunc("lxc_batch_upgrade", func(em *executor.Emitter) int {
		return runLXCBatch(em, queued, skipped, continueOnError)
	}, s.db)
	if errors.Is(err, executor.ErrBusy) {
		writeErr(w, http.StatusConflict, "a job is already running")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"job_id":  id,
		"queued":  queued,
		"skipped": skipped,
	})
}

func runLXCBatch(em *executor.Emitter, queued, skipped []lxcBatchItem, continueOnError bool) int {
	total := len(queued)

	// Announce the entire initial queue + skipped list so clients (and late
	// subscribers) can render the full status list immediately.
	for i, ct := range queued {
		emitProgress(em, lxcProgressFrame{
			Type:   "progress",
			VMID:   ct.VMID,
			Name:   ct.Name,
			Status: "queued",
			Index:  i + 1,
			Total:  total,
		})
	}
	for _, ct := range skipped {
		emitProgress(em, lxcProgressFrame{
			Type:   "progress",
			VMID:   ct.VMID,
			Name:   ct.Name,
			Status: "skipped",
			Reason: ct.Reason,
			Total:  total,
		})
	}

	em.Line("stdout", fmt.Sprintf("=== Batch LXC Update: %d queued, %d skipped ===", total, len(skipped)))

	succeeded, failed, aborted := 0, 0, 0
	for i, ct := range queued {
		if em.Cancelled() {
			for j := i; j < len(queued); j++ {
				rem := queued[j]
				aborted++
				emitProgress(em, lxcProgressFrame{
					Type:   "progress",
					VMID:   rem.VMID,
					Name:   rem.Name,
					Status: "skipped",
					Reason: "cancelled",
					Index:  j + 1,
					Total:  total,
				})
			}
			break
		}
		idx := i + 1
		label := formatCTLabel(ct)
		emitProgress(em, lxcProgressFrame{
			Type:   "progress",
			VMID:   ct.VMID,
			Name:   ct.Name,
			Status: "running",
			Index:  idx,
			Total:  total,
		})
		em.Line("stdout", "")
		em.Line("stdout", fmt.Sprintf("--- [%d/%d] Updating %s ---", idx, total, label))

		start := time.Now()
		cmd := exec.Command("pct", "exec", strconv.Itoa(ct.VMID), "--", "sh", "-c", lxcUpgradeScript)
		code := em.RunCmd(cmd)
		dur := time.Since(start)
		codeCopy := code

		if em.Cancelled() {
			failed++
			emitProgress(em, lxcProgressFrame{
				Type:       "progress",
				VMID:       ct.VMID,
				Name:       ct.Name,
				Status:     "failed",
				ExitCode:   &codeCopy,
				DurationMs: dur.Milliseconds(),
				Index:      idx,
				Total:      total,
			})
			for j := i + 1; j < len(queued); j++ {
				rem := queued[j]
				aborted++
				emitProgress(em, lxcProgressFrame{
					Type:   "progress",
					VMID:   rem.VMID,
					Name:   rem.Name,
					Status: "skipped",
					Reason: "cancelled",
					Index:  j + 1,
					Total:  total,
				})
			}
			break
		}

		if code == 0 {
			succeeded++
			emitProgress(em, lxcProgressFrame{
				Type:       "progress",
				VMID:       ct.VMID,
				Name:       ct.Name,
				Status:     "succeeded",
				ExitCode:   &codeCopy,
				DurationMs: dur.Milliseconds(),
				Index:      idx,
				Total:      total,
			})
			em.Line("stdout", fmt.Sprintf("OK: %s updated in %s", label, dur.Round(100*time.Millisecond)))
		} else {
			failed++
			emitProgress(em, lxcProgressFrame{
				Type:       "progress",
				VMID:       ct.VMID,
				Name:       ct.Name,
				Status:     "failed",
				ExitCode:   &codeCopy,
				DurationMs: dur.Milliseconds(),
				Index:      idx,
				Total:      total,
			})
			em.Line("stderr", fmt.Sprintf("FAILED: %s exited with code %d after %s", label, code, dur.Round(100*time.Millisecond)))
			if !continueOnError {
				for j := i + 1; j < len(queued); j++ {
					rem := queued[j]
					aborted++
					emitProgress(em, lxcProgressFrame{
						Type:   "progress",
						VMID:   rem.VMID,
						Name:   rem.Name,
						Status: "skipped",
						Reason: "aborted",
						Index:  j + 1,
						Total:  total,
					})
				}
				em.Line("stderr", "Stopping batch early because stop-on-error was enabled.")
				break
			}
		}
	}

	em.Line("stdout", "")
	em.Line("stdout", fmt.Sprintf("=== Batch complete: %d succeeded, %d failed, %d skipped ===", succeeded, failed, len(skipped)+aborted))
	if failed > 0 {
		return 1
	}
	return 0
}

func emitProgress(em *executor.Emitter, f lxcProgressFrame) {
	b, err := json.Marshal(f)
	if err == nil {
		em.RawJSON(string(b))
	}
}

func formatCTLabel(ct lxcBatchItem) string {
	if ct.Name != "" {
		return fmt.Sprintf("CT %d (%s)", ct.VMID, ct.Name)
	}
	return fmt.Sprintf("CT %d", ct.VMID)
}

func localNodeLXCs(snap proxmox.Snapshot, selfNode string) []proxmox.Guest {
	for _, n := range snap.Nodes {
		if n.ID == selfNode {
			return n.LXCs
		}
	}
	// Single-node fallback if hostname differs slightly from the PVE node name.
	if len(snap.Nodes) == 1 {
		return snap.Nodes[0].LXCs
	}
	return nil
}

// planLXCBatch partitions local LXCs into queued (running and eligible) and
// skipped (excluded or stopped), sorted by VMID ascending.
func planLXCBatch(lxcs []proxmox.Guest, explicitVMIDs []int, excludes []int) (queued, skipped []lxcBatchItem) {
	sorted := make([]proxmox.Guest, len(lxcs))
	copy(sorted, lxcs)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].VMID < sorted[j].VMID })

	wantSet := map[int]bool{}
	for _, id := range explicitVMIDs {
		wantSet[id] = true
	}
	excludeSet := map[int]bool{}
	for _, id := range excludes {
		excludeSet[id] = true
	}

	queued = []lxcBatchItem{}
	skipped = []lxcBatchItem{}

	for _, ct := range sorted {
		if len(wantSet) > 0 && !wantSet[ct.VMID] {
			continue
		}
		if len(wantSet) == 0 && excludeSet[ct.VMID] {
			skipped = append(skipped, lxcBatchItem{VMID: ct.VMID, Name: ct.Name, Reason: "excluded"})
			continue
		}
		if ct.Status != "running" {
			skipped = append(skipped, lxcBatchItem{VMID: ct.VMID, Name: ct.Name, Reason: "stopped"})
			continue
		}
		queued = append(queued, lxcBatchItem{VMID: ct.VMID, Name: ct.Name})
	}
	return queued, skipped
}

func normalizeVMIDs(ids []int) []int {
	if len(ids) == 0 {
		return []int{}
	}
	seen := map[int]bool{}
	out := make([]int, 0, len(ids))
	for _, id := range ids {
		if id > 0 && !seen[id] {
			seen[id] = true
			out = append(out, id)
		}
	}
	sort.Ints(out)
	return out
}
