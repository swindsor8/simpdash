package api

import (
	"errors"
	"net/http"
	"os"
	"os/exec"
	"regexp"

	"simpdash/internal/executor"
)

// ctidRe bounds an LXC target to digits so it's safe to pass to `pct exec`.
var ctidRe = regexp.MustCompile(`^[0-9]+$`)

// Catalog handles GET /api/catalog — the full script list for the UI.
func (s *Server) Catalog(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.catalog.All())
}

// CatalogSync handles POST /api/catalog/sync — pulls the repo's current file
// list and adds any installer not already known (as a "Miscellaneous" community
// entry). Idempotent: re-running only adds what's newly upstream.
func (s *Server) CatalogSync(w http.ResponseWriter, r *http.Request) {
	added, total, err := s.catalog.Sync(r.Context())
	if err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]int{"added": added, "total": total})
}

// CatalogRun handles POST /api/catalog/:slug/run.
//
// Looks the script up by id in the embedded manifest and runs its install
// command as a "catalog_script" job — same executor, same single-job lock, same
// SQLite-backed history and /api/jobs/:id/stream as apt upgrades.
//
// Security: the URL is taken from the manifest, never from the request. The
// slug only selects an entry; an unknown slug is a 404. The URL is passed to
// bash as a positional argument ($1), not concatenated into the script string,
// so it can't break out of the command even if a manifest URL were malformed.
func (s *Server) CatalogRun(w http.ResponseWriter, r *http.Request, slug string) {
	script, ok := s.catalog.Get(slug)
	if !ok {
		writeErr(w, http.StatusNotFound, "unknown script")
		return
	}

	// Optional install target (addons). Empty/"host" runs on the Proxmox host;
	// a numeric value runs the script inside that LXC via `pct exec`. The ctid is
	// validated to digits and passed as its own argv entry, so it can't inject.
	target := r.URL.Query().Get("target")
	if target != "" && target != "host" && !ctidRe.MatchString(target) {
		writeErr(w, http.StatusBadRequest, "invalid target")
		return
	}

	// Mirrors the documented community-scripts one-liner
	// `bash -c "$(curl -fsSL <url>)"`, with the URL as $1 (injection-safe).
	inner := `bash -c "$(curl -fsSL "$1")"`
	var cmd *exec.Cmd
	if target != "" && target != "host" {
		// Run inside the chosen container. pct/the container validates the ctid;
		// a non-existent one fails cleanly rather than doing anything.
		cmd = exec.Command("pct", "exec", target, "--", "bash", "-c", inner, "simpdash", script.ScriptURL)
	} else {
		cmd = exec.Command("bash", "-c", inner, "simpdash", script.ScriptURL)
	}
	// TERM is required or whiptail/tput-based scripts abort with
	// "TERM environment variable not set" before doing any work.
	cmd.Env = append(os.Environ(), "DEBIAN_FRONTEND=noninteractive", "TERM=xterm")
	// ponytail: no tty — interactive whiptail menus in some scripts won't render.
	// stdin defaults to /dev/null (EOF, not a hang). Add a PTY in M4+ if a script
	// we list actually needs one; can't verify without real PVE.

	// PTY-backed: these scripts use interactive whiptail menus that need a
	// real terminal and keystroke input (streamed back via the job WebSocket).
	id, err := s.exec.StartPTY("catalog_script", cmd, s.db)
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
