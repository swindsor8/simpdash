package api

import (
	"errors"
	"log"
	"net/http"
	"os/exec"
	"time"

	"simpdash/internal/update"
)

// Version handles GET /api/version — the running build's version string.
func (s *Server) Version(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"version": s.update.Current()})
}

// UpdateCheck handles GET /api/update-check — compares the running build
// against the latest GitHub release (cached ~daily by the Checker).
// Pass ?refresh=1 to bypass the cache and check GitHub immediately.
func (s *Server) UpdateCheck(w http.ResponseWriter, r *http.Request) {
	if r.URL.Query().Get("refresh") == "1" {
		writeJSON(w, http.StatusOK, s.update.ForceCheck())
		return
	}
	writeJSON(w, http.StatusOK, s.update.Check())
}

// SelfUpdate handles POST /api/self-update — downloads the latest verified
// GitHub Release binary, atomically swaps it in place, responds with the target
// version, and triggers a non-blocking systemd restart.
func (s *Server) SelfUpdate(w http.ResponseWriter, r *http.Request) {
	if s.exec.Active() {
		writeErr(w, http.StatusConflict, "a job is already running — wait for it to finish before updating SimpDash")
		return
	}

	target, err := s.update.Apply(r.Context())
	if err != nil {
		switch {
		case errors.Is(err, update.ErrInProgress):
			writeErr(w, http.StatusConflict, err.Error())
		case errors.Is(err, update.ErrUpToDate), errors.Is(err, update.ErrDevBuild):
			writeErr(w, http.StatusBadRequest, err.Error())
		default:
			writeErr(w, http.StatusBadGateway, err.Error())
		}
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{
		"status":         "restarting",
		"target_version": target,
	})
	if fl, ok := w.(http.Flusher); ok {
		fl.Flush()
	}

	// Give the HTTP response a moment to reach the browser before systemd
	// restarts the service. --no-block queues the restart via D-Bus and returns
	// immediately so systemd does not SIGTERM the systemctl call mid-flight.
	go func() {
		time.Sleep(350 * time.Millisecond)
		if err := exec.Command("systemctl", "restart", "--no-block", "simpdash").Run(); err != nil {
			log.Printf("self-update: binary updated to %s, but systemctl restart failed: %v", target, err)
			s.update.ClearUpdating()
		}
	}()
}
