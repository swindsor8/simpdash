package api

import (
	"context"
	"encoding/json"
	"net/http"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

// GuestService is one running systemd service inside a guest.
type GuestService struct {
	Name        string `json:"name"`
	Status      string `json:"status"`
	Description string `json:"description"`
}

// systemctlArgs lists running services in a plain, parseable form (no legend,
// no pager, no colour). Shared by the LXC and VM paths.
var systemctlArgs = []string{
	"systemctl", "list-units", "--type=service", "--state=running",
	"--no-pager", "--no-legend", "--plain",
}

// GuestServices handles GET /api/guests/:vmid/services?type=lxc|qemu — the
// running systemd services inside a container (via `pct exec`, no agent needed)
// or a VM (via `qm guest exec`, which requires the QEMU guest agent). Read-only,
// runs as root on the PVE host. vmid is validated numeric before it reaches the
// shell-less exec.Command.
func (s *Server) GuestServices(w http.ResponseWriter, r *http.Request, vmid string) {
	if _, err := strconv.Atoi(vmid); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid vmid")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 12*time.Second)
	defer cancel()

	var raw string
	switch r.URL.Query().Get("type") {
	case "lxc":
		args := append([]string{"exec", vmid, "--"}, systemctlArgs...)
		out, err := exec.CommandContext(ctx, "pct", args...).Output()
		if err != nil {
			writeErr(w, http.StatusBadGateway, "could not read container services (is it running?): "+execErr(err))
			return
		}
		raw = string(out)
	case "qemu":
		// `qm guest exec` returns {"exitcode":N,"exited":1,"out-data":"..."}.
		args := append([]string{"guest", "exec", vmid, "--"}, systemctlArgs...)
		out, err := exec.CommandContext(ctx, "qm", args...).Output()
		if err != nil {
			writeErr(w, http.StatusBadGateway, "could not read VM services (QEMU guest agent required & running?): "+execErr(err))
			return
		}
		var res struct {
			OutData string `json:"out-data"`
		}
		if err := json.Unmarshal(out, &res); err != nil {
			writeErr(w, http.StatusBadGateway, "unexpected guest-agent output")
			return
		}
		raw = res.OutData
	default:
		writeErr(w, http.StatusBadRequest, "type must be lxc or qemu")
		return
	}

	writeJSON(w, http.StatusOK, parseServices(raw))
}

// parseServices turns `systemctl list-units --plain --no-legend` lines
// (UNIT LOAD ACTIVE SUB DESCRIPTION) into GuestService records.
func parseServices(raw string) []GuestService {
	out := []GuestService{}
	for _, line := range strings.Split(raw, "\n") {
		f := strings.Fields(line)
		if len(f) < 4 {
			continue
		}
		out = append(out, GuestService{
			Name:        strings.TrimSuffix(f[0], ".service"),
			Status:      f[3], // SUB state, e.g. "running"
			Description: strings.Join(f[4:], " "),
		})
	}
	return out
}

// execErr surfaces a command's stderr when present, else the bare error.
func execErr(err error) string {
	if ee, ok := err.(*exec.ExitError); ok && len(ee.Stderr) > 0 {
		return strings.TrimSpace(string(ee.Stderr))
	}
	return err.Error()
}
