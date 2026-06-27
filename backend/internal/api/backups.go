package api

import (
	"net/http"
	"sync"
	"time"

	"simpdash/internal/proxmox"
)

// backupCache memoizes the backup report. Backups change on the order of hours,
// so a 5-minute TTL keeps us off the PVE API (FetchBackups makes several calls
// per node). Only successes are cached — a transient error re-fetches next
// request rather than sticking for the whole TTL.
type backupCache struct {
	mu  sync.Mutex
	rep proxmox.BackupReport
	at  time.Time
}

func (bc *backupCache) get(px *proxmox.Client) (proxmox.BackupReport, error) {
	bc.mu.Lock()
	defer bc.mu.Unlock()
	if !bc.at.IsZero() && time.Since(bc.at) < 5*time.Minute {
		return bc.rep, nil
	}
	rep, err := px.FetchBackups()
	if err != nil {
		return proxmox.BackupReport{}, err
	}
	bc.rep, bc.at = rep, time.Now()
	return rep, nil
}

// Backups handles GET /api/backups — per-guest last-backup status plus recent
// vzdump job results for the local PVE cluster.
func (s *Server) Backups(w http.ResponseWriter, r *http.Request) {
	rep, err := s.backups.get(s.px)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, rep)
}
