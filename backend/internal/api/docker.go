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

// DockerContainer is one container reported by `docker ps` inside a guest.
type DockerContainer struct {
	Name   string `json:"name"`
	Image  string `json:"image"`
	State  string `json:"state"`  // running | exited | ...
	Status string `json:"status"` // human string, e.g. "Up 3 days"
}

// dockerArgs lists all containers as one JSON object per line. Fixed argv —
// nothing user-controlled reaches it (vmid is validated numeric).
var dockerArgs = []string{"docker", "ps", "--all", "--format", "{{json .}}"}

// GuestDocker handles GET /api/guests/:vmid/docker?type=lxc|qemu — read-only
// container listing inside a guest, same exec plumbing (and same trust
// boundary) as GuestServices. 404s cleanly when docker isn't installed.
func (s *Server) GuestDocker(w http.ResponseWriter, r *http.Request, vmid string) {
	if _, err := strconv.Atoi(vmid); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid vmid")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 12*time.Second)
	defer cancel()

	var raw string
	switch r.URL.Query().Get("type") {
	case "lxc":
		args := append([]string{"exec", vmid, "--"}, dockerArgs...)
		out, err := exec.CommandContext(ctx, "pct", args...).Output()
		if err != nil {
			writeErr(w, http.StatusNotFound, "docker not available in this container: "+execErr(err))
			return
		}
		raw = string(out)
	case "qemu":
		args := append([]string{"guest", "exec", vmid, "--"}, dockerArgs...)
		out, err := exec.CommandContext(ctx, "qm", args...).Output()
		if err != nil {
			writeErr(w, http.StatusNotFound, "docker not available in this VM (guest agent required): "+execErr(err))
			return
		}
		var res struct {
			OutData  string `json:"out-data"`
			ExitCode int    `json:"exitcode"`
		}
		if err := json.Unmarshal(out, &res); err != nil || res.ExitCode != 0 {
			writeErr(w, http.StatusNotFound, "docker not available in this VM")
			return
		}
		raw = res.OutData
	default:
		writeErr(w, http.StatusBadRequest, "type must be lxc or qemu")
		return
	}

	writeJSON(w, http.StatusOK, parseDockerPS(raw))
}

// parseDockerPS decodes `docker ps --format '{{json .}}'` output (one JSON
// object per line; docker's field names are capitalized).
func parseDockerPS(raw string) []DockerContainer {
	out := []DockerContainer{}
	for _, line := range strings.Split(raw, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || !strings.HasPrefix(line, "{") {
			continue
		}
		var row struct {
			Names  string `json:"Names"`
			Image  string `json:"Image"`
			State  string `json:"State"`
			Status string `json:"Status"`
		}
		if err := json.Unmarshal([]byte(line), &row); err != nil {
			continue
		}
		out = append(out, DockerContainer{Name: row.Names, Image: row.Image, State: row.State, Status: row.Status})
	}
	return out
}
