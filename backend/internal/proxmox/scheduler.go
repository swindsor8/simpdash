package proxmox

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"
)

// BackupParams configures a Proxmox vzdump task triggered via the PVE API.
type BackupParams struct {
	VMID     int    // 0 when All == true
	All      bool   // back up all guests on the node
	Storage  string // target backup storage (optional; PVE default if empty)
	Mode     string // "snapshot" (default) | "suspend" | "stop"
	Compress string // "zstd" (default) | "gzip" | "lzo" | "0"
	Notes    string // optional notes-template
}

// NativeBackupSchedule is a read-only summary of a Proxmox VE native cluster
// backup schedule from GET /cluster/backup.
type NativeBackupSchedule struct {
	ID       string `json:"id"`
	Schedule string `json:"schedule"`
	Node     string `json:"node,omitempty"`
	Storage  string `json:"storage,omitempty"`
	VMID     string `json:"vmid,omitempty"`
	All      bool   `json:"all,omitempty"`
	Mode     string `json:"mode,omitempty"`
	Enabled  bool   `json:"enabled"`
	Comment  string `json:"comment,omitempty"`
	NextRun  int64  `json:"next_run,omitempty"`
}

// postForm performs an authenticated form-encoded POST against the PVE API and
// decodes the {"data": ...} envelope into out (when out != nil).
func (c *Client) postForm(path string, form url.Values, out any) error {
	host, tokenID, secret := c.creds()
	if tokenID == "" {
		return fmt.Errorf("proxmox not configured")
	}
	req, err := http.NewRequest(http.MethodPost, host+"/api2/json"+path, strings.NewReader(form.Encode()))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", fmt.Sprintf("PVEAPIToken=%s=%s", tokenID, secret))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		msg, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		detail := strings.TrimSpace(string(msg))
		if detail != "" {
			return fmt.Errorf("proxmox returned %s: %s", resp.Status, detail)
		}
		return fmt.Errorf("proxmox returned %s", resp.Status)
	}
	if out == nil {
		return nil
	}
	var env struct {
		Data json.RawMessage `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&env); err != nil {
		return err
	}
	return json.Unmarshal(env.Data, out)
}

// StartBackup triggers a vzdump backup task on a Proxmox node and returns the
// PVE task UPID.
func (c *Client) StartBackup(node string, p BackupParams) (string, error) {
	if !ValidNodeName(node) {
		return "", fmt.Errorf("invalid node name")
	}
	form := url.Values{}
	if p.All {
		form.Set("all", "1")
	} else {
		if p.VMID <= 0 {
			return "", fmt.Errorf("vmid is required unless backing up all guests")
		}
		form.Set("vmid", strconv.Itoa(p.VMID))
	}
	if p.Storage != "" {
		form.Set("storage", p.Storage)
	}
	mode := p.Mode
	if mode == "" {
		mode = "snapshot"
	}
	form.Set("mode", mode)
	compress := p.Compress
	if compress == "" {
		compress = "zstd"
	}
	form.Set("compress", compress)
	if p.Notes != "" {
		form.Set("notes-template", p.Notes)
	}

	var upid string
	if err := c.postForm("/nodes/"+url.PathEscape(node)+"/vzdump", form, &upid); err != nil {
		return "", err
	}
	return upid, nil
}

// CreateSnapshot creates a Proxmox snapshot for a VM ("qemu") or CT ("lxc")
// and returns the PVE task UPID.
func (c *Client) CreateSnapshot(node, guestType string, vmid int, snapname, description string, vmstate bool) (string, error) {
	if !ValidNodeName(node) {
		return "", fmt.Errorf("invalid node name")
	}
	if guestType != "qemu" && guestType != "lxc" {
		return "", fmt.Errorf("guestType must be qemu or lxc")
	}
	if vmid <= 0 {
		return "", fmt.Errorf("invalid vmid")
	}
	form := url.Values{}
	form.Set("snapname", snapname)
	if description != "" {
		form.Set("description", description)
	}
	if guestType == "qemu" && vmstate {
		form.Set("vmstate", "1")
	}
	var upid string
	path := fmt.Sprintf("/nodes/%s/%s/%d/snapshot", url.PathEscape(node), guestType, vmid)
	if err := c.postForm(path, form, &upid); err != nil {
		return "", err
	}
	return upid, nil
}

// WaitTask polls a Proxmox task UPID until it finishes, returning its
// exitstatus (typically "OK" on success).
func (c *Client) WaitTask(ctx context.Context, node, upid string) (string, error) {
	if !ValidNodeName(node) {
		return "", fmt.Errorf("invalid node name")
	}
	if upid == "" {
		return "OK", nil
	}
	path := "/nodes/" + url.PathEscape(node) + "/tasks/" + url.PathEscape(upid) + "/status"
	ticker := time.NewTicker(3 * time.Second)
	defer ticker.Stop()

	for {
		var st struct {
			Status     string `json:"status"`     // "running" | "stopped"
			ExitStatus string `json:"exitstatus"` // "OK" or error string
		}
		if err := c.getJSON(path, &st); err != nil {
			return "", err
		}
		if st.Status == "stopped" {
			return st.ExitStatus, nil
		}
		select {
		case <-ctx.Done():
			return "", ctx.Err()
		case <-ticker.C:
		}
	}
}

// ListBackupStorages returns active backup-capable storage IDs on node (or
// across all nodes if node is empty).
func (c *Client) ListBackupStorages(node string) ([]string, error) {
	nodes := []string{}
	if node != "" {
		if !ValidNodeName(node) {
			return nil, fmt.Errorf("invalid node name")
		}
		nodes = []string{node}
	} else {
		snap, err := c.Fetch()
		if err != nil {
			return nil, err
		}
		for _, n := range snap.Nodes {
			nodes = append(nodes, n.ID)
		}
	}
	seen := map[string]bool{}
	out := []string{}
	for _, n := range nodes {
		var stors []rawStorage
		if err := c.getJSON("/nodes/"+url.PathEscape(n)+"/storage?content=backup", &stors); err != nil {
			continue
		}
		for _, st := range stors {
			if st.Active == 0 || st.Storage == "" || seen[st.Storage] {
				continue
			}
			seen[st.Storage] = true
			out = append(out, st.Storage)
		}
	}
	sort.Strings(out)
	return out, nil
}

// FetchNativeBackupSchedules lists Proxmox VE's built-in /cluster/backup jobs.
// Best-effort: returns an empty slice if unavailable.
func (c *Client) FetchNativeBackupSchedules() ([]NativeBackupSchedule, error) {
	var raw []struct {
		ID       string `json:"id"`
		Schedule string `json:"schedule"`
		Node     string `json:"node"`
		Storage  string `json:"storage"`
		VMID     string `json:"vmid"`
		All      any    `json:"all"`
		Mode     string `json:"mode"`
		Enabled  any    `json:"enabled"`
		Comment  string `json:"comment"`
		NextRun  int64  `json:"next-run"`
	}
	if err := c.getJSON("/cluster/backup", &raw); err != nil {
		return nil, err
	}
	out := make([]NativeBackupSchedule, 0, len(raw))
	for _, r := range raw {
		enabled := true
		if r.Enabled != nil {
			enabled = truthyPVE(r.Enabled)
		}
		out = append(out, NativeBackupSchedule{
			ID:       r.ID,
			Schedule: r.Schedule,
			Node:     r.Node,
			Storage:  r.Storage,
			VMID:     r.VMID,
			All:      truthyPVE(r.All),
			Mode:     r.Mode,
			Enabled:  enabled,
			Comment:  r.Comment,
			NextRun:  r.NextRun,
		})
	}
	return out, nil
}

func truthyPVE(v any) bool {
	switch x := v.(type) {
	case bool:
		return x
	case float64:
		return x != 0
	case string:
		return x == "1" || strings.EqualFold(x, "true")
	default:
		return false
	}
}
