package proxmox

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strings"
)

// nodeNameRe validates a PVE node name before it is interpolated into an API
// path. Node names are hostnames — anything else (slashes, dots-dots, query
// metacharacters) is rejected so a crafted "node" parameter can't traverse to
// a different Proxmox API route.
var nodeNameRe = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._-]*$`)

// ValidNodeName reports whether s is safe to use as a node path segment.
func ValidNodeName(s string) bool { return s != "" && len(s) <= 64 && nodeNameRe.MatchString(s) }

// getJSON performs an authenticated GET against the PVE API and decodes the
// standard {"data": ...} envelope into out.
func (c *Client) getJSON(path string, out any) error {
	host, tokenID, secret := c.creds()
	if tokenID == "" {
		return fmt.Errorf("proxmox not configured")
	}
	req, err := http.NewRequest(http.MethodGet, host+"/api2/json"+path, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", fmt.Sprintf("PVEAPIToken=%s=%s", tokenID, secret))
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("proxmox returned %s", resp.Status)
	}
	var body struct {
		Data json.RawMessage `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return err
	}
	return json.Unmarshal(body.Data, out)
}

// postEmpty performs an authenticated POST with no body (PVE action endpoints).
func (c *Client) postEmpty(path string) error {
	host, tokenID, secret := c.creds()
	if tokenID == "" {
		return fmt.Errorf("proxmox not configured")
	}
	req, err := http.NewRequest(http.MethodPost, host+"/api2/json"+path, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", fmt.Sprintf("PVEAPIToken=%s=%s", tokenID, secret))
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("proxmox returned %s", resp.Status)
	}
	return nil
}

// RRDPoint is one averaged sample from /nodes/{node}/rrddata.
type RRDPoint struct {
	Time   int64    `json:"time"`
	CPU    *float64 `json:"cpu,omitempty"`
	Mem    *float64 `json:"memused,omitempty"`
	MaxMem *float64 `json:"memtotal,omitempty"`
	NetIn  *float64 `json:"netin,omitempty"`
	NetOut *float64 `json:"netout,omitempty"`
}

// FetchRRD returns hourly-averaged resource history for a node. PVE keeps this
// itself (RRD), so trends cost nothing to store on our side.
func (c *Client) FetchRRD(node, timeframe string) ([]RRDPoint, error) {
	if !ValidNodeName(node) {
		return nil, fmt.Errorf("invalid node name")
	}
	// timeframe is caller-validated against a fixed allowlist; escape anyway.
	var pts []RRDPoint
	err := c.getJSON("/nodes/"+url.PathEscape(node)+"/rrddata?timeframe="+url.QueryEscape(timeframe)+"&cf=AVERAGE", &pts)
	return pts, err
}

// ClusterTask is one entry from /cluster/tasks (recent + running).
type ClusterTask struct {
	UPID      string `json:"upid"`
	Node      string `json:"node"`
	Type      string `json:"type"`
	ID        string `json:"id"` // vmid or resource the task targeted
	User      string `json:"user"`
	Status    string `json:"status"` // "OK", error text, or "" while running
	StartTime int64  `json:"starttime"`
	EndTime   int64  `json:"endtime"`
}

// FetchTasks returns the cluster-wide recent task list, newest first.
func (c *Client) FetchTasks() ([]ClusterTask, error) {
	var tasks []ClusterTask
	if err := c.getJSON("/cluster/tasks", &tasks); err != nil {
		return nil, err
	}
	// PVE returns them unordered-ish; sort newest first.
	for i := 1; i < len(tasks); i++ {
		for j := i; j > 0 && tasks[j].StartTime > tasks[j-1].StartTime; j-- {
			tasks[j], tasks[j-1] = tasks[j-1], tasks[j]
		}
	}
	return tasks, nil
}

// GuestIPs returns the IPv4 addresses of one guest, best-effort. LXC uses the
// container interfaces endpoint (PVE 7.3+); QEMU needs the guest agent. Both
// are read-only PVE API calls with the existing token — no exec, no shell.
func (c *Client) GuestIPs(node, gtype string, vmid int) ([]string, error) {
	if !ValidNodeName(node) {
		return nil, fmt.Errorf("invalid node name")
	}
	switch gtype {
	case "lxc":
		var ifaces []struct {
			Name string `json:"name"`
			Inet string `json:"inet"` // "192.168.1.50/24"
		}
		if err := c.getJSON(fmt.Sprintf("/nodes/%s/lxc/%d/interfaces", url.PathEscape(node), vmid), &ifaces); err != nil {
			return nil, err
		}
		var ips []string
		for _, i := range ifaces {
			if i.Name == "lo" || i.Inet == "" {
				continue
			}
			ips = append(ips, strings.SplitN(i.Inet, "/", 2)[0])
		}
		return ips, nil
	case "qemu":
		var res struct {
			Result []struct {
				Name string `json:"name"`
				Addr []struct {
					Type string `json:"ip-address-type"`
					IP   string `json:"ip-address"`
				} `json:"ip-addresses"`
			} `json:"result"`
		}
		if err := c.getJSON(fmt.Sprintf("/nodes/%s/qemu/%d/agent/network-get-interfaces", url.PathEscape(node), vmid), &res); err != nil {
			return nil, err
		}
		var ips []string
		for _, i := range res.Result {
			if i.Name == "lo" {
				continue
			}
			for _, a := range i.Addr {
				if a.Type == "ipv4" && !strings.HasPrefix(a.IP, "127.") {
					ips = append(ips, a.IP)
				}
			}
		}
		return ips, nil
	}
	return nil, fmt.Errorf("invalid guest type")
}

// NodeWake asks the cluster to send a wake-on-LAN packet to node. PVE routes
// the request via an online cluster member; the target node's config must have
// its WOL MAC set (Node → Options → Wake on LAN in the PVE UI).
func (c *Client) NodeWake(node string) error {
	if !ValidNodeName(node) {
		return fmt.Errorf("invalid node name")
	}
	return c.postEmpty("/nodes/" + url.PathEscape(node) + "/wakeonlan")
}
