package api

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
)

// handleEntitiesPrefix dispatches POST /api/entities/:type/:id/action.
func (s *Server) handleEntitiesPrefix(w http.ResponseWriter, r *http.Request) {
	tail := strings.TrimPrefix(r.URL.Path, "/api/entities/")
	parts := strings.SplitN(tail, "/", 3)
	if len(parts) != 3 || parts[2] != "action" {
		http.NotFound(w, r)
		return
	}
	entityType, entityID := parts[0], parts[1]
	methodGate(http.MethodPost, s.requireAuth(func(w http.ResponseWriter, r *http.Request) {
		s.EntityAction(w, r, entityType, entityID)
	}))(w, r)
}

// EntityAction handles POST /api/entities/:type/:id/action.
// Body: { "action": "start"|"shutdown"|"stop"|"reboot", "node": "<pve-node>" }
// node is required for qemu/lxc (identifies which PVE node hosts the guest).
func (s *Server) EntityAction(w http.ResponseWriter, r *http.Request, entityType, entityID string) {
	var body struct {
		Action string `json:"action"`
		Node   string `json:"node"` // PVE node name; required for qemu/lxc
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid body")
		return
	}

	switch entityType {
	case "node":
		if body.Action != "reboot" && body.Action != "shutdown" {
			writeErr(w, http.StatusBadRequest, "nodes only support reboot and shutdown")
			return
		}
		if err := s.px.NodeAction(entityID, body.Action); err != nil {
			writeErr(w, http.StatusBadGateway, err.Error())
			return
		}

	case "qemu", "lxc":
		vmid, err := strconv.Atoi(entityID)
		if err != nil {
			writeErr(w, http.StatusBadRequest, "invalid vmid")
			return
		}
		if body.Node == "" {
			writeErr(w, http.StatusBadRequest, "node is required for qemu/lxc actions")
			return
		}
		valid := map[string]bool{"start": true, "shutdown": true, "stop": true, "reboot": true}
		if !valid[body.Action] {
			writeErr(w, http.StatusBadRequest, "action must be start, shutdown, stop, or reboot")
			return
		}
		if err := s.px.GuestAction(body.Node, entityType, vmid, body.Action); err != nil {
			writeErr(w, http.StatusBadGateway, err.Error())
			return
		}

	default:
		writeErr(w, http.StatusBadRequest, "type must be node, qemu, or lxc")
		return
	}

	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
